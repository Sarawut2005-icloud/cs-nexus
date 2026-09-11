import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { GatewayUser } from '../../common/auth/gateway-user.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import {
  STORAGE_PROVIDER,
  type StorageProvider,
} from '../../common/storage/storage.provider.js';
import { FollowsService } from '../follows/follows.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import {
  STORY_TTL_MS,
  StoryItemDto,
  StoryTrayDto,
  StoryViewerDto,
  type CreateStoryDto,
} from './dto/story.dto.js';

/// อายุของ signed URL ที่แนบไปกับรายการสตอรี่
///
/// ยาวกว่าของไฟล์แนบทั่วไป (120 วินาที) เพราะแถวสตอรี่ถูกโหลดตอนเปิดฟีด
/// แล้วผู้ใช้อาจเลื่อนอ่านฟีดสักพักก่อนกดดู — 120 วินาทีจะหมดอายุก่อนถึงมือ
/// ห้านาทีคือจุดที่พอสำหรับพฤติกรรมจริง โดยที่ลิงก์ยังรั่วไปใช้ต่อนานไม่ได้
const STORY_URL_TTL_SECONDS = 300;

/// เพดานจำนวนสตอรี่ที่ดึงมาแสดงในแถวบนสุดหนึ่งครั้ง
///
/// ไม่ใช่เพดานจำนวนที่โพสต์ได้ — แค่จำกัดว่าหนึ่งหน้าจอจะโหลดมากี่ชิ้น
const TRAY_STORY_LIMIT = 300;

