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
import {
  MyProfileDto,
  ProfileDetailDto,
  ProfileSummaryDto,
  UpdateMyProfileDto,
} from './dto/profile.dto.js';

/// แคชชื่อที่แสดงเก่าได้ไม่เกินเท่านี้ก่อนจะไปถามใหม่จาก Core
///
/// หกชั่วโมงคือจุดที่ยอมรับได้: ถ้าอาจารย์เปลี่ยนชื่อในระบบกลางตอนเช้า
/// ระบบเราจะตามทันภายในวันเดียวกัน แต่ยังไม่ยิง Core ทุกครั้งที่เรนเดอร์ฟีด
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

/// เพดานการขอโปรไฟล์ต่อหนึ่งคำขอ — ฟีดหนึ่งหน้าไม่เคยมีคนเกินนี้
const MAX_BATCH = 100;

/// field ที่ระบบย่อยแก้ไม่ได้ — ส่งไปให้หน้าบ้านแสดงเป็นอ่านอย่างเดียว
///
/// ส่งรายการนี้ออกไปแทนที่จะให้หน้าบ้าน hardcode เอง เพราะถ้าวันหนึ่ง Core
/// ยอมให้ระบบย่อยแก้อะไรได้เพิ่ม จะแก้ที่เดียวแล้วทุกหน้าจอตามทันที
/// เครื่องหมายยืนยันข้างชื่อ — มาจาก layer2_role ไม่ใช่ layer1_role
///
/// **ทำไมไม่ใช้ layer1_role**: Blueprint หน้า 10 ห้ามเก็บ layer1_role ลง
/// ฐานข้อมูล เรารู้ role ของ "ผู้เรียกเอง" จาก header ทุก request แต่ไม่มีทาง
/// รู้ของคนอื่นเลยจนกว่า Core จะมี endpoint ให้ถาม (ยังไม่มี)
///
/// layer2_role เป็น Local Data ที่เรานิยามเองได้ (หน้า 11) และตรงกับความหมาย
/// ที่เครื่องหมายถูกควรสื่อในชุมชนนี้อยู่แล้ว: "คนนี้มีอำนาจดูแลที่นี่"
/// ค่าเริ่มต้นแปลงจาก layer1_role มาให้แล้ว (staff→EDITOR, admin→ADMIN)
///
/// **หมายเหตุ: ตรงนี้กลับคำตัดสินใจเดิม** — ก่อนหน้านี้ `detail()` ซ่อน
/// layer2_role ของคนอื่นด้วยเหตุผลว่า "รู้ว่าใครเป็น ADMIN คือรู้ว่าควรไป
/// ยึดบัญชีใคร" เหตุผลนั้นไม่ผ่านการใช้งานจริง: ชุมชนที่ดูไม่ออกว่าใคร
/// เป็นอาจารย์ล้มเหลวที่งานพื้นฐานที่สุดของมัน และในบริบทคณะ ใครเป็นอาจารย์
/// เป็นข้อมูลสาธารณะอยู่แล้ว
///
/// สิ่งที่ยังไม่เปิดคือ layer2_role แบบดิบของคนอื่น (`GUEST`/`EDITOR`/`ADMIN`)
/// — badge บอกแค่หยาบ ๆ ว่ามีอำนาจดูแลระดับไหน
function badgeFor(layer2Role: string | null | undefined) {
  if (layer2Role === 'ADMIN') return 'ADMIN' as const;
  if (layer2Role === 'EDITOR') return 'STAFF' as const;

  return null;
}

const MANAGED_BY_CORE = [
  'display_name',
  'avatar_url',
  'faculty',
  'layer1_role',
] as const;

