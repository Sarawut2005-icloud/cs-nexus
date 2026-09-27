import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { CoreHubUser } from '../../common/auth/core-user.js';
import { Paginated } from '../../common/http/envelope.js';
import { PaginationQuery } from '../../common/http/pagination.dto.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { FollowsService } from '../follows/follows.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { ReactionsService } from '../reactions/reactions.service.js';
import {
  CreateCommentDto,
  CreatePostDto,
  ListPostsQuery,
  PostCommentResponseDto,
  PostResponseDto,
  toCommentResponse,
  toPostResponse,
} from './dto/post.dto.js';

@Injectable()
export class PostsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly follows: FollowsService,
    private readonly reactions: ReactionsService,
  ) {}

  async list(
    user: CoreHubUser,
    query: ListPostsQuery,
  ): Promise<Paginated<PostResponseDto>> {
    const where = await this.feedWhere(user, query);

    const [rows, total] = await Promise.all([
      this.prisma.post.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: query.skip,
        take: query.take,
      }),
      this.prisma.post.count({ where }),
    ]);

    // ยอดรีแอ็กชันของทั้งหน้าดึงมาในสองคิวรี ไม่ใช่ทีละโพสต์
    // (ดู ReactionsService.summariesFor — กัน N+1 ตอนโหลดฟีด)
    const summaries = await this.reactions.summariesFor(
      user,
      'POST',
      rows.map((row) => row.id),
    );

    return new Paginated(
      rows.map((row, index) => toPostResponse(row, summaries[index])),
      query.meta(total),
    );
  }

  async findOne(user: CoreHubUser, id: string): Promise<PostResponseDto> {
    const post = await this.prisma.post.findUnique({ where: { id } });

    if (!post) {
      throw new NotFoundException('ไม่พบโพสต์นี้ อาจถูกลบไปแล้ว');
    }

    const summary = await this.reactions.summaryFor(user, {
      target_kind: 'POST',
      target_id: id,
    });

    return toPostResponse(post, summary);
  }

  /// เงื่อนไขของกระดาน — ทั้งหมด เฉพาะคนที่ติดตาม หรือของคนคนเดียว
  private async feedWhere(user: CoreHubUser, query: ListPostsQuery) {
    if (query.author_core_user_id) {
      return { authorCoreUserId: query.author_core_user_id };
    }

    if (query.feed === 'following') {
      const coreUserIds = await this.follows.followingCoreUserIds(user);

      return {
        authorCoreUserId: { in: coreUserIds },
        ...(query.course_tag ? { courseTag: query.course_tag } : {}),
      };
    }

    return query.course_tag ? { courseTag: query.course_tag } : {};
  }

  async create(
    user: CoreHubUser,
    dto: CreatePostDto,
  ): Promise<PostResponseDto> {
    const post = await this.prisma.post.create({
      data: {
        title: dto.title,
        content: dto.content,
        courseTag: dto.course_tag ?? null,
        authorCoreUserId: user.coreUserId,
      },
    });

    return toPostResponse(post);
  }


  async remove(user: CoreHubUser, id: string): Promise<void> {
    const post = await this.prisma.post.findUnique({ where: { id } });

    if (!post) {
      throw new NotFoundException('ไม่พบโพสต์นี้');
    }

    const isOwner = post.authorCoreUserId === user.coreUserId;
    // บุคลากรและผู้ดูแลลบได้ เพราะกระดานข่าวเป็นพื้นที่ทางการของสาขา
    const canModerate =
      user.coreRole === 'admin' || user.coreRole === 'staff';

    if (!isOwner && !canModerate) {
      throw new ForbiddenException('ลบได้เฉพาะโพสต์ของตัวเอง');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.post.delete({ where: { id } });

      await tx.auditLog.create({
        data: {
          actorCoreUserId: user.coreUserId,
          actorCoreRole: user.coreRole,
          action: 'post.delete',
          targetKind: 'POST',
          targetId: id,
          metadata: {
            author_core_user_id: post.authorCoreUserId,
            by_moderator: !isOwner,
          },
        },
      });
    });
  }

  async listComments(
    postId: string,
    query: PaginationQuery,
  ): Promise<Paginated<PostCommentResponseDto>> {
    await this.assertPostExists(postId);

    const where = { postId, deletedAt: null };

    const [rows, total] = await Promise.all([
      this.prisma.postComment.findMany({
        where,
        orderBy: { createdAt: 'asc' }, // การถามตอบอ่านจากเก่าไปใหม่จึงเข้าใจง่ายกว่า
        skip: query.skip,
        take: query.take,
      }),
      this.prisma.postComment.count({ where }),
    ]);

    return new Paginated(rows.map(toCommentResponse), query.meta(total));
  }

  /// สร้างคอมเมนต์และเพิ่มตัวนับในทรานแซกชันเดียว
  /// ถ้าแยกกัน ตัวนับจะเพี้ยนทันทีที่มีการเขียนพร้อมกันสองคน
  async addComment(
    user: CoreHubUser,
    postId: string,
    dto: CreateCommentDto,
  ): Promise<PostCommentResponseDto> {
    await this.assertPostExists(postId);

    const comment = await this.prisma.$transaction(async (tx) => {
      const created = await tx.postComment.create({
        data: {
          postId,
          authorCoreUserId: user.coreUserId,
          content: dto.content,
        },
      });

      await tx.post.update({
        where: { id: postId },
        data: { commentCount: { increment: 1 } },
      });

      return created;
    });

    const post = await this.prisma.post.findUniqueOrThrow({
      where: { id: postId },
      select: { authorCoreUserId: true, title: true },
    });

    await this.notifications.push({
      coreUserId: post.authorCoreUserId,
      kind: 'POST_COMMENT',
      refId: postId,
      actorCoreUserId: user.coreUserId,
      payload: { preview: dto.content.slice(0, 120), title: post.title },
    });

    return toCommentResponse(comment);
  }

  async removeComment(
    user: CoreHubUser,
    postId: string,
    commentId: string,
  ): Promise<void> {
    const comment = await this.prisma.postComment.findFirst({
      where: { id: commentId, postId, deletedAt: null },
    });

    if (!comment) {
      throw new NotFoundException('ไม่พบความคิดเห็นนี้');
    }

    const isOwner = comment.authorCoreUserId === user.coreUserId;
    const canModerate =
      user.coreRole === 'admin' || user.coreRole === 'staff';

    if (!isOwner && !canModerate) {
      throw new ForbiddenException('ลบได้เฉพาะความคิดเห็นของตัวเอง');
    }

    // ลบแบบทิ้งร่องรอย และลดตัวนับให้ตรงกับจำนวนที่แสดงจริง
    await this.prisma.$transaction(async (tx) => {
      await tx.postComment.update({
        where: { id: commentId },
        data: { deletedAt: new Date() },
      });

      await tx.post.update({
        where: { id: postId },
        data: { commentCount: { decrement: 1 } },
      });
    });
  }

  private async assertPostExists(postId: string): Promise<void> {
    const post = await this.prisma.post.findUnique({
      where: { id: postId },
      select: { id: true },
    });

    if (!post) {
      throw new NotFoundException('ไม่พบโพสต์นี้');
    }
  }
}