@Injectable()
export class StoriesService {
  private readonly logger = new Logger(StoriesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly follows: FollowsService,
    private readonly notifications: NotificationsService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  /// โพสต์สตอรี่จากไฟล์ที่อัปโหลดเสร็จแล้ว
  ///
  /// ตรวจสามอย่างที่ท่ออัปโหลดตรวจไม่ได้แทนเรา:
  ///   1. ไฟล์เป็นของผู้เรียกจริง — ไม่งั้นเอา asset_id ของคนอื่นมาโพสต์ได้
  ///   2. commit แล้ว (READY) — ไม่งั้นสตอรี่จะชี้ไปที่ไฟล์ที่ยังไม่มีเนื้อ
  ///   3. ยังไม่ถูกใช้ที่อื่น — unique(assetId) กันไว้ที่ระดับฐานข้อมูลอีกชั้น
  async create(user: GatewayUser, dto: CreateStoryDto): Promise<StoryItemDto> {
    const asset = await this.prisma.asset.findUnique({
      where: { id: dto.asset_id },
      include: { reel: { select: { id: true } }, story: { select: { id: true } } },
    });

    if (!asset) {
      throw new NotFoundException('ไม่พบไฟล์นี้');
    }

    if (asset.ownerUsername !== user.username) {
      throw new ForbiddenException('โพสต์สตอรี่จากไฟล์ของคนอื่นไม่ได้');
    }

    if (asset.status !== 'READY') {
      throw new BadRequestException(
        'ไฟล์ยังอัปโหลดไม่เสร็จ — เรียก commit ให้สำเร็จก่อน',
      );
    }

    if (asset.kind !== 'IMAGE' && asset.kind !== 'VIDEO') {
      throw new BadRequestException('สตอรี่รับเฉพาะรูปภาพและวิดีโอ');
    }

    if (asset.reel || asset.story) {
      throw new BadRequestException(
        'ไฟล์นี้ถูกใช้ไปแล้ว — อัปโหลดใหม่ถ้าต้องการโพสต์ซ้ำ',
      );
    }

    const story = await this.prisma.story.create({
      data: {
        authorUsername: user.username,
        assetId: asset.id,
        caption: dto.caption ?? null,
        expiresAt: new Date(Date.now() + STORY_TTL_MS),
      },
    });

    // แจ้งคนที่ติดตามเราว่ามีสตอรี่ใหม่
    //
    // ตั้งใจไม่แจ้งถ้าผู้ติดตามเกิน 50 คน เพราะสตอรี่เป็นของที่โพสต์บ่อย
    // วันละหลายครั้ง ถ้าแจ้งทุกครั้งกับทุกคน ช่องแจ้งเตือนจะไร้ประโยชน์ทันที
    // (Instagram เองก็ไม่แจ้งเตือนสตอรี่ใหม่ — วงแหวนรอบรูปโปรไฟล์ทำหน้าที่นี้)
    const followers = await this.prisma.follow.findMany({
      where: { followingUsername: user.username },
      select: { followerUsername: true },
      take: 51,
    });

    if (followers.length > 0 && followers.length <= 50) {
      await this.notifications.pushMany(
        followers.map((row) => row.followerUsername),
        {
          kind: 'MENTION',
          refId: story.id,
          actorUsername: user.username,
          payload: { story: true, preview: dto.caption ?? null },
        },
      );
    }

    return this.toItem(
      { ...story, asset, _count: { views: 0 } },
      new Set(),
      true,
    );
  }

  /// แถวสตอรี่บนสุดของฟีด — ของตัวเองมาก่อน แล้วคนที่ติดตาม
  ///
  /// **การหมดอายุบังคับที่นี่** ด้วย `expiresAt: { gt: now }` ไม่ใช่รอให้ตัวลบ
  /// มาทำงาน ฉะนั้นสตอรี่ที่หมดอายุหายจากสายตาผู้ใช้ตรงเวลาแม้ตัวเก็บกวาด
  /// จะไม่เคยรันเลย
  async tray(user: GatewayUser): Promise<StoryTrayDto[]> {
    const authors = await this.follows.followingUsernames(user);
    const now = new Date();

    const stories = await this.prisma.story.findMany({
      where: {
        authorUsername: { in: authors },
        expiresAt: { gt: now },
      },
      orderBy: { createdAt: 'asc' }, // ในหนึ่งคน ดูจากเก่าไปใหม่
      include: {
        asset: true,
        _count: { select: { views: true } },
      },
      // มีเพดาน — ของเดิมไม่มี `take` เลย
      //
      // คนที่ติดตามเพื่อนร่วมรุ่นสามร้อยคน ช่วงสอบที่ทุกคนโพสต์กันคนละสิบชิ้น
      // จะได้แถวหลักพันต่อการเปิดฟีดหนึ่งครั้ง แต่ละแถวยังพ่วง asset และ
      // subquery นับยอดดู แล้วยังต้องเซ็น URL ให้ทีละไฟล์อีก
      take: TRAY_STORY_LIMIT,
    });

    if (stories.length === 0) {
      return [];
    }

    const seen = await this.prisma.storyView.findMany({
      where: {
        username: user.username,
        storyId: { in: stories.map((story) => story.id) },
      },
      select: { storyId: true },
    });

    const seenIds = new Set(seen.map((row) => row.storyId));
    const byAuthor = new Map<string, typeof stories>();

    for (const story of stories) {
      const list = byAuthor.get(story.authorUsername) ?? [];

      list.push(story);
      byAuthor.set(story.authorUsername, list);
    }

    const trays = await Promise.all(
      [...byAuthor.entries()].map(async ([author, list]) => {
        const isMe = author === user.username;

        return {
          author_username: author,
          has_unseen: list.some((story) => !seenIds.has(story.id)),
          is_me: isMe,
          stories: await Promise.all(
            list.map((story) => this.toItem(story, seenIds, isMe)),
          ),
        };
      }),
    );

    // ของตัวเองอยู่ซ้ายสุด แล้วเรียงคนที่ยังมีของไม่ได้ดูขึ้นก่อน
    // (เหมือน Instagram — คนที่ดูครบแล้วถูกดันไปท้ายแถว)
    return trays.sort((a, b) => {
      if (a.is_me !== b.is_me) return a.is_me ? -1 : 1;
      if (a.has_unseen !== b.has_unseen) return a.has_unseen ? -1 : 1;

      return a.author_username.localeCompare(b.author_username);
    });
  }

  /// บันทึกว่าดูแล้ว — กดซ้ำไม่เพิ่มยอด เพราะคีย์เป็น (storyId, username)
  async markViewed(
    user: GatewayUser,
    storyId: string,
  ): Promise<{ view_count: number }> {
    const story = await this.requireVisible(user, storyId);

    await this.prisma.storyView
      .create({ data: { storyId, username: user.username } })
      .catch(() => undefined); // ดูซ้ำ = ชนคีย์ ซึ่งถูกต้องแล้ว

    const viewCount = await this.prisma.storyView.count({ where: { storyId } });

    return {
      // ยอดผู้ชมเป็นข้อมูลของเจ้าของ คนอื่นไม่ควรรู้ว่าสตอรี่นี้มีคนดูกี่คน
      view_count: story.authorUsername === user.username ? viewCount : 0,
    };
  }

  /// รายชื่อผู้ชม — เจ้าของสตอรี่เท่านั้น (เหมือน Instagram)
  async viewers(
    user: GatewayUser,
    storyId: string,
  ): Promise<StoryViewerDto[]> {
    const story = await this.prisma.story.findUnique({
      where: { id: storyId },
      select: { authorUsername: true },
    });

    if (!story) {
      throw new NotFoundException('ไม่พบสตอรี่นี้');
    }

    if (story.authorUsername !== user.username) {
      throw new ForbiddenException('ดูรายชื่อผู้ชมได้เฉพาะสตอรี่ของตัวเอง');
    }

    const rows = await this.prisma.storyView.findMany({
      where: { storyId },
      orderBy: { viewedAt: 'desc' },
      take: 200,
    });

    return rows.map((row) => ({
      username: row.username,
      viewed_at: row.viewedAt.toISOString(),
    }));
  }

  async remove(user: GatewayUser, storyId: string): Promise<void> {
    const story = await this.prisma.story.findUnique({
      where: { id: storyId },
    });

    if (!story) {
      throw new NotFoundException('ไม่พบสตอรี่นี้');
    }

    const isOwner = story.authorUsername === user.username;
    const canModerate = user.layer1Role === 'admin';

    if (!isOwner && !canModerate) {
      throw new ForbiddenException('ลบได้เฉพาะสตอรี่ของตัวเอง');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.story.delete({ where: { id: storyId } });

      if (!isOwner) {
        await tx.auditLog.create({
          data: {
            actorUsername: user.username,
            actorLayer1Role: user.layer1Role,
            action: 'story.delete',
            targetKind: 'STORY',
            targetId: storyId,
            metadata: { author_username: story.authorUsername },
          },
        });
      }
    });
  }

