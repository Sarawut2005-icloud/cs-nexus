import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { GatewayUser } from '../../common/auth/gateway-user.js';
import { RolesGuard } from '../../common/auth/roles.guard.js';
import { Paginated } from '../../common/http/envelope.js';
import { PaginationQuery } from '../../common/http/pagination.dto.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import {
  STORAGE_PROVIDER,
  type StorageProvider,
} from '../../common/storage/storage.provider.js';
import {
  assertUploadableName,
  extensionOf,
  FileTypeError,
  SNIFF_BYTES,
  sniffFileType,
} from '../../common/util/file-type.js';
import {
  AssetResponseDto,
  CreateUploadIntentDto,
  DownloadUrlResponseDto,
  toAssetResponse,
  UploadIntentResponseDto,
} from './dto/asset.dto.js';

/// อายุของ signed URL — สั้นพอที่ URL ที่รั่วออกไปจะใช้ไม่ได้แล้ว
const UPLOAD_TTL_SECONDS = 300;
const DOWNLOAD_TTL_SECONDS = 120;

/// แถวที่ค้างสถานะ PENDING นานกว่านี้ถือว่าผู้ใช้ปิดแท็บหนีไปแล้ว
const PENDING_EXPIRY_MS = 60 * 60 * 1000;

@Injectable()
export class AssetsService {
  private readonly logger = new Logger(AssetsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  /// จังหวะที่ 1 — ขออนุญาตอัปโหลด
  ///
  /// เช็คโควตา "ก่อน" ออก URL เพื่อให้ผู้ใช้รู้ตัวก่อนเสียเวลาอัปไฟล์ 40 MB
  /// แล้วค่อยถูกปฏิเสธ
  async createUploadIntent(
    user: GatewayUser,
    dto: CreateUploadIntentDto,
  ): Promise<UploadIntentResponseDto> {
    const member = await this.ensureMember(user);
    const declared = BigInt(dto.size_bytes);
    const remaining = member.storageQuotaBytes - member.storageUsedBytes;

    if (declared > remaining) {
      throw new PayloadTooLargeException(
        `พื้นที่ไม่พอ — เหลือ ${formatBytes(remaining)} ` +
          `แต่ไฟล์นี้ ${formatBytes(declared)} ` +
          'ลบไฟล์เก่าที่ไม่ใช้แล้วก่อน',
      );
    }

    // ตอนนี้รู้แค่ชื่อไฟล์ ยังไม่มีไบต์ให้ตรวจ จึงตรวจได้เท่าที่นามสกุลบอก
    // เพื่อไม่ให้ผู้ใช้เสียเวลาอัปไฟล์ใหญ่แล้วค่อยรู้ว่ารับไม่ได้
    // (เนื้อไฟล์จริงตรวจอีกชั้นตอน commit)
    try {
      assertUploadableName(dto.file_name);
    } catch (error) {
      if (error instanceof FileTypeError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }

    const extension = extensionOf(dto.file_name);
    // username นำหน้า path เพื่อให้เขียนกฎสิทธิ์ตาม prefix ได้ที่ชั้นที่เก็บไฟล์
    const objectPath = `${user.username}/${randomUUID()}${extension ? `.${extension}` : ''}`;

    const asset = await this.prisma.asset.create({
      data: {
        ownerUsername: user.username,
        bucket: dto.bucket,
        objectPath,
        fileName: dto.file_name,
        // ค่าชั่วคราว — ของจริงมาจากการตรวจเนื้อไฟล์ตอน commit
        mimeType: 'application/octet-stream',
        kind: 'DOCUMENT',
        sizeBytes: 0n,
        status: 'PENDING',
      },
    });

    const ticket = await this.storage.createUploadTicket(
      dto.bucket,
      objectPath,
      { contentLength: dto.size_bytes, ttlSeconds: UPLOAD_TTL_SECONDS },
    );

    return {
      asset_id: asset.id,
      upload_url: ticket.uploadUrl,
      upload_method: ticket.method,
      upload_headers: ticket.headers,
      expires_at: ticket.expiresAt.toISOString(),
    };
  }

  /// จังหวะที่ 3 — ยืนยันว่าอัปโหลดจริงและไฟล์เป็นอย่างที่อ้าง
  ///
  /// จังหวะนี้คือจังหวะที่คนมักข้าม ถ้าไม่มี:
  ///   - โควตาโกงได้ด้วยการแจ้ง 1 KB แล้วอัป 40 MB
  ///   - .svg ที่ข้างในเป็นสคริปต์จะเข้ามาในระบบได้
  ///   - ฐานข้อมูลจะเต็มไปด้วยแถวกำพร้าของคนที่กด intent แล้วปิดแท็บ
  async commit(user: GatewayUser, assetId: string): Promise<AssetResponseDto> {
    const asset = await this.prisma.asset.findUnique({ where: { id: assetId } });

    if (!asset) {
      throw new NotFoundException('ไม่พบรายการอัปโหลดนี้');
    }

    if (asset.ownerUsername !== user.username) {
      throw new ForbiddenException('รายการอัปโหลดนี้ไม่ใช่ของคุณ');
    }

    if (asset.status === 'READY') {
      return toAssetResponse(asset);
    }

    if (asset.status === 'BLOCKED') {
      throw new BadRequestException('ไฟล์นี้ถูกปฏิเสธไปแล้ว อัปโหลดใหม่');
    }

    const info = await this.storage.head(asset.bucket, asset.objectPath);

    if (!info) {
      throw new BadRequestException(
        'ยังไม่พบไฟล์ในที่เก็บ — อัปโหลดด้วย upload_url ให้สำเร็จก่อนเรียก commit',
      );
    }

    // ตรวจเนื้อไฟล์จริง ไม่เชื่อนามสกุลหรือ Content-Type ที่ client แจ้ง
    const header = await this.storage.readHead(
      asset.bucket,
      asset.objectPath,
      SNIFF_BYTES,
    );

    let sniffed;
    try {
      sniffed = sniffFileType(header, asset.fileName);
    } catch (error) {
      await this.block(assetId, asset.bucket, asset.objectPath);

      throw new BadRequestException(
        error instanceof FileTypeError
          ? error.message
          : 'ตรวจชนิดไฟล์ไม่ผ่าน',
      );
    }

    if (asset.bucket === 'reels' && sniffed.kind !== 'VIDEO') {
      await this.block(assetId, asset.bucket, asset.objectPath);
      throw new BadRequestException('bucket "reels" รับเฉพาะไฟล์วิดีโอ');
    }

    const member = await this.ensureMember(user);
    const remaining = member.storageQuotaBytes - member.storageUsedBytes;

    // ขนาดจริงอาจใหญ่กว่าที่แจ้งไว้ตอน intent — ตรวจอีกรอบกับของจริง
    if (info.sizeBytes > remaining) {
      await this.block(assetId, asset.bucket, asset.objectPath);

      throw new PayloadTooLargeException(
        `ไฟล์จริงขนาด ${formatBytes(info.sizeBytes)} เกินพื้นที่ที่เหลือ ` +
          `(${formatBytes(remaining)}) — ไฟล์ถูกลบทิ้งแล้ว`,
      );
    }

    // เปลี่ยนสถานะและบวกโควตาในทรานแซกชันเดียว ไม่งั้นถ้าพังกลางทาง
    // จะได้ไฟล์ที่ใช้พื้นที่จริงแต่ระบบไม่นับ
    //
    // การบวกต้องมี **เงื่อนไขโควตาอยู่ในคำสั่งเขียนเอง** ไม่ใช่เช็คไว้ข้างบน
    // แล้วค่อยบวก: ค่าที่เช็คไปถูกอ่านนอกทรานแซกชันนี้ ผู้ใช้ที่เหลือพื้นที่
    // 10 MB จึงยิง commit ห้าไฟล์ ไฟล์ละ 8 MB พร้อมกันได้ ทุกคำขออ่านค่าเดิม
    // ผ่านด่านหมด แล้วบวกทับกันจนใช้ไป 40 MB บนโควตาที่เหลือ 10 MB
    //
    // updateMany + where ทำให้ Postgres ประเมินเงื่อนไขกับแถวจริงตอนเขียน
    // ถ้าไม่เข้าเงื่อนไขจะได้ count 0 แล้วเราโยนทิ้งทั้งทรานแซกชัน
    const updated = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.subsystemMember.updateMany({
        where: {
          username: user.username,
          storageUsedBytes: { lte: member.storageQuotaBytes - info.sizeBytes },
        },
        data: { storageUsedBytes: { increment: info.sizeBytes } },
      });

      if (claimed.count === 0) {
        throw new PayloadTooLargeException(
          `ไฟล์จริงขนาด ${formatBytes(info.sizeBytes)} เกินพื้นที่ที่เหลือ — ` +
            'อาจมีไฟล์อื่นของคุณกำลังอัปโหลดพร้อมกันอยู่',
        );
      }

      return tx.asset.update({
        where: { id: assetId },
        data: {
          status: 'READY',
          sizeBytes: info.sizeBytes,
          mimeType: sniffed.mimeType,
          kind: sniffed.kind,
        },
      });
    });

    return toAssetResponse(updated);
  }