@Injectable()
export class ProfilesService {
  private readonly logger = new Logger(ProfilesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly follows: FollowsService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  /// แปลง username หลายตัวเป็นชื่อที่แสดง ในคิวรีเดียว
  ///
  /// หน้าบ้านเรนเดอร์ฟีดหรือรายชื่อในห้องแล้วต้องการชื่อจริงของทุกคนพร้อมกัน
  /// ถ้าไม่มี endpoint นี้ หน้าบ้านจะยิงทีละคน = 20 คำขอต่อการโหลดหนึ่งหน้า
  async resolveMany(usernames: string[]): Promise<ProfileSummaryDto[]> {
    const unique = [...new Set(usernames.filter(Boolean))];

    if (unique.length > MAX_BATCH) {
      throw new BadRequestException(
        `ขอโปรไฟล์ได้สูงสุด ${MAX_BATCH} ชื่อต่อครั้ง`,
      );
    }

    if (unique.length === 0) {
      return [];
    }

    const [cached, members] = await Promise.all([
      this.prisma.profileCache.findMany({
        where: { username: { in: unique } },
      }),
      // ดึง layer2_role มาคำนวณ badge ในคิวรีเดียวกับการแปลงชื่อ
      // ไม่งั้นหน้าบ้านต้องยิงถามสิทธิ์ทีละคนเพื่อวาดเครื่องหมายถูก
      this.prisma.subsystemMember.findMany({
        where: { username: { in: unique } },
        select: { username: true, layer2Role: true },
      }),
    ]);

    const byUsername = new Map(cached.map((row) => [row.username, row]));
    const roleByUsername = new Map(
      members.map((row) => [row.username, row.layer2Role]),
    );
    const stale = unique.filter((username) => {
      const row = byUsername.get(username);

      return !row || Date.now() - row.syncedAt.getTime() > CACHE_TTL_MS;
    });

    if (stale.length > 0) {
      const fresh = await this.syncFromCore(stale);

      for (const row of fresh) {
        byUsername.set(row.username, row);
      }
    }

    return unique.map((username) => {
      const row = byUsername.get(username);

      return {
        username,
        // ยังไม่มีข้อมูลจาก Core ก็คืน username ไปก่อน ดีกว่าคืนค่าว่าง
        // แล้วให้หน้าบ้านเรนเดอร์ช่องว่างโดยไม่รู้ว่าเป็นบั๊กหรือไม่มีชื่อจริง
        display_name: row?.displayName ?? username,
        avatar_url: row?.avatarUrl ?? null,
        synced_at: row?.syncedAt.toISOString() ?? null,
        badge: badgeFor(roleByUsername.get(username)),
      };
    });
  }

  async detail(
    viewer: GatewayUser,
    username: string,
  ): Promise<ProfileDetailDto> {
    const [summary] = await this.resolveMany([username]);

    const [reelCount, postCount, followStats, relation, member] =
      await Promise.all([
        this.prisma.reel.count({ where: { authorUsername: username } }),
        this.prisma.post.count({ where: { authorUsername: username } }),
        this.follows.stats(username),
        this.follows.relationWith(viewer, username),
        this.prisma.subsystemMember.findUnique({ where: { username } }),
      ]);

    const isSelf = viewer.username === username;

    return {
      ...summary,
      stats: {
        reel_count: reelCount,
        post_count: postCount,
        follower_count: followStats.follower_count,
        following_count: followStats.following_count,
      },
      relation,
      // สิทธิ์ของคนอื่นไม่ใช่ข้อมูลสาธารณะ — รู้ว่าใครเป็น ADMIN คือรู้ว่า
      // ควรไปพยายามยึดบัญชีใคร
      layer2_role: isSelf ? (member?.layer2Role ?? null) : null,
      joined_at: member?.createdAt.toISOString() ?? null,
    };
  }

  /// โปรไฟล์ของฉัน — เพิ่ม bio และรูปปกที่เป็นของระบบย่อยนี้
  async me(user: GatewayUser): Promise<MyProfileDto> {
    const detail = await this.detail(user, user.username);
    const member = await this.prisma.subsystemMember.findUnique({
      where: { username: user.username },
      include: { cover: true },
    });

    return {
      ...detail,
      bio: member?.bio ?? null,
      cover_url: member?.cover
        ? (
            await this.storage.createDownloadUrl(
              member.cover.bucket,
              member.cover.objectPath,
              {
                ttlSeconds: 300,
                fileName: member.cover.fileName,
                asAttachment: false,
              },
            )
          ).url
        : null,
      managed_by_core: [...MANAGED_BY_CORE],
    };
  }

  /// แก้โปรไฟล์ของตัวเอง — เฉพาะ field ที่เป็น Local Data
  ///
  /// ไม่มีทางแก้ display_name หรือ avatar_url ที่นี่ และนั่นตั้งใจ:
  /// Core เป็นแหล่งความจริงของตัวตน (Blueprint หน้า 10) ระบบย่อยที่เปิดให้
  /// แก้ชื่อเองจะสร้างชื่อสองเวอร์ชันของคนเดียวกัน แล้วไม่มีใครรู้ว่าอันไหนจริง
  async updateMine(
    user: GatewayUser,
    dto: UpdateMyProfileDto,
  ): Promise<MyProfileDto> {
    // ตรวจรูปปกก่อน: ต้องเป็นไฟล์ของตัวเอง commit แล้ว และเป็นรูป
    if (dto.cover_asset_id) {
      const asset = await this.prisma.asset.findUnique({
        where: { id: dto.cover_asset_id },
      });

      if (!asset) {
        throw new NotFoundException('ไม่พบไฟล์รูปปกนี้');
      }

      if (asset.ownerUsername !== user.username) {
        throw new ForbiddenException('ใช้ไฟล์ของคนอื่นเป็นรูปปกไม่ได้');
      }

      if (asset.status !== 'READY') {
        throw new BadRequestException(
          'ไฟล์ยังอัปโหลดไม่เสร็จ — เรียก commit ให้สำเร็จก่อน',
        );
      }

      if (asset.kind !== 'IMAGE') {
        throw new BadRequestException('รูปปกต้องเป็นไฟล์รูปภาพ');
      }
    }

    await this.prisma.subsystemMember.upsert({
      where: { username: user.username },
      update: {
        ...(dto.bio !== undefined ? { bio: dto.bio.trim() || null } : {}),
        ...(dto.cover_asset_id !== undefined
          ? { coverAssetId: dto.cover_asset_id }
          : {}),
      },
      create: {
        username: user.username,
        bio: dto.bio?.trim() || null,
        coverAssetId: dto.cover_asset_id ?? null,
      },
    });

    return this.me(user);
  }

  /// ดึงชื่อจริงจาก Core แล้วเขียนลงแคช
  ///
  /// Blueprint หน้า 10 กำหนดว่า Core เป็นแหล่งความจริงของชื่อและคณะ ระบบย่อย
  /// ห้ามให้ผู้ใช้แก้ชื่อที่นี่ ตารางนี้จึงเขียนได้จากทางเดียวคือซิงก์ขาเข้า
  ///
  /// TODO(PL): ยืนยันรูปแบบจริงกับ PM — ตอนนี้เดาว่าเป็น
  ///   GET {CSMJU_CORE_API_URL}/api/v1/users/{username}
  ///   → { data: { display_name, avatar_url } }
  /// ถ้ายังไม่มี Core ให้เรียก (ช่วงพัฒนา) เมธอดนี้จะคืนอาเรย์ว่างอย่างเงียบ ๆ
  /// แล้วชั้นบนจะ fallback ไปใช้ username ซึ่งทำให้ระบบเดินต่อได้
  private async syncFromCore(usernames: string[]) {
    const baseUrl = process.env.CSMJU_CORE_API_URL;
    const clientId = process.env.CSMJU_CLIENT_ID;
    const clientSecret = process.env.CSMJU_CLIENT_SECRET;

    if (!baseUrl || !clientId || !clientSecret) {
      return [];
    }

    const results = await Promise.all(
      usernames.map(async (username) => {
        try {
          const response = await fetch(
            `${baseUrl}/api/v1/users/${encodeURIComponent(username)}`,
            {
              headers: {
                'x-client-id': clientId,
                'x-client-secret': clientSecret,
              },
              signal: AbortSignal.timeout(3000),
            },
          );

          if (!response.ok) {
            return null;
          }

          const body = (await response.json()) as {
            data?: { display_name?: string; avatar_url?: string | null };
          };
          const displayName = body.data?.display_name;

          if (!displayName) {
            return null;
          }

          return this.prisma.profileCache.upsert({
            where: { username },
            create: {
              username,
              displayName,
              avatarUrl: body.data?.avatar_url ?? null,
            },
            update: {
              displayName,
              avatarUrl: body.data?.avatar_url ?? null,
              syncedAt: new Date(),
            },
          });
        } catch (error) {
          // Core ล่มไม่ควรทำให้ฟีดของเราล่มตาม — ใช้ค่าที่แคชไว้ต่อไป
          this.logger.warn(
            `ซิงก์โปรไฟล์ ${username} จาก Core ไม่สำเร็จ: ${
              error instanceof Error ? error.message : 'ไม่ทราบสาเหตุ'
            }`,
          );

          return null;
        }
      }),
    );

    return results.filter((row) => row !== null);
  }
}