  /// เก็บกวาดสตอรี่ที่หมดอายุ พร้อมคืนพื้นที่เก็บไฟล์
  ///
  /// **ไม่ใช่สิ่งที่ทำให้ฟีเจอร์ถูกต้อง** — การหมดอายุบังคับตอนอ่านไปแล้ว
  /// งานของตัวนี้คือคืนโควตาให้เจ้าของ ไม่งั้นคนที่โพสต์สตอรี่วันละสามอันจะ
  /// พื้นที่เต็มในเดือนเดียวทั้งที่สตอรี่หายจากหน้าจอไปนานแล้ว
  async sweepExpired(): Promise<number> {
    const expired = await this.prisma.story.findMany({
      where: { expiresAt: { lt: new Date() } },
      include: { asset: true },
      take: 200,
    });

    let removed = 0;

    for (const story of expired) {
      try {
        await this.storage.remove(story.asset.bucket, story.asset.objectPath);

        await this.prisma.$transaction(async (tx) => {
          await tx.story.delete({ where: { id: story.id } });

          // ลบ asset ด้วย แล้วคืนโควตาให้เจ้าของตามขนาดจริง
          await tx.asset.delete({ where: { id: story.assetId } });
          await tx.subsystemMember.update({
            where: { username: story.asset.ownerUsername },
            data: {
              storageUsedBytes: { decrement: story.asset.sizeBytes },
            },
          });
        });

        removed += 1;
      } catch (error) {
        this.logger.warn(
          `ลบสตอรี่ ${story.id} ไม่สำเร็จ: ${
            error instanceof Error ? error.message : 'ไม่ทราบสาเหตุ'
          }`,
        );
      }
    }

    if (removed > 0) {
      this.logger.log(`เก็บกวาดสตอรี่ที่หมดอายุ ${removed} รายการ`);
    }

    return removed;
  }

  /// สตอรี่ที่ผู้เรียกมีสิทธิ์เห็น = ของตัวเอง หรือของคนที่ตัวเองติดตาม
  /// และต้องยังไม่หมดอายุ
  private async requireVisible(user: GatewayUser, storyId: string) {
    const story = await this.prisma.story.findFirst({
      where: { id: storyId, expiresAt: { gt: new Date() } },
    });

    if (!story) {
      throw new NotFoundException('ไม่พบสตอรี่นี้ หรือหมดอายุไปแล้ว');
    }

    if (story.authorUsername === user.username) {
      return story;
    }

    const authors = await this.follows.followingUsernames(user);

    if (!authors.includes(story.authorUsername)) {
      // 404 ไม่ใช่ 403 — ไม่ยืนยันให้คนนอกรู้ว่าสตอรี่ id นี้มีอยู่จริง
      throw new NotFoundException('ไม่พบสตอรี่นี้');
    }

    return story;
  }

  private async toItem(
    story: {
      id: string;
      authorUsername: string;
      assetId: string;
      caption: string | null;
      createdAt: Date;
      expiresAt: Date;
      asset: { bucket: string; objectPath: string; fileName: string; kind: string };
      _count: { views: number };
    },
    seenIds: Set<string>,
    isMe: boolean,
  ): Promise<StoryItemDto> {
    const signed = await this.storage.createDownloadUrl(
      story.asset.bucket,
      story.asset.objectPath,
      {
        ttlSeconds: STORY_URL_TTL_SECONDS,
        fileName: story.asset.fileName,
        // สตอรี่ต้องเรนเดอร์ในหน้า ไม่ใช่บังคับดาวน์โหลด
        asAttachment: false,
      },
    );

    return {
      id: story.id,
      author_username: story.authorUsername,
      kind: story.asset.kind,
      media_url: signed.url,
      asset_id: story.assetId,
      caption: story.caption,
      viewed_by_me: seenIds.has(story.id),
      // ยอดผู้ชมเป็นข้อมูลของเจ้าของเท่านั้น
      view_count: isMe ? story._count.views : 0,
      created_at: story.createdAt.toISOString(),
      expires_at: story.expiresAt.toISOString(),
    };
  }
}
