import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { GatewayUser } from '../../common/auth/gateway-user.js';
import { canAdministerChannel } from '../../common/auth/member-role.js';
import { Paginated } from '../../common/http/envelope.js';
import { PaginationQuery } from '../../common/http/pagination.dto.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { RealtimeBus } from '../../common/realtime/realtime-bus.js';
import type { ChannelRole } from '../../generated/prisma/enums.js';
import {
  AddMembersDto,
  ChannelResponseDto,
  CreateChannelDto,
  CreateDirectChannelDto,
  toChannelResponse,
} from './dto/channel.dto.js';

@Injectable()
export class ChannelsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bus: RealtimeBus,
  ) {}

  async listMine(
    user: GatewayUser,
    query: PaginationQuery,
  ): Promise<Paginated<ChannelResponseDto>> {
    const where = { members: { some: { username: user.username } } };

    const [channels, total] = await Promise.all([
      this.prisma.channel.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: query.skip,
        take: query.take,
        include: {
          members: { where: { username: user.username } },
          _count: { select: { members: true } },
        },
      }),
      this.prisma.channel.count({ where }),
    ]);

    // นับข้อความที่ยังไม่อ่านของทุกห้องในคิวรีเดียว
    //
    // เดิมเรียก unreadCount() ใน map ซึ่งเป็น COUNT หนึ่งครั้งต่อหนึ่งห้อง —
    // ผู้ใช้ที่อยู่ 30 ห้องจ่าย 32 คิวรีต่อการเปิดรายการหนึ่งครั้ง และเลขนั้น
    // โตตามจำนวนห้องไปเรื่อย ๆ จนกลายเป็นวินาทีเมื่อฐานข้อมูลอยู่คนละเครื่อง
    const unreadByChannel = await this.unreadCounts(
      channels.map((channel) => ({
        channelId: channel.id,
        lastReadSeq: channel.members[0]?.lastReadSeq ?? 0,
      })),
    );

    const items = channels.map((channel) => {
      const membership = channel.members[0];

      return toChannelResponse(channel, {
        memberCount: channel._count.members,
        myRole: membership?.role ?? 'MEMBER',
        unreadCount: unreadByChannel.get(channel.id) ?? 0,
      });
    });

    return new Paginated(items, query.meta(total));
  }

  async create(
    user: GatewayUser,
    dto: CreateChannelDto,
  ): Promise<ChannelResponseDto> {
    // ห้องเรียนประจำวิชาเป็นพื้นที่ทางการ ให้เฉพาะบุคลากรสร้าง
    if (dto.kind === 'COURSE' && user.layer1Role === 'student') {
      throw new ForbiddenException(
        'ห้องประจำวิชาสร้างได้เฉพาะอาจารย์และบุคลากร — นักศึกษาสร้างห้องกลุ่มได้',
      );
    }

    const channel = await this.prisma.channel.create({
      data: {
        kind: dto.kind,
        name: dto.name,
        courseTag: dto.course_tag ?? null,
        maxSeats: dto.max_seats ?? 8,
        // คนสร้างเป็นผู้ดูแลห้องโดยอัตโนมัติ
        members: {
          create: { username: user.username, role: 'MODERATOR' },
        },
      },
      include: { _count: { select: { members: true } } },
    });

    return toChannelResponse(channel, {
      memberCount: channel._count.members,
      myRole: 'MODERATOR',
      unreadCount: 0,
    });
  }

  /// แชทส่วนตัว — ต้องหาห้องเดิมก่อนเสมอ ไม่งั้นสองคนจะมีหลายห้องคุยกันเอง
  async createOrFindDirect(
    user: GatewayUser,
    dto: CreateDirectChannelDto,
  ): Promise<ChannelResponseDto> {
    if (dto.peer_username === user.username) {
      throw new BadRequestException('สร้างห้องแชทกับตัวเองไม่ได้');
    }

    const existing = await this.prisma.channel.findFirst({
      where: {
        kind: 'DM',
        AND: [
          { members: { some: { username: user.username } } },
          { members: { some: { username: dto.peer_username } } },
        ],
      },
      include: {
        members: { where: { username: user.username } },
        _count: { select: { members: true } },
      },
    });

    if (existing) {
      return toChannelResponse(existing, {
        memberCount: existing._count.members,
        myRole: existing.members[0]?.role ?? 'MEMBER',
        unreadCount: await this.unreadCount(
          existing.id,
          existing.members[0]?.lastReadSeq ?? 0,
        ),
      });
    }

    const channel = await this.prisma.channel.create({
      data: {
        kind: 'DM',
        name: null,
        maxSeats: 2,
        members: {
          create: [
            { username: user.username, role: 'MEMBER' },
            { username: dto.peer_username, role: 'MEMBER' },
          ],
        },
      },
      include: { _count: { select: { members: true } } },
    });

    return toChannelResponse(channel, {
      memberCount: channel._count.members,
      myRole: 'MEMBER',
      unreadCount: 0,
    });
  }

  async findOne(
    user: GatewayUser,
    channelId: string,
  ): Promise<ChannelResponseDto> {
    const membership = await this.requireMembership(user, channelId);

    const channel = await this.prisma.channel.findUniqueOrThrow({
      where: { id: channelId },
      include: { _count: { select: { members: true } } },
    });

    return toChannelResponse(channel, {
      memberCount: channel._count.members,
      myRole: membership.role,
      unreadCount: await this.unreadCount(channelId, membership.lastReadSeq),
    });
  }

  async addMembers(
    user: GatewayUser,
    channelId: string,
    dto: AddMembersDto,
  ): Promise<{ added: number }> {
    const membership = await this.requireMembership(user, channelId);
    const channel = await this.prisma.channel.findUniqueOrThrow({
      where: { id: channelId },
      include: { _count: { select: { members: true } } },
    });

    if (channel.kind === 'DM') {
      throw new BadRequestException('เพิ่มคนเข้าแชทส่วนตัวไม่ได้');
    }

    if (!canAdministerChannel(membership.role, user)) {
      throw new ForbiddenException(
        'เฉพาะผู้ดูแลห้อง อาจารย์ หรือผู้ดูแลระบบเท่านั้นที่เพิ่มสมาชิกได้',
      );
    }

    const unique = [...new Set(dto.usernames)].filter(
      (name) => name !== user.username,
    );

    const result = await this.prisma.channelMember.createMany({
      data: unique.map((username) => ({ channelId, username })),
      skipDuplicates: true,
    });

    return { added: result.count };
  }

  async leave(user: GatewayUser, channelId: string): Promise<void> {
    await this.requireMembership(user, channelId);

    await this.prisma.channelMember.delete({
      where: { channelId_username: { channelId, username: user.username } },
    });

    // ลบแถวสมาชิกอย่างเดียวไม่พอ — socket ยังอยู่ในห้องของ socket.io
    // และการกระจายข้อความไม่ได้ตรวจสมาชิกซ้ำ อดีตสมาชิกจึงยังเห็นข้อความ
    // ใหม่แบบสดทุกข้อความ ทั้งที่กด "ออกจากห้อง" ไปแล้วและเปิดหน้าห้องไม่ได้
    this.bus.evictFromRoom({ room: channelId, username: user.username });
  }

  /// อัปเดตว่าอ่านถึงข้อความไหนแล้ว — ทำให้ badge ยังไม่อ่านคำนวณด้วยการลบเลข
  /// แทนที่จะต้อง COUNT ทุกครั้งที่โหลดรายการห้อง
  async markRead(
    user: GatewayUser,
    channelId: string,
    seq: number,
  ): Promise<{ last_read_seq: number }> {
    const membership = await this.requireMembership(user, channelId);

    // ไม่ให้ถอยหลัง — และต้องให้ **ฐานข้อมูล** เป็นคนบังคับ ไม่ใช่คำนวณในหน่วยความจำ
    //
    // เดิมอ่าน lastReadSeq มาก่อนแล้วค่อย Math.max ในโพรเซส: เปิดแชทค้างไว้
    // ทั้งบนโน้ตบุ๊กและมือถือ ทั้งคู่อ่านได้ 40 เท่ากัน โน้ตบุ๊กคำนวณได้ 120
    // มือถือได้ 60 แล้วมือถือเขียนทีหลัง — ค่าสุดท้ายคือ 60 badge ที่อ่านแล้ว
    // จึงเด้งกลับมาเป็นยังไม่อ่านเองเฉย ๆ
    //
    // เงื่อนไข lastReadSeq < seq ทำให้การเขียนที่ถอยหลังไม่เข้าเงื่อนไขเลย
    await this.prisma.channelMember.updateMany({
      where: { channelId, username: user.username, lastReadSeq: { lt: seq } },
      data: { lastReadSeq: seq },
    });

    return { last_read_seq: Math.max(membership.lastReadSeq, seq) };
  }

  /// อีกคนเป็นสมาชิกห้องนี้ไหม — ต่างจาก requireMembership ที่ถามถึงผู้เรียกเอง
  ///
  /// ใช้ตอนโทร: ต้องรู้ว่าปลายทางอยู่ห้องเดียวกันก่อนส่งเสียงกริ่ง
  /// คืน boolean ไม่ throw เพราะผู้เรียกต้องแปลงเป็นข้อความที่ไม่บอกว่า
  /// คนชื่อนั้นมีอยู่จริงหรือไม่
  async isMember(username: string, channelId: string): Promise<boolean> {
    const membership = await this.prisma.channelMember.findUnique({
      where: { channelId_username: { channelId, username } },
      select: { username: true },
    });

    return membership !== null;
  }

  /// ใช้ร่วมกันทั้ง REST และ Socket.io — จุดเดียวที่ตัดสินว่า "อยู่ห้องนี้ไหม"
  async requireMembership(
    user: GatewayUser,
    channelId: string,
  ): Promise<{ role: ChannelRole; lastReadSeq: number }> {
    const membership = await this.prisma.channelMember.findUnique({
      where: { channelId_username: { channelId, username: user.username } },
      select: { role: true, lastReadSeq: true },
    });

    if (!membership) {
      // ตอบ 404 ไม่ใช่ 403 เพื่อไม่ให้คนนอกรู้ว่าห้องนี้มีอยู่จริง
      throw new NotFoundException('ไม่พบห้องนี้ หรือคุณไม่ได้เป็นสมาชิก');
    }

    return membership;
  }

  /// นับข้อความที่ยังไม่อ่านของหลายห้องพร้อมกัน
  ///
  /// ใช้ groupBy ครั้งเดียวแทน COUNT ต่อห้อง · เงื่อนไข seq > lastReadSeq
  /// ต่างกันไปในแต่ละห้อง จึงกรองด้วย OR ของคู่ (channelId, seq) แล้วให้
  /// ฐานข้อมูลใช้ดัชนี [channelId, seq] ที่มีอยู่แล้ว
  private async unreadCounts(
    memberships: { channelId: string; lastReadSeq: number }[],
  ): Promise<Map<string, number>> {
    if (memberships.length === 0) {
      return new Map();
    }

    const grouped = await this.prisma.message.groupBy({
      by: ['channelId'],
      where: {
        deletedAt: null,
        parentId: null,
        OR: memberships.map((row) => ({
          channelId: row.channelId,
          seq: { gt: row.lastReadSeq },
        })),
      },
      _count: { _all: true },
    });

    return new Map(grouped.map((row) => [row.channelId, row._count._all]));
  }

  private async unreadCount(
    channelId: string,
    lastReadSeq: number,
  ): Promise<number> {
    return this.prisma.message.count({
      where: {
        channelId,
        seq: { gt: lastReadSeq },
        deletedAt: null,
        // ไม่นับข้อความในเธรด เพราะ badge นี้หมายถึงไทม์ไลน์หลัก
        // ถ้านับด้วย ผู้ใช้จะเห็นเลข 1 แล้วเปิดห้องมาไม่พบอะไรใหม่เลย
        // คำตอบในเธรดถึงเจ้าของกระทู้ทางการแจ้งเตือน THREAD_REPLY อยู่แล้ว
        parentId: null,
      },
    });
  }
}
