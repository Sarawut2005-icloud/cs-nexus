import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { GatewayUser } from '../../common/auth/gateway-user.js';
import { Paginated } from '../../common/http/envelope.js';
import { PaginationQuery } from '../../common/http/pagination.dto.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { RealtimeBus } from '../../common/realtime/realtime-bus.js';
import { parseMentions } from '../../common/util/mentions.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { ChannelsService } from './channels.service.js';
import {
  EditMessageDto,
  ListMessagesQuery,
  MessageResponseDto,
  SendMessageDto,
} from './dto/message.dto.js';

/// ข้อความที่ดึงมาพร้อมของแนบ — รูปแบบเดียวที่ใช้ทั้ง REST และ socket
const MESSAGE_INCLUDE = {
  attachments: {
    select: {
      id: true,
      fileName: true,
      kind: true,
      mimeType: true,
      sizeBytes: true,
    },
  },
  embed: { select: { kind: true, refId: true } },
} as const;

/// เพดานข้อความปักหมุดต่อห้อง
///
/// ปักหมุดที่ไม่มีเพดานจะกลายเป็นรายการที่ยาวกว่าตัวแชทเอง แล้วไม่มีใครอ่าน
/// ห้าสิบคือจุดที่ยังเลื่อนหาได้ในแผงข้าง
const MAX_PINS_PER_CHANNEL = 50;

/// แก้ข้อความได้ภายในเวลานี้หลังส่ง
///
/// ไม่ให้แก้ได้ตลอดกาล เพราะการแก้ข้อความเก่าที่คนอื่นตอบไปแล้วทำให้บทสนทนา
/// ที่บันทึกไว้เปลี่ยนความหมายย้อนหลัง ซึ่งเป็นปัญหาจริงเวลาต้องย้อนดูข้อตกลง
const EDIT_WINDOW_MS = 15 * 60 * 1000;

