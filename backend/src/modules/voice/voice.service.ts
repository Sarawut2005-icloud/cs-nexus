import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { GatewayUser } from '../../common/auth/gateway-user.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { ChannelsService } from '../channels/channels.service.js';
import {
  IceServerDto,
  JoinVoiceResponseDto,
  MAX_SCREEN_VIEWERS,
  VoiceSessionDto,
} from './dto/voice.dto.js';

@Injectable()
export class VoiceService {
  private readonly logger = new Logger(VoiceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly channels: ChannelsService,
  ) {}

  /// เข้าห้องเสียง — เพดานคนบังคับที่นี่ ไม่ใช่ที่ UI
  ///
  /// ถ้าปล่อยให้ UI เป็นคนคุม คนที่เขียนสคริปต์เรียก API ตรงจะเข้าเกินเพดานได้
  /// แล้วเสียงของทั้งห้องจะขาดโดยที่ไม่มีใครรู้ว่าทำไม
  async join(
    user: GatewayUser,
    channelId: string,
  ): Promise<JoinVoiceResponseDto> {
    await this.channels.requireMembership(user, channelId);

    const channel = await this.prisma.channel.findUniqueOrThrow({
      where: { id: channelId },
    });

    const session = await this.prisma.$transaction(async (tx) => {
      // ล็อกแถวห้องก่อนทำอะไรทั้งหมด
      //
      // ทรานแซกชันของ Postgres เป็น READ COMMITTED โดยปริยาย ซึ่ง **ไม่ได้**
      // กันสองคำขอที่วิ่งพร้อมกันอ่านภาพเดียวกันแล้วเขียนทับกัน ของเดิมจึงพัง
      // สองแบบ:
      //   1. สองคนกดเข้าห้องพร้อมกัน ต่างก็หา session ที่เปิดอยู่ไม่เจอ
      //      แล้วต่างก็สร้างใหม่ — ได้ห้องเสียงซ้อนกันสองห้องในช่องเดียว
      //      แล้วสองคนนั้นก็ไม่ได้ยินกันเลยทั้งที่ UI บอกว่าอยู่ห้องเดียวกัน
      //   2. ที่นั่งเหลือหนึ่งที่ สองคนอ่านได้ 7/8 เท่ากัน ผ่านด่านทั้งคู่
      //      แล้วเขียนทั้งคู่ — กลายเป็น 9 คนในห้องที่ P2P รับได้ 8
      //
      // ล็อกที่ "ห้อง" ไม่ใช่ที่ session เพราะตอนเริ่มยังไม่มี session ให้ล็อก
      // คำขอเข้าห้องเดียวกันจึงเข้าคิวกัน ส่วนคนละห้องยังขนานกันได้ตามปกติ
      // คอลัมน์ id เป็น text (Prisma แม็ป String @id เป็น TEXT ไม่ใช่ uuid)
      // จึงห้าม cast พารามิเตอร์เป็น ::uuid ไม่งั้นชนชนิดกันทุกคำขอ
      await tx.$queryRaw`SELECT id FROM channels WHERE id = ${channelId} FOR UPDATE`;

      // หา session ที่ยังเปิดอยู่ ถ้าไม่มีก็เปิดใหม่ — ห้องเสียงแบบ always-on
      // คือ "เข้าเมื่อไหร่ก็ได้" ไม่ต้องมีใครกดเริ่ม
      const active =
        (await tx.voiceSession.findFirst({
          where: { channelId, endedAt: null },
          orderBy: { startedAt: 'desc' },
        })) ??
        (await tx.voiceSession.create({ data: { channelId } }));

      const present = await tx.voiceParticipant.findMany({
        where: { sessionId: active.id, leftAt: null },
      });

      const alreadyIn = present.find((p) => p.username === user.username);

      if (alreadyIn) {
        return active;
      }

      if (present.length >= channel.maxSeats) {
        throw new ConflictException(
          `ห้องเต็มแล้ว (${present.length}/${channel.maxSeats} คน) — ` +
            'ห้องเสียงแบบ P2P รับได้เท่านี้ รอให้มีคนออกก่อน',
        );
      }

      await tx.voiceParticipant.create({
        data: { sessionId: active.id, username: user.username },
      });

      return active;
    });

    const state = await this.buildSession(session.id, channel.maxSeats);
    const iceServers = this.iceServers();

    return {
      ...state,
      ice_servers: iceServers,
      turn_available: iceServers.some((server) =>
        server.urls.some((url) => url.startsWith('turn:')),
      ),
      max_screen_viewers: MAX_SCREEN_VIEWERS,
    };
  }

