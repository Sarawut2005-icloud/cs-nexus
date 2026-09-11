import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { Paginated } from '../../common/http/envelope.js';
import { PaginationQuery } from '../../common/http/pagination.dto.js';
import type { GatewayUser } from '../../common/auth/gateway-user.js';
import { ApiProperty } from '@nestjs/swagger';
import { FollowsService } from '../follows/follows.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import {
  CreateReelDto,
  ListReelsQuery,
  ReelCommentResponseDto,
  ReelResponseDto,
  toReelCommentResponse,
  toReelResponse,
} from './dto/reel.dto.js';

/// payload ของ endpoint กดไลก์ — แยกเป็น class เพื่อให้โผล่ใน openapi.json
export class LikeCountDto {
  @ApiProperty({ example: 129 })
  like_count!: number;
}

export class ViewCountDto {
  @ApiProperty({
    example: 842,
    description: 'จำนวนคนที่เคยดู ไม่ใช่จำนวนครั้งที่เล่น — คนหนึ่งนับครั้งเดียว',
  })
  view_count!: number;
}

/// P2002 = unique constraint ของ Prisma
///
/// ตรวจด้วยรหัส ไม่ใช่ catch เปล่า ๆ เพราะ "ดูซ้ำ" กับ "ฐานข้อมูลล่ม"
/// ต้องไม่ถูกปฏิบัติเหมือนกัน
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}