@Injectable()
export class MessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly channels: ChannelsService,
    private readonly notifications: NotificationsService,
    private readonly bus: RealtimeBus,
  ) {}

  async list(
    user: GatewayUser,
    channelId: string,
    query: ListMessagesQuery,
  ): Promise<Paginated<MessageResponseDto>> {
    await this.channels.requireMembership(user, channelId);

    const where = {
      channelId,
      deletedAt: null,
      // ไทม์ไลน์หลักไม่รวมข้อความในเธรด — ถ้ารวม บทสนทนาย่อยยาว 40 ข้อความ
      // จะกลบห้องหลักทั้งห้อง (นี่คือเหตุผลที่ Discord แยกเธรดออกมา)
      parentId: null,
      ...(query.after_seq !== undefined
        ? { seq: { gt: query.after_seq } }
        : {}),
    };

    // after_seq ใช้ตอน socket หลุดแล้วต่อใหม่: เรียงจากเก่าไปใหม่เพื่อเติมช่วง
    // ที่ขาดตามลำดับ ส่วนการเปิดห้องปกติเรียงใหม่ไปเก่าเพื่อโหลดหน้าล่าสุดก่อน
    const ascending = query.after_seq !== undefined;

    const [rows, total] = await Promise.all([
      this.prisma.message.findMany({
        where,
        orderBy: { seq: ascending ? 'asc' : 'desc' },
        skip: query.skip,
        take: query.take,
        include: MESSAGE_INCLUDE,
      }),
      this.prisma.message.count({ where }),
    ]);

    return new Paginated(rows.map(toMessageResponse), query.meta(total));
  }

  /// ข้อความในเธรดหนึ่งเส้น เรียงจากเก่าไปใหม่
  async listThread(
    user: GatewayUser,
    channelId: string,
    parentId: string,
    query: PaginationQuery,
  ): Promise<Paginated<MessageResponseDto>> {
    await this.channels.requireMembership(user, channelId);

    const parent = await this.prisma.message.findFirst({
      where: { id: parentId, channelId },
      select: { id: true },
    });

    if (!parent) {
      throw new NotFoundException('ไม่พบข้อความต้นเธรดนี้');
    }

    const where = { parentId, deletedAt: null };

    const [rows, total] = await Promise.all([
      this.prisma.message.findMany({
        where,
        orderBy: { seq: 'asc' }, // การถามตอบอ่านจากเก่าไปใหม่จึงเข้าใจง่ายกว่า
        skip: query.skip,
        take: query.take,
        include: MESSAGE_INCLUDE,
      }),
      this.prisma.message.count({ where }),
    ]);

    return new Paginated(rows.map(toMessageResponse), query.meta(total));
  }

  async listPinned(
    user: GatewayUser,
    channelId: string,
    query: PaginationQuery,
  ): Promise<Paginated<MessageResponseDto>> {
    await this.channels.requireMembership(user, channelId);

    const where = { channelId, deletedAt: null, pinnedAt: { not: null } };

    const [rows, total] = await Promise.all([
      this.prisma.message.findMany({
        where,
        orderBy: { pinnedAt: 'desc' },
        skip: query.skip,
        take: query.take,
        include: MESSAGE_INCLUDE,
      }),
      this.prisma.message.count({ where }),
    ]);

    return new Paginated(rows.map(toMessageResponse), query.meta(total));
  }

  /// เขียนลงฐานข้อมูลให้เสร็จก่อน แล้วค่อยให้ชั้น socket เอาไป broadcast
  ///
  /// ลำดับนี้สำคัญ: ถ้า broadcast ก่อนแล้วเขียนพัง คนในห้องจะเห็นข้อความที่
  /// ไม่มีอยู่จริง และตอนรีเฟรชมันจะหายไป ซึ่งหาสาเหตุยากมาก
  async send(
    user: GatewayUser,
    channelId: string,
    dto: SendMessageDto,
  ): Promise<MessageResponseDto> {
    const membership = await this.channels.requireMembership(user, channelId);

    const hasContent = Boolean(dto.content?.trim());
    const hasAssets = Boolean(dto.asset_ids?.length);
    const hasEmbed = Boolean(dto.embed);

    if (!hasContent && !hasAssets && !hasEmbed) {
      throw new BadRequestException(
        'ข้อความว่างเปล่า — ต้องมีข้อความ ไฟล์แนบ หรือคลิปที่แชร์อย่างน้อยหนึ่งอย่าง',
      );
    }

    // ส่งซ้ำด้วย nonce เดิม (เน็ตกระตุกแล้ว client ลองใหม่) ให้คืนข้อความเดิม
    // ไม่ใช่สร้างใหม่ — นี่คือเหตุผลที่มี unique(channelId, author, nonce)
    const duplicate = await this.prisma.message.findUnique({
      where: {
        channelId_authorUsername_clientNonce: {
          channelId,
          authorUsername: user.username,
          clientNonce: dto.client_nonce,
        },
      },
      include: MESSAGE_INCLUDE,
    });

    if (duplicate) {
      return toMessageResponse(duplicate);
    }

    if (hasAssets) {
      await this.assertOwnedReadyAssets(user, dto.asset_ids!);
    }

    if (dto.embed) {
      await this.assertEmbedExists(dto.embed.kind, dto.embed.ref_id);
    }

    const parent = dto.parent_id
      ? await this.resolveThreadParent(channelId, dto.parent_id)
      : null;

    const message = await this.prisma.$transaction(async (tx) => {
      const created = await tx.message.create({
        data: {
          channelId,
          authorUsername: user.username,
          content: dto.content?.trim() || null,
          clientNonce: dto.client_nonce,
          parentId: parent?.id ?? null,
          ...(dto.embed
            ? {
                embed: {
                  create: { kind: dto.embed.kind, refId: dto.embed.ref_id },
                },
              }
            : {}),
          ...(hasAssets
            ? { attachments: { connect: dto.asset_ids!.map((id) => ({ id })) } }
            : {}),
        },
        include: MESSAGE_INCLUDE,
      });

      // นับจำนวนตอบกลับในทรานแซกชันเดียวกับการสร้าง ไม่งั้นตัวเลขจะเพี้ยน
      // ทันทีที่มีสองคนตอบเธรดเดียวกันพร้อมกัน
      if (parent) {
        await tx.message.update({
          where: { id: parent.id },
          data: { replyCount: { increment: 1 } },
        });
      }

      return created;
    });

    await this.notifyThreadReply(user, channelId, parent);
    await this.notifyMentions(user, channelId, message.id, dto.content, {
      isModerator: membership.role === 'MODERATOR',
    });

    return toMessageResponse(message);
  }

  /// แก้ข้อความของตัวเองภายในหน้าต่างเวลาที่กำหนด
  ///
  /// ผู้ดูแลห้องแก้ข้อความคนอื่นไม่ได้โดยตั้งใจ — ลบได้ แต่แก้ไม่ได้
  /// เพราะการแก้คำพูดของคนอื่นแล้วยังแสดงชื่อเขาเป็นผู้เขียนคือการปลอมคำพูด
  async edit(
    user: GatewayUser,
    channelId: string,
    messageId: string,
    dto: EditMessageDto,
  ): Promise<MessageResponseDto> {
    await this.channels.requireMembership(user, channelId);

    const message = await this.prisma.message.findFirst({
      where: { id: messageId, channelId, deletedAt: null },
      select: { authorUsername: true, createdAt: true },
    });

    if (!message) {
      throw new NotFoundException('ไม่พบข้อความนี้');
    }

    if (message.authorUsername !== user.username) {
      throw new ForbiddenException('แก้ได้เฉพาะข้อความของตัวเอง');
    }

    if (Date.now() - message.createdAt.getTime() > EDIT_WINDOW_MS) {
      throw new BadRequestException(
        'แก้ข้อความได้ภายใน 15 นาทีหลังส่ง — เกินกว่านั้นให้ส่งข้อความใหม่แทน',
      );
    }

    const updated = await this.prisma.message.update({
      where: { id: messageId },
      data: { content: dto.content.trim(), editedAt: new Date() },
      include: MESSAGE_INCLUDE,
    });

    const response = toMessageResponse(updated);

    this.bus.pushToRoom({
      room: channelId,
      event: 'message:edited',
      payload: response,
    });

    return response;
  }

  /// ปักหมุด — ผู้ดูแลห้อง อาจารย์ หรือผู้ดูแลระดับองค์กรเท่านั้น
  ///
  /// ไม่เปิดให้เจ้าของข้อความปักหมุดของตัวเอง เพราะหมุดคือแผงประกาศของห้อง
  /// ถ้าใครก็ปักได้ มันจะกลายเป็นที่แย่งพื้นที่กันเอง
  async setPinned(
    user: GatewayUser,
    channelId: string,
    messageId: string,
    pinned: boolean,
  ): Promise<MessageResponseDto> {
    const membership = await this.channels.requireMembership(user, channelId);

    const canPin =
      membership.role === 'MODERATOR' ||
      user.layer1Role === 'staff' ||
      user.layer1Role === 'admin';

    if (!canPin) {
      throw new ForbiddenException('ปักหมุดได้เฉพาะผู้ดูแลห้องและอาจารย์');
    }

    const message = await this.prisma.message.findFirst({
      where: { id: messageId, channelId, deletedAt: null },
      select: { id: true, pinnedAt: true },
    });

    if (!message) {
      throw new NotFoundException('ไม่พบข้อความนี้');
    }

    if (pinned && !message.pinnedAt) {
      const current = await this.prisma.message.count({
        where: { channelId, pinnedAt: { not: null }, deletedAt: null },
      });

      if (current >= MAX_PINS_PER_CHANNEL) {
        throw new BadRequestException(
          `ห้องนี้ปักหมุดครบ ${MAX_PINS_PER_CHANNEL} ข้อความแล้ว — ถอนหมุดเก่าก่อน`,
        );
      }
    }

    const updated = await this.prisma.message.update({
      where: { id: messageId },
      data: {
        pinnedAt: pinned ? new Date() : null,
        pinnedByUsername: pinned ? user.username : null,
      },
      include: MESSAGE_INCLUDE,
    });

    const response = toMessageResponse(updated);

    this.bus.pushToRoom({
      room: channelId,
      event: 'message:pinned',
      payload: response,
    });

    return response;
  }

  async remove(
    user: GatewayUser,
    channelId: string,
    messageId: string,
  ): Promise<void> {
    const membership = await this.channels.requireMembership(user, channelId);
    const message = await this.prisma.message.findFirst({
      where: { id: messageId, channelId, deletedAt: null },
    });

    if (!message) {
      throw new NotFoundException('ไม่พบข้อความนี้');
    }

    const isAuthor = message.authorUsername === user.username;
    const canModerate =
      membership.role === 'MODERATOR' || user.layer1Role === 'admin';

    if (!isAuthor && !canModerate) {
      throw new ForbiddenException('ลบได้เฉพาะข้อความของตัวเอง');
    }

    // ลบแบบทิ้งร่องรอย ไม่ลบแถวจริง เพื่อให้ Admin ตรวจย้อนหลังได้และเพื่อไม่ให้
    // ลำดับ seq ของห้องขาดหาย
    await this.prisma.$transaction(async (tx) => {
      await tx.message.update({
        where: { id: messageId },
        data: { deletedAt: new Date(), content: null, pinnedAt: null },
      });

      // ข้อความที่ถูกลบไม่ควรนับเป็นคำตอบในเธรดต่อไป
      if (message.parentId) {
        await tx.message.update({
          where: { id: message.parentId },
          data: { replyCount: { decrement: 1 } },
        });
      }

      await tx.auditLog.create({
        data: {
          actorUsername: user.username,
          actorLayer1Role: user.layer1Role,
          action: 'message.delete',
          targetKind: 'MESSAGE',
          targetId: messageId,
          metadata: {
            channel_id: channelId,
            author_username: message.authorUsername,
            by_moderator: !isAuthor,
          },
        },
      });
    });
  }

  async latestSeq(channelId: string): Promise<number> {
    const latest = await this.prisma.message.findFirst({
      where: { channelId },
      orderBy: { seq: 'desc' },
      select: { seq: true },
    });

    return latest?.seq ?? 0;
  }

  /// ต้นเธรดต้องอยู่ห้องเดียวกัน ยังไม่ถูกลบ และตัวมันเองต้องไม่ใช่คำตอบ
  ///
  /// ห้ามเธรดซ้อนเธรดโดยตั้งใจ (Discord และ Teams ก็ไม่ให้) เพราะโครงสร้าง
  /// ที่ลึกได้ไม่จำกัดทำให้ทั้ง UI และการนับยังไม่อ่านซับซ้อนขึ้นแบบไม่คุ้ม
  private async resolveThreadParent(channelId: string, parentId: string) {
    const parent = await this.prisma.message.findFirst({
      where: { id: parentId, channelId, deletedAt: null },
      select: { id: true, parentId: true, authorUsername: true },
    });

    if (!parent) {
      throw new NotFoundException('ไม่พบข้อความที่จะตอบกลับ');
    }

    if (parent.parentId) {
      throw new BadRequestException(
        'ตอบกลับในเธรดซ้อนเธรดไม่ได้ — ตอบที่ข้อความต้นเธรดแทน',
      );
    }

    return parent;
  }

  private async notifyThreadReply(
    user: GatewayUser,
    channelId: string,
    parent: { id: string; authorUsername: string } | null,
  ): Promise<void> {
    if (!parent) {
      return;
    }

    await this.notifications.push({
      username: parent.authorUsername,
      kind: 'THREAD_REPLY',
      refId: parent.id,
      actorUsername: user.username,
      payload: { channel_id: channelId },
    });
  }

  /// แจ้งเตือนคนที่ถูก @ ในข้อความ
  ///
  /// สองข้อจำกัดที่จำเป็น:
  ///   1. แจ้งได้เฉพาะคนที่เป็นสมาชิกห้องนั้นอยู่แล้ว — ไม่ใช่ทุก username
  ///      ในระบบ ถ้าไม่กรอง จะ @ ใครก็ได้เพื่อส่งข้อความหาเขาผ่านช่องแจ้งเตือน
  ///      โดยที่เขาไม่ได้อยู่ในห้องและไม่มีทางบล็อก
  ///   2. @everyone สงวนให้ผู้ดูแลห้อง ไม่งั้นห้องเรียน 200 คนจะถูกปลุกได้
  ///      โดยนักศึกษาคนเดียว
  private async notifyMentions(
    user: GatewayUser,
    channelId: string,
    messageId: string,
    content: string | undefined,
    options: { isModerator: boolean },
  ): Promise<void> {
    const parsed = parseMentions(content, user.username);

    if (parsed.usernames.length === 0 && !parsed.broadcast) {
      return;
    }

    const members = await this.prisma.channelMember.findMany({
      where: { channelId },
      select: { username: true },
    });

    const memberNames = new Set(members.map((m) => m.username));

    const targets =
      parsed.broadcast && options.isModerator
        ? members
            .map((m) => m.username)
            .filter((name) => name !== user.username)
        : parsed.usernames.filter((name) => memberNames.has(name));

    if (targets.length === 0) {
      return;
    }

    await this.notifications.pushMany(targets, {
      kind: 'MENTION',
      refId: messageId,
      actorUsername: user.username,
      payload: {
        channel_id: channelId,
        preview: content?.slice(0, 120) ?? null,
        broadcast: parsed.broadcast && options.isModerator,
      },
    });
  }

  /// แนบได้เฉพาะไฟล์ของตัวเองที่ commit แล้ว และยังไม่ถูกแนบที่อื่น
  /// ถ้าไม่เช็ค จะเอา asset_id ของคนอื่นมาแนบแล้วดูดไฟล์เขาออกมาได้
  private async assertOwnedReadyAssets(
    user: GatewayUser,
    assetIds: string[],
  ): Promise<void> {
    const assets = await this.prisma.asset.findMany({
      where: { id: { in: assetIds } },
      select: {
        id: true,
        ownerUsername: true,
        status: true,
        messageId: true,
      },
    });

    if (assets.length !== assetIds.length) {
      throw new BadRequestException('มีไฟล์แนบบางรายการที่ไม่มีอยู่จริง');
    }

    for (const asset of assets) {
      if (asset.ownerUsername !== user.username) {
        throw new ForbiddenException('แนบไฟล์ของคนอื่นไม่ได้');
      }

      if (asset.status !== 'READY') {
        throw new BadRequestException(
          'มีไฟล์ที่ยังอัปโหลดไม่เสร็จ — เรียก commit ให้สำเร็จก่อน',
        );
      }

      if (asset.messageId) {
        throw new BadRequestException(
          'ไฟล์นี้ถูกแนบในข้อความอื่นไปแล้ว อัปโหลดใหม่ถ้าต้องการส่งซ้ำ',
        );
      }
    }
  }

  private async assertEmbedExists(
    kind: 'REEL' | 'POST',
    refId: string,
  ): Promise<void> {
    const found =
      kind === 'REEL'
        ? await this.prisma.reel.findUnique({
            where: { id: refId },
            select: { id: true },
          })
        : await this.prisma.post.findUnique({
            where: { id: refId },
            select: { id: true },
          });

    if (!found) {
      throw new NotFoundException(
        kind === 'REEL' ? 'ไม่พบคลิปที่จะแชร์' : 'ไม่พบโพสต์ที่จะแชร์',
      );
    }
  }
}

