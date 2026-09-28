import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { CoreHubUser } from '../../common/auth/core-user.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import type { ProfileCacheModel } from '../../generated/prisma/models.js';
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
/// เครื่องหมายยืนยันข้างชื่อ — มาจาก layer2_role ไม่ใช่ core_role
///
/// **ทำไมไม่ใช้ core_role**: Blueprint หน้า 10 ห้ามเก็บ core_role ลง
/// ฐานข้อมูล เรารู้ role ของ "ผู้เรียกเอง" จาก header ทุก request แต่ไม่มีทาง
/// รู้ของคนอื่นเลยจนกว่า Core จะมี endpoint ให้ถาม (ยังไม่มี)
///
/// layer2_role เป็น Local Data ที่เรานิยามเองได้ (หน้า 11) และตรงกับความหมาย
/// ที่เครื่องหมายถูกควรสื่อในชุมชนนี้อยู่แล้ว: "คนนี้มีอำนาจดูแลที่นี่"
/// ค่าเริ่มต้นแปลงจาก core_role มาให้แล้ว (staff→EDITOR, admin→ADMIN)
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
  'core_role',
] as const;

@Injectable()
export class ProfilesService {
  private readonly logger = new Logger(ProfilesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly follows: FollowsService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  /// แปลง coreUserId หลายตัวเป็นชื่อที่แสดง ในคิวรีเดียว
  ///
  /// หน้าบ้านเรนเดอร์ฟีดหรือรายชื่อในห้องแล้วต้องการชื่อจริงของทุกคนพร้อมกัน
  /// ถ้าไม่มี endpoint นี้ หน้าบ้านจะยิงทีละคน = 20 คำขอต่อการโหลดหนึ่งหน้า
  async resolveMany(coreUserIds: string[]): Promise<ProfileSummaryDto[]> {
    const unique = [...new Set(coreUserIds.filter(Boolean))];

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
        where: { coreUserId: { in: unique } },
      }),
      // ดึง layer2_role มาคำนวณ badge ในคิวรีเดียวกับการแปลงชื่อ
      // ไม่งั้นหน้าบ้านต้องยิงถามสิทธิ์ทีละคนเพื่อวาดเครื่องหมายถูก
      this.prisma.subsystemMember.findMany({
        where: { coreUserId: { in: unique } },
        select: { coreUserId: true, layer2Role: true },
      }),
    ]);

    const byCoreUserId = new Map(cached.map((row) => [row.coreUserId, row]));
    const roleByCoreUserId = new Map(
      members.map((row) => [row.coreUserId, row.layer2Role]),
    );
    const stale = unique.filter((coreUserId) => {
      const row = byCoreUserId.get(coreUserId);

      // ไม่มีแถว หรือยังไม่เคยซิงก์จริง (`syncedAt` เป็น null) ก็ถือว่าเก่า
      return (
        !row ||
        !row.syncedAt ||
        Date.now() - row.syncedAt.getTime() > CACHE_TTL_MS
      );
    });

    if (stale.length > 0) {
      const fresh = await this.syncFromCore(stale);

      for (const row of fresh) {
        byCoreUserId.set(row.coreUserId, row);
      }
    }

    return unique.map((coreUserId) => {
      const row = byCoreUserId.get(coreUserId);

      return {
        coreUserId,
        // ยังไม่มีข้อมูลจาก Core ก็คืน coreUserId ไปก่อน ดีกว่าคืนค่าว่าง
        // แล้วให้หน้าบ้านเรนเดอร์ช่องว่างโดยไม่รู้ว่าเป็นบั๊กหรือไม่มีชื่อจริง
        display_name: row?.displayName ?? coreUserId,
        avatar_url: row?.avatarUrl ?? null,
        // null = ยังไม่เคยซิงก์ชื่อจริงจาก Core Hub — หน้าบ้านเอาไปบอกผู้ใช้
        synced_at: row?.syncedAt?.toISOString() ?? null,
        badge: badgeFor(roleByCoreUserId.get(coreUserId)),
      };
    });
  }

  async detail(
    viewer: CoreHubUser,
    coreUserId: string,
  ): Promise<ProfileDetailDto> {
    const [summary] = await this.resolveMany([coreUserId]);

    const [reelCount, postCount, followStats, relation, member] =
      await Promise.all([
        this.prisma.reel.count({ where: { authorCoreUserId: coreUserId } }),
        this.prisma.post.count({ where: { authorCoreUserId: coreUserId } }),
        this.follows.stats(coreUserId),
        this.follows.relationWith(viewer, coreUserId),
        this.prisma.subsystemMember.findUnique({ where: { coreUserId } }),
      ]);

    const isSelf = viewer.coreUserId === coreUserId;

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
  async me(user: CoreHubUser): Promise<MyProfileDto> {
    const detail = await this.detail(user, user.coreUserId);
    const member = await this.prisma.subsystemMember.findUnique({
      where: { coreUserId: user.coreUserId },
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
    user: CoreHubUser,
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

      if (asset.ownerCoreUserId !== user.coreUserId) {
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
      where: { coreUserId: user.coreUserId },
      update: {
        ...(dto.bio !== undefined ? { bio: dto.bio.trim() || null } : {}),
        ...(dto.cover_asset_id !== undefined
          ? { coverAssetId: dto.cover_asset_id }
          : {}),
      },
      create: {
        coreUserId: user.coreUserId,
        bio: dto.bio?.trim() || null,
        coverAssetId: dto.cover_asset_id ?? null,
      },
    });

    return this.me(user);
  }

  /// ซิงก์ชื่อที่แสดงผลจาก Core Hub
  ///
  /// **ตอนนี้ยังทำไม่ได้ และนี่คือสาเหตุที่แน่ชัด** (ตรวจกับ Core Hub ตัวจริง
  /// commit 88a600f เมื่อ 27 ก.ย. 2569 โดยยิงด้วย token ของแต่ละบทบาท):
  ///
  ///   GET /api/v1/users/:id          → 200 แต่คืนแค่ id/email/role ไม่มีชื่อ
  ///   GET /api/v1/people/:personCode → 403 ต้องมี people:read ซึ่งเราไม่มี
  ///   GET /api/v1/people             → 403 เช่นเดียวกัน
  ///
  /// ชื่อจริง (`fullNameTh` `academicTitle` `photoUrl`) อยู่ในตาราง `Person`
  /// ของ Core Hub และมี `coreUserId` ผูกกับ `sub` อยู่แล้ว — ติดแค่ว่าระบบย่อย
  /// เรียกไม่ได้ ขอ endpoint ไว้แล้วที่ docs/ถึง-PM-สิ่งที่ต้องเพิ่ม.md ข้อ 1
  ///
  /// **โค้ดเดิมตรงนี้ยิงไปที่ `x-client-id` / `x-client-secret`** ซึ่งเป็นกลไก
  /// ของสถาปัตยกรรม API Gateway ที่สัญญา v1.0 บอกว่าไม่เคยมีอยู่จริง และต่อให้
  /// ยิงติดก็จะได้ `display_name` เป็น undefined อยู่ดี ลบออกเพราะโค้ดที่
  /// "ดูเหมือนทำงานแต่ไม่เคยทำงาน" อันตรายกว่าไม่มีโค้ดเลย — คนอ่านจะคิดว่า
  /// การซิงก์มีอยู่แล้วและไปหาสาเหตุผิดที่
  ///
  /// ระหว่างนี้ชื่อมาจากส่วนหน้าของอีเมลใน token ซึ่งเก็บไว้ตอนผู้ใช้เข้ามา
  /// ครั้งแรก (`ensureProfileName` ใน common/auth/member-role.ts)
  /// `6704101382@mju.ac.th` จึงแสดงเป็น `6704101382` ซึ่งคือรหัสนักศึกษาจริง
  private syncFromCore(coreUserIds: string[]): Promise<ProfileCacheModel[]> {
    if (coreUserIds.length > 0) {
      this.logger.debug(
        `ยังซิงก์ชื่อจาก Core Hub ไม่ได้ (${coreUserIds.length} คน) — ` +
          'รอ endpoint ตาม docs/ถึง-PM-สิ่งที่ต้องเพิ่ม.md ข้อ 1',
      );
    }

    return Promise.resolve([]);
  }
}