  async listMine(
    user: GatewayUser,
    query: PaginationQuery,
  ): Promise<Paginated<AssetResponseDto>> {
    const where = { ownerUsername: user.username, status: 'READY' as const };

    const [rows, total] = await Promise.all([
      this.prisma.asset.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: query.skip,
        take: query.take,
      }),
      this.prisma.asset.count({ where }),
    ]);

    return new Paginated(rows.map(toAssetResponse), query.meta(total));
  }

  /// URL อ่านไฟล์แบบมีอายุสั้น
  ///
  /// ทุกอย่างที่ไม่ใช่ภาพหรือวิดีโอถูกบังคับดาวน์โหลด เพื่อไม่ให้เบราว์เซอร์
  /// เรนเดอร์ไฟล์ของผู้ใช้เป็นหน้าเว็บบนโดเมนของเรา
  async createDownloadUrl(
    user: GatewayUser,
    assetId: string,
  ): Promise<DownloadUrlResponseDto> {
    const asset = await this.prisma.asset.findUnique({ where: { id: assetId } });

    if (!asset || asset.status !== 'READY') {
      throw new NotFoundException('ไม่พบไฟล์นี้');
    }

    const canRead = await this.canRead(user, asset.id, asset.ownerUsername);

    if (!canRead) {
      throw new ForbiddenException('ไม่มีสิทธิ์เข้าถึงไฟล์นี้');
    }

    const asAttachment = asset.kind !== 'IMAGE' && asset.kind !== 'VIDEO';

    const signed = await this.storage.createDownloadUrl(
      asset.bucket,
      asset.objectPath,
      {
        ttlSeconds: DOWNLOAD_TTL_SECONDS,
        fileName: asset.fileName,
        asAttachment,
      },
    );

    return {
      download_url: signed.url,
      expires_at: signed.expiresAt.toISOString(),
      as_attachment: asAttachment,
    };
  }

  async remove(user: GatewayUser, assetId: string): Promise<void> {
    const asset = await this.prisma.asset.findUnique({
      where: { id: assetId },
      include: { reel: { select: { id: true } } },
    });

    if (!asset) {
      throw new NotFoundException('ไม่พบไฟล์นี้');
    }

    const isOwner = asset.ownerUsername === user.username;

    if (!isOwner && user.layer1Role !== 'admin') {
      throw new ForbiddenException('ลบได้เฉพาะไฟล์ของตัวเอง');
    }

    if (asset.reel) {
      throw new BadRequestException(
        'ไฟล์นี้ถูกใช้เป็นคลิป Reels อยู่ — ลบคลิปก่อน',
      );
    }

    await this.storage.remove(asset.bucket, asset.objectPath);

    await this.prisma.$transaction(async (tx) => {
      await tx.asset.delete({ where: { id: assetId } });

      await tx.auditLog.create({
        data: {
          actorUsername: user.username,
          actorLayer1Role: user.layer1Role,
          action: 'asset.delete',
          targetKind: 'ASSET',
          targetId: assetId,
          metadata: { owner_username: asset.ownerUsername, by_admin: !isOwner },
        },
      });

      // คืนพื้นที่ให้เจ้าของ ไม่ใช่ให้คนที่กดลบ
      if (asset.status === 'READY' && asset.sizeBytes > 0n) {
        await tx.subsystemMember.update({
          where: { username: asset.ownerUsername },
          data: { storageUsedBytes: { decrement: asset.sizeBytes } },
        });
      }
    });
  }

  /// เก็บกวาดแถวที่ค้าง PENDING — ให้ cron หรือ scheduler เรียก
  async sweepStalePending(): Promise<number> {
    const cutoff = new Date(Date.now() - PENDING_EXPIRY_MS);

    const stale = await this.prisma.asset.findMany({
      where: { status: 'PENDING', createdAt: { lt: cutoff } },
      take: 200,
    });

    // แยก try/catch ต่อไฟล์ — ไม่ใช่ปล่อยให้ทั้งลูปตายเพราะไฟล์เดียว
    //
    // ถ้าไฟล์ใดไฟล์หนึ่งลบไม่ได้ (ถูกลบไปแล้วจากฝั่ง storage · สิทธิ์เปลี่ยน ·
    // 5xx ชั่วคราว) ลูปแบบเดิมจะโยนออกทันที รอบนั้นเก็บกวาดไม่ได้เลยสักไฟล์
    // แล้วรอบ 30 นาทีถัดไปก็หยิบชุดเดิมมาตายที่ไฟล์เดิมซ้ำตลอดไป —
    // ตัวเก็บกวาดตายสนิทโดยไม่มีใครรู้ เพราะข้างนอกเห็นแค่ removed: 0
    const removed: string[] = [];

    for (const asset of stale) {
      try {
        await this.storage.remove(asset.bucket, asset.objectPath);
        removed.push(asset.id);
      } catch (error) {
        this.logger.warn(
          `ลบไฟล์ค้าง ${asset.bucket}/${asset.objectPath} ไม่ได้ — ข้ามไปก่อน`,
          error instanceof Error ? error.stack : undefined,
        );
      }
    }

    if (removed.length > 0) {
      // ลบทีเดียวแทนการยิงทีละแถว
      await this.prisma.asset.deleteMany({ where: { id: { in: removed } } });

      this.logger.log(`เก็บกวาดรายการอัปโหลดที่ค้าง ${removed.length} รายการ`);
    }

    if (removed.length < stale.length) {
      this.logger.warn(
        `ยังมีอีก ${stale.length - removed.length} รายการที่ลบไม่สำเร็จในรอบนี้`,
      );
    }

    return removed.length;
  }

  /// เจ้าของอ่านได้เสมอ · admin องค์กรอ่านได้เพื่อจัดการเนื้อหา ·
  /// คนอื่นอ่านได้เมื่อไฟล์ถูกแนบในห้องแชทที่ตัวเองเป็นสมาชิก
  private async canRead(
    user: GatewayUser,
    assetId: string,
    ownerUsername: string,
  ): Promise<boolean> {
    if (ownerUsername === user.username || user.layer1Role === 'admin') {
      return true;
    }

    const shared = await this.prisma.asset.findFirst({
      where: {
        id: assetId,
        OR: [
          {
            message: {
              channel: { members: { some: { username: user.username } } },
            },
          },
          // ไฟล์ที่เป็นคลิป Reels เปิดให้ทุกคนในสาขาดูได้
          { reel: { isNot: null } },
        ],
      },
      select: { id: true },
    });

    return shared !== null;
  }

  private async block(
    assetId: string,
    bucket: string,
    objectPath: string,
  ): Promise<void> {
    await this.storage.remove(bucket, objectPath);
    await this.prisma.asset.update({
      where: { id: assetId },
      data: { status: 'BLOCKED' },
    });
  }

  private async ensureMember(user: GatewayUser) {
    const existing = await this.prisma.subsystemMember.findUnique({
      where: { username: user.username },
    });

    if (existing) {
      return existing;
    }

    return this.prisma.subsystemMember.create({
      data: {
        username: user.username,
        layer2Role: RolesGuard.defaultLayer2Role(user.layer1Role),
      },
    });
  }
}

function formatBytes(bytes: bigint): string {
  const mb = Number(bytes) / 1024 / 1024;

  return mb >= 1
    ? `${mb.toFixed(1)} MB`
    : `${(Number(bytes) / 1024).toFixed(0)} KB`;
}
