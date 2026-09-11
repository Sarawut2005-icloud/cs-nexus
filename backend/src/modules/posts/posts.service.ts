import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { GatewayUser } from '../../common/auth/gateway-user.js';
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
    user: GatewayUser,
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

  async findOne(user: GatewayUser, id: string): Promise<PostResponseDto> {
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
  private async feedWhere(user: GatewayUser, query: ListPostsQuery) {
    if (query.author_username) {
      return { authorUsername: query.author_username };
    }

    if (query.feed === 'following') {
      const usernames = await this.follows.followingUsernames(user);

      return {
        authorUsername: { in: usernames },
        ...(query.course_tag ? { courseTag: query.course_tag } : {}),
      };
    }

    return query.course_tag ? { courseTag: query.course_tag } : {};
  }

  async create(
    user: GatewayUser,
    dto: CreatePostDto,
  ): Promise<PostResponseDto> {
    const post = await this.prisma.post.create({
      data: {
        title: dto.title,
        content: dto.content,
        courseTag: dto.course_tag ?? null,
        authorUsername: user.username,
      },
    });

    return toPostResponse(post);
  }


  async remove(user: GatewayUser, id: string): Promise<void> {
    const post = await this.prisma.post.findUnique({ where: { id } });

    if (!post) {
      throw new NotFoundException('ไม่พบโพสต์นี้');
    }

    const isOwner = post.authorUsername === user.username;
    // บุคลากรและผู้ดูแลลบได้ เพราะกระดานข่าวเป็นพื้นที่ทางการของสาขา
    const canModerate =
      user.layer1Role === 'admin' || user.layer1Role === 'staff';

    if (!isOwner && !canModerate) {
      throw new ForbiddenException('ลบได้เฉพาะโพสต์ของตัวเอง');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.post.delete({ where: { id } });

      await tx.auditLog.create({
        data: {
          actorUsername: user.username,
          actorLayer1Role: user.layer1Role,
          action: 'post.delete',
          targetKind: 'POST',
          targetId: id,
          metadata: {
            author_username: post.authorUsername,
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
    user: GatewayUser,
    postId: string,
    dto: CreateCommentDto,
  ): Promise<PostCommentResponseDto> {
    await this.assertPostExists(postId);

    const comment = await this.prisma.$transaction(async (tx) => {
      const created = await tx.postComment.create({
        data: {
          postId,
          authorUsername: user.username,
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
      select: { authorUsername: true, title: true },
    });

    await this.notifications.push({
      username: post.authorUsername,
      kind: 'POST_COMMENT',
      refId: postId,
      actorUsername: user.username,
      payload: { preview: dto.content.slice(0, 120), title: post.title },
    });

    return toCommentResponse(comment);
  }

  async removeComment(
    user: GatewayUser,
    postId: string,
    commentId: string,
  ): Promise<void> {
    const comment = await this.prisma.postComment.findFirst({
      where: { id: commentId, postId, deletedAt: null },
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
