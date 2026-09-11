import { Injectable, NotFoundException } from '@nestjs/common';
import type { GatewayUser } from '../../common/auth/gateway-user.js';
import { Paginated } from '../../common/http/envelope.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { RealtimeBus } from '../../common/realtime/realtime-bus.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { NotificationKind } from '../../generated/prisma/enums.js';
import {
  ListNotificationsQuery,
  NotificationResponseDto,
  toNotificationResponse,
  UnreadCountDto,
} from './dto/notification.dto.js';

export interface PushInput {
  /// ผู้รับ
  username: string;
  kind: NotificationKind;
  refId: string;
  actorUsername?: string;
  payload?: Record<string, unknown>;
}

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bus: RealtimeBus,
  ) {}

  /// สร้างแจ้งเตือนหนึ่งรายการแล้วผลักออกทาง socket ถ้าคนนั้นออนไลน์อยู่
  ///
  /// ไม่ throw เมื่อล้มเหลว — การแจ้งเตือนพลาดไม่ควรทำให้การกดไลก์หรือ
  /// การส่งข้อความล้มไปด้วย งานหลักสำเร็จไปแล้วก่อนจะมาถึงบรรทัดนี้
  async push(input: PushInput): Promise<void> {
    // ไม่แจ้งเตือนตัวเอง — คนกดรู้อยู่แล้วว่าตัวเองกดอะไร
    if (input.actorUsername === input.username) {
      return;
    }

    try {
      const row = await this.prisma.notification.create({
        data: {
          username: input.username,
          kind: input.kind,
          refId: input.refId,
          actorUsername: input.actorUsername ?? null,
          // cast เพราะชนิด JSON input ของ Prisma ไม่ยอมรับ null ที่ระดับ field
          // แต่ payload ของเรามี null ซ้อนอยู่ข้างในได้ตามปกติ (เช่น preview: null)
          // ซึ่ง Postgres เก็บเป็น JSON null ได้ถูกต้องอยู่แล้ว
          payload: input.payload as Prisma.InputJsonValue | undefined,
        },
      });

      this.bus.pushToUser({
        username: input.username,
        notification: {
          id: row.id,
          kind: row.kind,
          ref_id: row.refId,
          actor_username: row.actorUsername,
          payload: row.payload ?? null,
          created_at: row.createdAt.toISOString(),
        },
        unread_count: await this.rawUnreadCount(input.username),
      });
    } catch {
      // ตั้งใจกลืน — ดูเหตุผลใน doc comment ด้านบน
    }
  }

  /// แจ้งหลายคนพร้อมกัน เช่น @everyone ในห้อง หรือประกาศนัดประชุม
  async pushMany(
    usernames: string[],
    input: Omit<PushInput, 'username'>,
  ): Promise<void> {
    // ไม่เรียก push() ทีละคน
    //
    // push() หนึ่งครั้ง = insert หนึ่งครั้ง + COUNT หนึ่งครั้ง ห้องเรียน 200 คน
    // ที่มีคนพิมพ์ @everyone หรืออาจารย์กดนัดประชุม จึงยิงราว 400 คิวรี
    // ในคำขอเดียว — พอมีสองสามคนทำพร้อมกัน connection pool ก็หมด แล้วทั้ง
    // ระบบค้างตามไปด้วย ทั้งที่ต้นเหตุคือการแจ้งเตือนอย่างเดียว
    //
    // เขียนทีเดียวด้วย createMany แล้วนับยอดยังไม่อ่านของทุกคนในคิวรีเดียว
    const unique = [...new Set(usernames)].filter(
      (username) => username !== input.actorUsername,
    );

    if (unique.length === 0) {
      return;
    }

    try {
      await this.prisma.notification.createMany({
        data: unique.map((username) => ({
          username,
          kind: input.kind,
          refId: input.refId,
          actorUsername: input.actorUsername ?? null,
          payload: input.payload as Prisma.InputJsonValue | undefined,
        })),
      });

      // createMany ไม่คืนแถวที่สร้าง จึงอ่านกลับมาเพื่อส่งเข้า socket
      const rows = await this.prisma.notification.findMany({
        where: {
          username: { in: unique },
          kind: input.kind,
          refId: input.refId,
        },
        orderBy: { createdAt: 'desc' },
        take: unique.length,
      });

      const unreadPerUser = await this.prisma.notification.groupBy({
        by: ['username'],
        where: { username: { in: unique }, readAt: null },
        _count: { _all: true },
      });

      const unreadBy = new Map(
        unreadPerUser.map((row) => [row.username, row._count._all]),
      );

      for (const row of rows) {
        this.bus.pushToUser({
          username: row.username,
          notification: {
            id: row.id,
            kind: row.kind,
            ref_id: row.refId,
            actor_username: row.actorUsername,
            payload: row.payload ?? null,
            created_at: row.createdAt.toISOString(),
          },
          unread_count: unreadBy.get(row.username) ?? 0,
        });
      }
    } catch {
      // ตั้งใจกลืน — ดูเหตุผลใน doc comment ของ push()
    }
  }

  async list(
    user: GatewayUser,
    query: ListNotificationsQuery,
  ): Promise<Paginated<NotificationResponseDto>> {
    const where = {
      username: user.username,
      ...(query.unread_only === 'true' ? { readAt: null } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: query.skip,
        take: query.take,
      }),
      this.prisma.notification.count({ where }),
    ]);

    return new Paginated(rows.map(toNotificationResponse), query.meta(total));
  }

  async unreadCount(user: GatewayUser): Promise<UnreadCountDto> {
    return { unread_count: await this.rawUnreadCount(user.username) };
  }

  async markRead(user: GatewayUser, id: string): Promise<UnreadCountDto> {
    // ค้นด้วย username ด้วย เพื่อไม่ให้ mark แจ้งเตือนของคนอื่นได้
    const found = await this.prisma.notification.findFirst({
      where: { id, username: user.username },
      select: { id: true, readAt: true },
    });

    if (!found) {
      throw new NotFoundException('ไม่พบการแจ้งเตือนนี้');
    }

    if (!found.readAt) {
      await this.prisma.notification.update({
        where: { id },
        data: { readAt: new Date() },
      });
    }

    return { unread_count: await this.rawUnreadCount(user.username) };
  }

  async markAllRead(user: GatewayUser): Promise<{ marked: number }> {
    const result = await this.prisma.notification.updateMany({
      where: { username: user.username, readAt: null },
      data: { readAt: new Date() },
    });

    return { marked: result.count };
  }

  private rawUnreadCount(username: string): Promise<number> {
    return this.prisma.notification.count({
      where: { username, readAt: null },
    });
  }
}
