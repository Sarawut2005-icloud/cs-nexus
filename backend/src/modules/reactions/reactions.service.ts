import { Injectable, NotFoundException } from '@nestjs/common';
import type { GatewayUser } from '../../common/auth/gateway-user.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { RealtimeBus } from '../../common/realtime/realtime-bus.js';
import type { ReactionTarget } from '../../generated/prisma/enums.js';
import { ChannelsService } from '../channels/channels.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import {
  ReactDto,
  ReactionSummaryDto,
  ReactionTargetQuery,
} from './dto/reaction.dto.js';

/// เจ้าของของเป้าหมาย ใช้ตัดสินว่าจะแจ้งเตือนใคร
interface TargetOwner {
  ownerUsername: string;
  /// บริบทที่ใส่ลง payload ของแจ้งเตือน เพื่อให้หน้าบ้านพาไปหน้าที่ถูกต้องได้
  context: Record<string, unknown>;
  /// ห้องที่ต้องกระจายแถบรีแอ็กชันใหม่เข้าไป มีเฉพาะเป้าหมายที่เป็นข้อความ
  channelId?: string;
}

@Injectable()
export class ReactionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly channels: ChannelsService,
    private readonly bus: RealtimeBus,
  ) {}

  /// กดอิโมจิ — กดซ้ำอิโมจิเดิมไม่เพิ่มยอดและไม่แจ้งเตือนซ้ำ
  ///
  /// คนหนึ่งกดได้หลายอิโมจิบนของชิ้นเดียว (แบบ Discord/Teams) ไม่ใช่แบบ
  /// Facebook ที่เลือกได้อย่างเดียว เพราะกฎ unique อยู่ที่
  /// (target, user, emoji) ไม่ใช่ (target, user)
  async react(user: GatewayUser, dto: ReactDto): Promise<ReactionSummaryDto> {
    const owner = await this.resolveTarget(user, dto.target_kind, dto.target_id);

    const result = await this.prisma.reaction.createMany({
      data: [
        {
          targetKind: dto.target_kind,
          targetId: dto.target_id,
          username: user.username,
          emoji: dto.emoji,
        },
      ],
      skipDuplicates: true,
    });

    if (result.count > 0) {
      await this.notifications.push({
        username: owner.ownerUsername,
        kind: 'REACTION',
        refId: dto.target_id,
        actorUsername: user.username,
        payload: {
          target_kind: dto.target_kind,
          emoji: dto.emoji,
          ...owner.context,
        },
      });
    }

    return this.publishSummary(user, dto, owner.channelId);
  }

  async unreact(
    user: GatewayUser,
    dto: ReactDto,
  ): Promise<ReactionSummaryDto> {
    // ตรวจสิทธิ์ตอนถอนด้วย ไม่ใช่แค่ตอนกด — คนที่ถูกเชิญออกจากห้องแล้ว
    // ไม่ควรยังยิงคำสั่งเข้าห้องนั้นได้อีก
    const owner = await this.resolveTarget(user, dto.target_kind, dto.target_id);

    await this.prisma.reaction.deleteMany({
      where: {
        targetKind: dto.target_kind,
        targetId: dto.target_id,
        username: user.username,
        emoji: dto.emoji,
      },
    });

    return this.publishSummary(user, dto, owner.channelId);
  }

  /// คืนยอดล่าสุดให้คนกด และกระจายยอดชุดเดียวกันให้คนอื่นในห้องเห็นทันที
  ///
  /// แถบรีแอ็กชันที่ไม่อัปเดตสดคือจุดที่ผู้ใช้กดซ้ำเพราะคิดว่าไม่ติด
  private async publishSummary(
    user: GatewayUser,
    dto: ReactDto,
    channelId?: string,
  ): Promise<ReactionSummaryDto> {
    const summary = await this.summaryFor(user, dto);

    if (channelId) {
      this.bus.pushToRoom({
        room: channelId,
        event: 'reaction:changed',
        payload: { channel_id: channelId, ...summary },
      });
    }

    return summary;
  }

  async summaryFor(
    user: GatewayUser,
    target: ReactionTargetQuery,
  ): Promise<ReactionSummaryDto> {
    const [summaries] = await this.summariesFor(
      user,
      target.target_kind,
      [target.target_id],
    );

    return (
      summaries ?? {
        target_kind: target.target_kind,
        target_id: target.target_id,
        totals: [],
        total_count: 0,
      }
    );
  }

  /// นับรีแอ็กชันของหลายเป้าหมายในสองคิวรี
  ///
  /// ฟีดหนึ่งหน้ามี 20 โพสต์ ถ้าเรียก summaryFor ทีละอันจะได้ 40 คิวรี
  /// ต่อการโหลดฟีดหนึ่งครั้ง — นี่คือ N+1 ที่ทำให้ฟีดช้าแบบหาสาเหตุไม่เจอ
  /// เมธอดนี้จึงรับหลาย id พร้อมกันแล้วให้ groupBy ทำงานทีเดียว
  async summariesFor(
    user: GatewayUser,
    targetKind: ReactionTarget,
    targetIds: string[],
  ): Promise<ReactionSummaryDto[]> {
    if (targetIds.length === 0) {
      return [];
    }

    // ข้อความแชทต้องกรองด้วยการเป็นสมาชิกห้องก่อนนับ
    //
    // ทางเขียน (resolveTarget) เช็คไว้แล้ว แต่ **ทางอ่านไม่เคยเช็คเลย** —
    // ใครก็ตามที่รู้หรือเดา message id ถูก ยิง
    // GET /reactions?target_kind=MESSAGE&target_id=... ได้ยอดอิโมจิของ
    // ห้องส่วนตัวที่ตัวเองไม่ได้อยู่ รวมถึงห้องที่เคยอยู่แล้วออกไปแล้วด้วย
    // และยังใช้ยืนยันได้ว่า id นั้นมีอยู่จริง
    //
    // ใช้คิวรีเดียวด้วย relation filter ไม่ใช่ไล่ถามทีละ id
    const visibleIds =
      targetKind === 'MESSAGE'
        ? await this.visibleMessageIds(user, targetIds)
        : targetIds;

    if (visibleIds.length === 0) {
      return [];
    }

    const [grouped, mine] = await Promise.all([
      this.prisma.reaction.groupBy({
        by: ['targetId', 'emoji'],
        where: { targetKind, targetId: { in: visibleIds } },
        _count: { username: true },
      }),
      this.prisma.reaction.findMany({
        where: {
          targetKind,
          targetId: { in: visibleIds },
          username: user.username,
        },
        select: { targetId: true, emoji: true },
      }),
    ]);

    const minePerTarget = new Map<string, Set<string>>();

    for (const row of mine) {
      const set = minePerTarget.get(row.targetId) ?? new Set<string>();

      set.add(row.emoji);
      minePerTarget.set(row.targetId, set);
    }

    return visibleIds.map((targetId) => {
      const rows = grouped.filter((row) => row.targetId === targetId);
      const myEmoji = minePerTarget.get(targetId) ?? new Set<string>();

      const totals = rows
        .map((row) => ({
          emoji: row.emoji,
          count: row._count.username,
          reacted_by_me: myEmoji.has(row.emoji),
        }))
        .sort((a, b) => b.count - a.count || a.emoji.localeCompare(b.emoji));

      return {
        target_kind: targetKind,
        target_id: targetId,
        totals,
        total_count: totals.reduce((sum, row) => sum + row.count, 0),
      };
    });
  }

  /// คัดเฉพาะ message id ที่ผู้เรียกมีสิทธิ์เห็น — คิวรีเดียวสำหรับทั้งชุด
  private async visibleMessageIds(
    user: GatewayUser,
    ids: string[],
  ): Promise<string[]> {
    const rows = await this.prisma.message.findMany({
      where: {
        id: { in: ids },
        deletedAt: null,
        channel: { members: { some: { username: user.username } } },
      },
      select: { id: true },
    });

    return rows.map((row) => row.id);
  }

  /// ตรวจว่าเป้าหมายมีจริงและหาเจ้าของ
  ///
  /// จำเป็นเพราะตาราง reactions ใช้ targetId แบบ polymorphic จึงไม่มี
  /// foreign key ให้ฐานข้อมูลช่วยตรวจ ถ้าไม่เช็คที่นี่ จะกดรีแอ็กชันใส่ id
  /// ที่ไม่มีอยู่จริงได้ แล้วตารางจะค่อย ๆ เต็มไปด้วยแถวขยะที่ไม่มีใครลบ
  private async resolveTarget(
    user: GatewayUser,
    kind: ReactionTarget,
    id: string,
  ): Promise<TargetOwner> {
    if (kind === 'POST') {
      const post = await this.prisma.post.findUnique({
        where: { id },
        select: { authorUsername: true, title: true },
      });

      if (!post) {
        throw new NotFoundException('ไม่พบโพสต์ที่จะกดรีแอ็กชัน');
      }

      return {
        ownerUsername: post.authorUsername,
        context: { preview: post.title },
      };
    }

    if (kind === 'REEL') {
      const reel = await this.prisma.reel.findUnique({
        where: { id },
        select: { authorUsername: true, title: true },
      });

      if (!reel) {
        throw new NotFoundException('ไม่พบคลิปที่จะกดรีแอ็กชัน');
      }

      return {
        ownerUsername: reel.authorUsername,
        context: { preview: reel.title },
      };
    }

    const message = await this.prisma.message.findFirst({
      where: { id, deletedAt: null },
      select: { authorUsername: true, channelId: true, content: true },
    });

    if (!message) {
      throw new NotFoundException('ไม่พบข้อความที่จะกดรีแอ็กชัน');
    }

    // สำคัญ: ต้องเป็นสมาชิกห้องก่อนจึงกดรีแอ็กชันได้
    //
    // ถ้าไม่เช็ค คนนอกที่เดา message id ถูกจะกดอิโมจิใส่ห้องส่วนตัวของคนอื่นได้
    // ซึ่งทั้งกวนคนในห้องและยืนยันให้คนนอกรู้ว่าข้อความ id นั้นมีอยู่จริง
    // requireMembership คืน 404 ไม่ใช่ 403 จึงไม่หลุดข้อมูลว่าห้องมีจริง
    await this.channels.requireMembership(user, message.channelId);

    return {
      ownerUsername: message.authorUsername,
      channelId: message.channelId,
      context: {
        channel_id: message.channelId,
        preview: message.content?.slice(0, 80) ?? null,
      },
    };
  }
}
