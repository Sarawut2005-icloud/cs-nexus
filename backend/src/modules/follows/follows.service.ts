import { BadRequestException, Injectable } from '@nestjs/common';
import type { GatewayUser } from '../../common/auth/gateway-user.js';
import { Paginated } from '../../common/http/envelope.js';
import { PaginationQuery } from '../../common/http/pagination.dto.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import {
  FollowEdgeDto,
  FollowStatsDto,
  RelationDto,
} from './dto/follow.dto.js';

/// เพดานจำนวนคนที่เอาไปกรองฟีด
///
/// ไม่ใช่เพดานจำนวนคนที่ติดตามได้ — แค่จำกัดว่าฟีดหนึ่งหน้าจะดูของกี่คน
const FEED_AUTHOR_LIMIT = 500;

@Injectable()
export class FollowsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /// กดติดตาม — กดซ้ำไม่ถือว่าผิด และไม่ยิงแจ้งเตือนซ้ำ
  ///
  /// ใช้ createMany + skipDuplicates แทน upsert เพราะเราต้องรู้ว่า
  /// "แถวนี้เพิ่งเกิดใหม่จริงไหม" ถ้าใช้ upsert จะแยกไม่ออกระหว่างกดครั้งแรก
  /// กับกดซ้ำ แล้วคนถูกติดตามจะโดนแจ้งเตือนทุกครั้งที่อีกฝ่ายกดปุ่มเล่น
  async follow(user: GatewayUser, target: string): Promise<RelationDto> {
    if (target === user.username) {
      throw new BadRequestException('ติดตามตัวเองไม่ได้');
    }

    const result = await this.prisma.follow.createMany({
      data: [{ followerUsername: user.username, followingUsername: target }],
      skipDuplicates: true,
    });

    if (result.count > 0) {
      await this.notifications.push({
        username: target,
        kind: 'FOLLOW',
        refId: user.username,
        actorUsername: user.username,
      });
    }

    return this.relationWith(user, target);
  }

  async unfollow(user: GatewayUser, target: string): Promise<RelationDto> {
    await this.prisma.follow.deleteMany({
      where: { followerUsername: user.username, followingUsername: target },
    });

    return this.relationWith(user, target);
  }

  async relationWith(
    user: GatewayUser,
    target: string,
  ): Promise<RelationDto> {
    if (target === user.username) {
      return { following: false, followed_by: false, mutual: false };
    }

    const edges = await this.prisma.follow.findMany({
      where: {
        OR: [
          { followerUsername: user.username, followingUsername: target },
          { followerUsername: target, followingUsername: user.username },
        ],
      },
      select: { followerUsername: true },
    });

    const following = edges.some((e) => e.followerUsername === user.username);
    const followedBy = edges.some((e) => e.followerUsername === target);

    return {
      following,
      followed_by: followedBy,
      mutual: following && followedBy,
    };
  }

  async stats(username: string): Promise<FollowStatsDto> {
    const [followerCount, followingCount] = await Promise.all([
      this.prisma.follow.count({ where: { followingUsername: username } }),
      this.prisma.follow.count({ where: { followerUsername: username } }),
    ]);

    return {
      follower_count: followerCount,
      following_count: followingCount,
    };
  }

  async followers(
    username: string,
    query: PaginationQuery,
  ): Promise<Paginated<FollowEdgeDto>> {
    const where = { followingUsername: username };

    const [rows, total] = await Promise.all([
      this.prisma.follow.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: query.skip,
        take: query.take,
      }),
      this.prisma.follow.count({ where }),
    ]);

    return new Paginated(
      rows.map((row) => ({
        username: row.followerUsername,
        created_at: row.createdAt.toISOString(),
      })),
      query.meta(total),
    );
  }

  async following(
    username: string,
    query: PaginationQuery,
  ): Promise<Paginated<FollowEdgeDto>> {
    const where = { followerUsername: username };

    const [rows, total] = await Promise.all([
      this.prisma.follow.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: query.skip,
        take: query.take,
      }),
      this.prisma.follow.count({ where }),
    ]);

    return new Paginated(
      rows.map((row) => ({
        username: row.followingUsername,
        created_at: row.createdAt.toISOString(),
      })),
      query.meta(total),
    );
  }

  /// รายชื่อคนที่ผู้ใช้ติดตาม ใช้เป็นตัวกรองของฟีด
  ///
  /// รวมตัวเองเข้าไปด้วยเสมอ เพราะฟีดที่ไม่มีโพสต์ของตัวเองเลยดูเหมือนระบบพัง
  /// (ทั้ง Facebook และ Instagram ก็ทำแบบนี้)
  async followingUsernames(user: GatewayUser): Promise<string[]> {
    // มีเพดาน เพราะรายชื่อนี้ถูกยัดลง `IN (...)` ของฟีดสามชุด
    //
    // บัญชีที่ติดตามกลับทั้งรุ่น (หลักพัน) จะสร้าง IN ที่มีสมาชิกหลักพันตัว
    // ต่อการโหลดฟีดหนึ่งครั้ง ซึ่งทั้งช้าและกินหน่วยความจำของฐานข้อมูล
    //
    // เอาคนที่ติดตามล่าสุดก่อน เพราะฟีดที่คนสนใจจริงมักเป็นคนกลุ่มนั้น
    const rows = await this.prisma.follow.findMany({
      where: { followerUsername: user.username },
      select: { followingUsername: true },
      orderBy: { createdAt: 'desc' },
      take: FEED_AUTHOR_LIMIT,
    });

    return [
      ...new Set([user.username, ...rows.map((r) => r.followingUsername)]),
    ];
  }

  /// คนที่ควรแนะนำให้ติดตาม
  ///
  /// เกณฑ์: คนที่ "คนที่เราติดตามอยู่" ติดตามอยู่ แต่เรายังไม่ได้ติดตาม
  /// เป็นเกณฑ์ friends-of-friends ที่ถูกที่สุด — คิวรีเดียว ไม่ต้องมีตัวจัดอันดับ
  /// ถ้าไม่พบเลย (ผู้ใช้ใหม่ที่ยังไม่ติดตามใคร) จะไม่ตกไปหาอันดับยอดนิยม
  /// เพราะการเดาแบบนั้นทำให้ทุกคนเห็นรายชื่อเดียวกันหมด
  async suggestions(
    user: GatewayUser,
    limit: number,
  ): Promise<{ username: string; mutual_count: number }[]> {
    const myFollowing = await this.prisma.follow.findMany({
      where: { followerUsername: user.username },
      select: { followingUsername: true },
    });

    if (myFollowing.length === 0) {
      return [];
    }

    const firstDegree = myFollowing.map((f) => f.followingUsername);

    const secondDegree = await this.prisma.follow.groupBy({
      by: ['followingUsername'],
      where: {
        followerUsername: { in: firstDegree },
        followingUsername: { notIn: [...firstDegree, user.username] },
      },
      _count: { followerUsername: true },
      orderBy: { _count: { followerUsername: 'desc' } },
      take: limit,
    });

    return secondDegree.map((row) => ({
      username: row.followingUsername,
      mutual_count: row._count.followerUsername,
    }));
  }
}