  async leave(user: GatewayUser, sessionId: string): Promise<void> {
    const participant = await this.prisma.voiceParticipant.findFirst({
      where: { sessionId, username: user.username, leftAt: null },
    });

    if (!participant) {
      return; // ออกซ้ำไม่ถือว่าผิด ให้เงียบ ๆ ผ่านไป
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.voiceParticipant.update({
        where: { id: participant.id },
        data: { leftAt: new Date() },
      });

      const remaining = await tx.voiceParticipant.count({
        where: { sessionId, leftAt: null },
      });

      // คนสุดท้ายออก = ปิด session เพื่อให้สถิติห้องติวอ่านง่าย
      if (remaining === 0) {
        await tx.voiceSession.update({
          where: { id: sessionId },
          data: { endedAt: new Date() },
        });
      }
    });
  }

  async listActive(
    user: GatewayUser,
    channelId?: string,
  ): Promise<VoiceSessionDto[]> {
    // เห็นได้เฉพาะห้องที่ตัวเองเป็นสมาชิก — ไม่งั้นจะรู้ว่าใครติวกับใครอยู่
    const memberships = await this.prisma.channelMember.findMany({
      where: {
        username: user.username,
        ...(channelId ? { channelId } : {}),
      },
      select: { channelId: true },
    });

    if (memberships.length === 0) {
      return [];
    }

    const sessions = await this.prisma.voiceSession.findMany({
      where: {
        endedAt: null,
        channelId: { in: memberships.map((m) => m.channelId) },
      },
      include: {
        channel: { select: { maxSeats: true } },
        participants: { where: { leftAt: null } },
      },
    });

    return sessions.map((session) => ({
      id: session.id,
      channel_id: session.channelId,
      started_at: session.startedAt.toISOString(),
      participants: session.participants.map((p) => ({
        username: p.username,
        joined_at: p.joinedAt.toISOString(),
      })),
      max_seats: session.channel.maxSeats,
      seats_taken: session.participants.length,
    }));
  }

  /// ใช้โดยชั้น Socket.io — ตอบว่าสองคนนี้อยู่ห้องเสียงเดียวกันไหม
  ///
  /// ถ้าไม่เช็ค จะส่ง SDP ไปหาใครก็ได้ในระบบ ซึ่งเป็นทั้งช่องกวนคนอื่น
  /// และช่องให้รู้ IP ของคนอื่น (§9-V5 ของสเปกสถาปัตยกรรม)
  async sharesVoiceSession(
    usernameA: string,
    usernameB: string,
  ): Promise<string | null> {
    const rows = await this.prisma.voiceParticipant.findMany({
      where: {
        leftAt: null,
        username: { in: [usernameA, usernameB] },
        session: { endedAt: null },
      },
      select: { sessionId: true, username: true },
    });

    const bySession = new Map<string, Set<string>>();

    for (const row of rows) {
      const set = bySession.get(row.sessionId) ?? new Set<string>();

      set.add(row.username);
      bySession.set(row.sessionId, set);
    }

    for (const [sessionId, usernames] of bySession) {
      if (usernames.has(usernameA) && usernames.has(usernameB)) {
        return sessionId;
      }
    }

    return null;
  }

  /// ห้องที่ session นี้สังกัด — ใช้ตรวจว่าผู้รับสายเป็นสมาชิกห้องเดียวกันไหม
  async channelOfSession(sessionId: string): Promise<string | null> {
    const session = await this.prisma.voiceSession.findFirst({
      where: { id: sessionId, endedAt: null },
      select: { channelId: true },
    });

    return session?.channelId ?? null;
  }

  async activeSessionOf(username: string): Promise<string | null> {
    const participant = await this.prisma.voiceParticipant.findFirst({
      where: { username, leftAt: null, session: { endedAt: null } },
      orderBy: { joinedAt: 'desc' },
      select: { sessionId: true },
    });

    return participant?.sessionId ?? null;
  }

  /// ปิดการเข้าร่วมที่ค้างเมื่อ socket หลุดโดยไม่ได้กดออก
  async leaveAllFor(username: string): Promise<string[]> {
    const open = await this.prisma.voiceParticipant.findMany({
      where: { username, leftAt: null },
      select: { id: true, sessionId: true },
    });

    if (open.length === 0) {
      return [];
    }

    await this.prisma.voiceParticipant.updateMany({
      where: { id: { in: open.map((p) => p.id) } },
      data: { leftAt: new Date() },
    });

    return [...new Set(open.map((p) => p.sessionId))];
  }

  private async buildSession(
    sessionId: string,
    maxSeats: number,
  ): Promise<VoiceSessionDto> {
    const session = await this.prisma.voiceSession.findUnique({
      where: { id: sessionId },
      include: { participants: { where: { leftAt: null } } },
    });

    if (!session) {
      throw new NotFoundException('ไม่พบห้องเสียงนี้');
    }

    return {
      id: session.id,
      channel_id: session.channelId,
      started_at: session.startedAt.toISOString(),
      participants: session.participants.map((p) => ({
        username: p.username,
        joined_at: p.joinedAt.toISOString(),
      })),
      max_seats: maxSeats,
      seats_taken: session.participants.length,
    };
  }

  /// STUN ฟรีพอสำหรับผู้ใช้ส่วนใหญ่ แต่ TURN จำเป็นสำหรับคนที่อยู่หลัง NAT
  /// แบบที่เจาะไม่ได้ ซึ่งพบบ่อยในเน็ตมหาลัยและเน็ตมือถือ
  ///
  /// ถ้าไม่ตั้ง TURN_URL ระบบยังทำงานได้ แต่จะมีคนกลุ่มหนึ่งเชื่อมไม่ติดเลย
  /// และหน้าบ้านต้องบอกผู้ใช้ตรง ๆ ว่าทำไม (turn_available = false)
  /// เปิดเป็น public เพราะหน้าบ้านต้องใช้ชุดเดียวกันตอนตรวจเครือข่าย
  ///
  /// ถ้าให้หน้าบ้าน hardcode รายการเอง ผลตรวจจะไม่ตรงกับการโทรจริงทันที
  /// ที่ผู้ดูแลเปลี่ยนค่า TURN — แล้วตัวตรวจก็จะโกหกผู้ใช้
  iceServers(): IceServerDto[] {
    // STUN หลายเจ้า ไม่ใช่เจ้าเดียว — ทั้งหมดใช้ฟรี ไม่ต้องสมัคร
    //
    // STUN ทำหน้าที่เดียวคือบอกเราว่า "จากข้างนอกมองเข้ามา ไอพีและพอร์ตของ
    // คุณคืออะไร" ถ้าเจ้าเดียวล่มหรือถูกไฟร์วอลล์ของมหาลัยบล็อก การโทรจะ
    // ล้มทั้งหมด การใส่หลายเจ้าจากคนละองค์กรจึงเป็นการกระจายความเสี่ยง
    // ที่ไม่มีค่าใช้จ่ายเลย เบราว์เซอร์จะลองทุกตัวขนานกันแล้วใช้ตัวที่ตอบก่อน
    const servers: IceServerDto[] = [
      {
        urls: [
          'stun:stun.l.google.com:19302',
          'stun:stun1.l.google.com:19302',
          'stun:stun2.l.google.com:19302',
          'stun:stun.cloudflare.com:3478',
        ],
      },
    ];

    const turnUrl = process.env.TURN_URL;

    if (turnUrl) {
      servers.push({
        urls: turnUrl.split(',').map((url) => url.trim()),
        username: process.env.TURN_USERNAME,
        credential: process.env.TURN_CREDENTIAL,
      });
    } else {
      this.logger.warn(
        'ไม่ได้ตั้ง TURN_URL — ผู้ใช้หลัง NAT ที่เจาะไม่ได้จะเชื่อมเสียงไม่ติด',
      );
    }

    return servers;
  }
}
