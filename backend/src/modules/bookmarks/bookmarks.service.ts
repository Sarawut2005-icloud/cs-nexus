import { Injectable, NotFoundException } from '@nestjs/common';
import type { GatewayUser } from '../../common/auth/gateway-user.js';
import { Paginated } from '../../common/http/envelope.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import {
  BookmarkResponseDto,
  CreateBookmarkDto,
  ListBookmarksQuery,
} from './dto/bookmark.dto.js';

@Injectable()
export class BookmarksService {
  constructor(private readonly prisma: PrismaService) {}

  async add(
    user: GatewayUser,
    dto: CreateBookmarkDto,
  ): Promise<BookmarkResponseDto> {
    await this.assertTargetExists(dto);

    const row = await this.prisma.bookmark.upsert({
      where: {
        username_targetKind_targetId: {
          username: user.username,
          targetKind: dto.target_kind,
          targetId: dto.target_id,
        },
      },
      create: {
        username: user.username,
        targetKind: dto.target_kind,
        targetId: dto.target_id,
      },
      update: {},
    });

    const [enriched] = await this.enrich([row]);

    return enriched;
  }

  async remove(user: GatewayUser, dto: CreateBookmarkDto): Promise<void> {
    await this.prisma.bookmark.deleteMany({
      where: {
        username: user.username,
        targetKind: dto.target_kind,
        targetId: dto.target_id,
      },
    });
  }

  /// รายการที่บันทึกไว้ของฉัน
  ///
  /// where ผูกกับ username เสมอ — ตารางนี้ไม่มี endpoint ไหนที่ให้ดูของคนอื่น
  /// เพราะ "สิ่งที่คนหนึ่งเก็บไว้อ่าน" เป็นข้อมูลส่วนตัวพอ ๆ กับประวัติการค้นหา
  async listMine(
    user: GatewayUser,
    query: ListBookmarksQuery,
  ): Promise<Paginated<BookmarkResponseDto>> {
    const where = {
      username: user.username,
      ...(query.target_kind ? { targetKind: query.target_kind } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.bookmark.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: query.skip,
        take: query.take,
      }),
      this.prisma.bookmark.count({ where }),
    ]);

    return new Paginated(await this.enrich(rows), query.meta(total));
  }

  /// เติมหัวข้อและชื่อผู้เขียนให้รายการที่บันทึกไว้
  ///
  /// ทำในสองคิวรี (โพสต์ชุดหนึ่ง คลิปชุดหนึ่ง) ไม่ใช่ทีละแถว
  /// ของที่ถูกลบไปแล้วคืน title = null แทนที่จะหายไปจากรายการเงียบ ๆ
  /// เพื่อให้หน้าบ้านบอกผู้ใช้ได้ว่า "รายการนี้ถูกลบแล้ว" และให้เขากดลบทิ้งได้
  private async enrich(
    rows: { targetKind: string; targetId: string; createdAt: Date }[],
  ): Promise<BookmarkResponseDto[]> {
    const postIds = rows
      .filter((row) => row.targetKind === 'POST')
      .map((row) => row.targetId);
    const reelIds = rows
      .filter((row) => row.targetKind === 'REEL')
      .map((row) => row.targetId);

    const [posts, reels] = await Promise.all([
      postIds.length
        ? this.prisma.post.findMany({
            where: { id: { in: postIds } },
            select: { id: true, title: true, authorUsername: true },
          })
        : Promise.resolve([]),
      reelIds.length
        ? this.prisma.reel.findMany({
            where: { id: { in: reelIds } },
            select: { id: true, title: true, authorUsername: true },
          })
        : Promise.resolve([]),
    ]);

    const index = new Map(
      [...posts, ...reels].map((item) => [item.id, item]),
    );

    return rows.map((row) => {
      const found = index.get(row.targetId);

      return {
        target_kind: row.targetKind as BookmarkResponseDto['target_kind'],
        target_id: row.targetId,
        title: found?.title ?? null,
        author_username: found?.authorUsername ?? null,
        created_at: row.createdAt.toISOString(),
      };
    });
  }

  private async assertTargetExists(dto: CreateBookmarkDto): Promise<void> {
    const found =
      dto.target_kind === 'POST'
        ? await this.prisma.post.findUnique({
            where: { id: dto.target_id },
            select: { id: true },
          })
        : await this.prisma.reel.findUnique({
            where: { id: dto.target_id },
            select: { id: true },
          });

    if (!found) {
      throw new NotFoundException('ไม่พบสิ่งที่จะบันทึก');
    }
  }
}