@Injectable()
export class ReelsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly follows: FollowsService,
  ) {}

  async list(
    user: GatewayUser,
    query: ListReelsQuery,
  ): Promise<Paginated<ReelResponseDto>> {
    const where = await this.feedWhere(user, query);

    // มาตรฐานหน้า 7 บังคับ meta แบบ current_page/total_pages จึงต้องใช้
    // offset pagination ที่นี่ ทั้งที่ฟีดแบบเลื่อนไม่สุดควรใช้ cursor
    // TODO(PL): เสนอ PM ขอเพิ่ม cursor endpoint สำหรับฟีดวิดีโอและแชท
    const [rows, total] = await Promise.all([
      this.prisma.reel.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: query.skip,
        take: query.take,
      }),
      this.prisma.reel.count({ where }),
    ]);

    const likedIds = await this.likedReelIds(
      user.username,
      rows.map((row) => row.id),
    );

    return new Paginated(
      rows.map((row) =>
        toReelResponse(row, { likedByMe: likedIds.has(row.id) }),
      ),
      query.meta(total),
    );
  }

  async findOne(user: GatewayUser, id: string): Promise<ReelResponseDto> {
    const reel = await this.prisma.reel.findUnique({ where: { id } });

    if (!reel) {
      throw new NotFoundException('ไม่พบคลิปนี้ อาจถูกลบไปแล้ว');
    }

    const likedIds = await this.likedReelIds(user.username, [reel.id]);

    return toReelResponse(reel, { likedByMe: likedIds.has(reel.id) });
  }

  async create(
    user: GatewayUser,
    dto: CreateReelDto,
  ): Promise<ReelResponseDto> {
    const asset = await this.prisma.asset.findUnique({
      where: { id: dto.asset_id },
    });

    if (!asset) {
      throw new NotFoundException('ไม่พบไฟล์ที่อ้างถึง — อัปโหลดให้เสร็จก่อน');
    }

    // ห้ามเอาไฟล์ของคนอื่นมาโพสต์เป็นผลงานตัวเอง
    if (asset.ownerUsername !== user.username) {
      throw new ForbiddenException('ไฟล์นี้ไม่ใช่ของคุณ');
    }

    if (asset.status !== 'READY') {
      throw new BadRequestException(
        'ไฟล์ยังอัปโหลดไม่เสร็จ — เรียก /assets/{id}/commit ให้สำเร็จก่อน',
      );
    }

    if (asset.kind !== 'VIDEO') {
      throw new BadRequestException('คลิป Reels ต้องเป็นไฟล์วิดีโอ');
    }

    const reel = await this.prisma.reel.create({
      data: {
        title: dto.title,
        caption: dto.caption ?? null,
        assetId: dto.asset_id,
        durationMs: dto.duration_ms,
        authorUsername: user.username,
      },
    });

    return toReelResponse(reel, { likedByMe: false });
  }

  async remove(user: GatewayUser, id: string): Promise<void> {
    const reel = await this.prisma.reel.findUnique({ where: { id } });

    if (!reel) {
      throw new NotFoundException('ไม่พบคลิปนี้');
    }

    // เจ้าของลบได้ และ admin ระดับองค์กรลบได้เพื่อจัดการเนื้อหา
    const isOwner = reel.authorUsername === user.username;
    const isOrgAdmin = user.layer1Role === 'admin';

    if (!isOwner && !isOrgAdmin) {
      throw new ForbiddenException('ลบได้เฉพาะคลิปของตัวเอง');
    }

    await this.prisma.$transaction([
      this.prisma.reel.delete({ where: { id } }),
      this.prisma.auditLog.create({
        data: {
          actorUsername: user.username,
          actorLayer1Role: user.layer1Role,
          action: 'reel.delete',
          targetKind: 'REEL',
          targetId: id,
          metadata: { owner_username: reel.authorUsername, by_admin: !isOwner },
        },
      }),
    ]);
  }

  /// กดไลก์ซ้ำไม่เพิ่มยอด เพราะ primary key เป็น (reelId, username)
  /// ตัวนับเก็บไว้ล่วงหน้าเพื่อไม่ต้อง COUNT ทุกครั้งที่โหลดฟีด
  async like(user: GatewayUser, id: string): Promise<LikeCountDto> {
    await this.assertReelExists(id);

    const created = await this.prisma.reelLike
      .create({ data: { reelId: id, username: user.username } })
      .then(() => true)
      .catch(() => false);

    if (!created) {
      const reel = await this.prisma.reel.findUniqueOrThrow({ where: { id } });
      return { like_count: reel.likeCount };
    }

    const reel = await this.prisma.reel.update({
      where: { id },
      data: { likeCount: { increment: 1 } },
    });

    // แจ้งเฉพาะตอนไลก์ครั้งแรกจริง ๆ — โค้ดด้านบน return ไปก่อนแล้วถ้ากดซ้ำ
    // ไม่งั้นเจ้าของคลิปจะโดนแจ้งเตือนทุกครั้งที่มีคนกดปุ่มเล่น
    await this.notifications.push({
      username: reel.authorUsername,
      kind: 'REEL_LIKE',
      refId: reel.id,
      actorUsername: user.username,
      payload: { preview: reel.title },
    });

    return { like_count: reel.likeCount };
  }

  async unlike(user: GatewayUser, id: string): Promise<LikeCountDto> {
    await this.assertReelExists(id);

    const deleted = await this.prisma.reelLike
      .delete({ where: { reelId_username: { reelId: id, username: user.username } } })
      .then(() => true)
      .catch(() => false);

    if (!deleted) {
      const reel = await this.prisma.reel.findUniqueOrThrow({ where: { id } });
      return { like_count: reel.likeCount };
    }

    const reel = await this.prisma.reel.update({
      where: { id },
      data: { likeCount: { decrement: 1 } },
    });

    return { like_count: reel.likeCount };
  }

  /// บันทึกว่าผู้เรียกดูคลิปนี้แล้ว
  ///
  /// นับ "คนที่เคยดู" ไม่ใช่ "จำนวนครั้งที่เล่น" — คีย์ (reelId, username)
  /// ทำให้คนหนึ่งนับได้ครั้งเดียวตั้งแต่ระดับฐานข้อมูล จึงปั่นยอดด้วยการ
  /// กดรีเฟรชรัว ๆ ไม่ได้ และไม่ต้องเชื่อ client เรื่องการนับ
  ///
  /// ตัวนับ view_count เพิ่มในทรานแซกชันเดียวกับการสร้างแถวผู้ชม
  /// ไม่งั้นสองคนกดดูพร้อมกันแล้วตัวเลขจะหายไปหนึ่ง
  async markViewed(user: GatewayUser, id: string): Promise<ViewCountDto> {
    await this.assertReelExists(id);

    // แถวผู้ชมกับตัวนับต้องคอมมิตด้วยกันจริง ๆ
    //
    // คอมเมนต์ข้างบนอ้างว่าอยู่ในทรานแซกชันเดียวกันมาตลอด แต่โค้ดเดิมยิงสอง
    // คำสั่งแยกกัน ถ้าตัวที่สองล้ม (pool หมด · เน็ตสะดุด) จะเหลือแถวผู้ชมที่
    // ไม่เคยถูกนับ และเพราะคีย์ (reelId, username) กันไม่ให้ใส่ซ้ำ คนนั้นจึง
    // **ไม่มีทางถูกนับได้อีกเลย** ยอดวิวขาดหายถาวรโดยไม่มีใครรู้
    try {
      const reel = await this.prisma.$transaction(async (tx) => {
        await tx.reelView.create({
          data: { reelId: id, username: user.username },
        });

        return tx.reel.update({
          where: { id },
          data: { viewCount: { increment: 1 } },
          select: { viewCount: true },
        });
      });

      return { view_count: reel.viewCount };
    } catch (error) {
      // จับเฉพาะ "ดูซ้ำ" (ชนคีย์) ซึ่งถูกต้องแล้ว — ของเดิม catch เปล่า ๆ
      // กลืนทุก error รวมถึงฐานข้อมูลล่ม แล้วรายงานยอดเดิมกลับไปเหมือนปกติ
      if (!isUniqueViolation(error)) {
        throw error;
      }

      const reel = await this.prisma.reel.findUniqueOrThrow({
        where: { id },
        select: { viewCount: true },
      });

      return { view_count: reel.viewCount };
    }
  }

  /// คอมเมนต์ใต้คลิป — ตาราง reel_comments มีมาตั้งแต่ schema แรก
  /// แต่ยังไม่มี endpoint ให้ใช้ จนถึงรอบนี้
  async listComments(
    reelId: string,
    query: PaginationQuery,
  ): Promise<Paginated<ReelCommentResponseDto>> {
    await this.assertReelExists(reelId);

    const where = { reelId, deletedAt: null };

    const [rows, total] = await Promise.all([
      this.prisma.reelComment.findMany({
        where,
        orderBy: { createdAt: 'desc' }, // ใต้คลิปสั้นคนอ่านคอมเมนต์ใหม่สุดก่อน
        skip: query.skip,
        take: query.take,
      }),
      this.prisma.reelComment.count({ where }),
    ]);

    return new Paginated(rows.map(toReelCommentResponse), query.meta(total));
  }

  async addComment(
    user: GatewayUser,
    reelId: string,
    content: string,
  ): Promise<ReelCommentResponseDto> {
    const reel = await this.prisma.reel.findUnique({
      where: { id: reelId },
      select: { id: true, title: true, authorUsername: true },
    });

    if (!reel) {
      throw new NotFoundException('ไม่พบคลิปนี้');
    }

    const comment = await this.prisma.reelComment.create({
      data: { reelId, authorUsername: user.username, content },
    });

    await this.notifications.push({
      username: reel.authorUsername,
      kind: 'REEL_COMMENT',
      refId: reelId,
      actorUsername: user.username,
      payload: { preview: content.slice(0, 120) },
    });

    return toReelCommentResponse(comment);
  }

  async removeComment(
    user: GatewayUser,
    reelId: string,
    commentId: string,
  ): Promise<void> {
    const comment = await this.prisma.reelComment.findFirst({
      where: { id: commentId, reelId, deletedAt: null },
    });

    if (!comment) {
      throw new NotFoundException('ไม่พบความคิดเห็นนี้');
    }

    const isOwner = comment.authorUsername === user.username;
    const canModerate =
      user.layer1Role === 'admin' || user.layer1Role === 'staff';

    if (!isOwner && !canModerate) {
      throw new ForbiddenException('ลบได้เฉพาะความคิดเห็นของตัวเอง');
    }

    await this.prisma.reelComment.update({
      where: { id: commentId },
      data: { deletedAt: new Date() },
    });
  }

  /// เงื่อนไขของฟีด — ทั้งหมด เฉพาะคนที่ติดตาม หรือของคนคนเดียว
  ///
  /// feed=following คือฟีดแบบ Instagram/Facebook ส่วน author_username คือ
  /// หน้าโปรไฟล์ ทั้งสองใช้คิวรีเดียวกันเพราะต่างกันแค่เงื่อนไข where
  private async feedWhere(user: GatewayUser, query: ListReelsQuery) {
    if (query.author_username) {
      return { authorUsername: query.author_username };
    }

    if (query.feed === 'following') {
      const usernames = await this.follows.followingUsernames(user);

      return { authorUsername: { in: usernames } };
    }

    return {};
  }

  private async assertReelExists(id: string): Promise<void> {
    const exists = await this.prisma.reel.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!exists) {
      throw new NotFoundException('ไม่พบคลิปนี้');
    }
  }

  private async likedReelIds(
    username: string,
    reelIds: string[],
  ): Promise<Set<string>> {
    if (reelIds.length === 0) {
      return new Set();
    }

    const likes = await this.prisma.reelLike.findMany({
      where: { username, reelId: { in: reelIds } },
      select: { reelId: true },
    });

    return new Set(likes.map((like) => like.reelId));
  }
}