type MessageRow = {
  id: string;
  seq: number;
  channelId: string;
  authorUsername: string;
  content: string | null;
  clientNonce: string;
  parentId: string | null;
  replyCount: number;
  pinnedAt: Date | null;
  pinnedByUsername: string | null;
  editedAt: Date | null;
  createdAt: Date;
  attachments: {
    id: string;
    fileName: string;
    kind: string;
    mimeType: string;
    sizeBytes: bigint;
  }[];
  embed: { kind: string; refId: string } | null;
};

export function toMessageResponse(message: MessageRow): MessageResponseDto {
  return {
    id: message.id,
    seq: message.seq,
    channel_id: message.channelId,
    author_username: message.authorUsername,
    content: message.content,
    attachments: message.attachments.map((asset) => ({
      id: asset.id,
      file_name: asset.fileName,
      kind: asset.kind,
      mime_type: asset.mimeType,
      size_bytes: asset.sizeBytes.toString(),
    })),
    embed: message.embed
      ? { kind: message.embed.kind, ref_id: message.embed.refId }
      : null,
    parent_id: message.parentId,
    reply_count: message.replyCount,
    pinned_at: message.pinnedAt?.toISOString() ?? null,
    pinned_by_username: message.pinnedByUsername,
    client_nonce: message.clientNonce,
    edited_at: message.editedAt?.toISOString() ?? null,
    created_at: message.createdAt.toISOString(),
  };
}
