import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsString, Length, Max, Min } from 'class-validator';
import type { AssetModel } from '../../../generated/prisma/models.js';

export const BUCKETS = ['reels', 'attachments'] as const;
export type Bucket = (typeof BUCKETS)[number];

/// เพดานต่อไฟล์ — ตั้งไว้ต่ำกว่าเพดานของ Supabase free tier
export const MAX_FILE_BYTES = 50 * 1024 * 1024;

export class CreateUploadIntentDto {
  @ApiProperty({ example: 'project-final.zip' })
  @IsString()
  @Length(1, 255)
  file_name!: string;

  @ApiProperty({
    description:
      'ขนาดที่ client แจ้ง ใช้กันโควตาล่วงหน้าเท่านั้น — ขนาดจริงยืนยันตอน commit',
    example: 4_812_004,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1, { message: 'ไฟล์ว่างอัปโหลดไม่ได้' })
  @Max(MAX_FILE_BYTES, {
    message: `ไฟล์ใหญ่ได้ไม่เกิน ${Math.floor(MAX_FILE_BYTES / 1024 / 1024)} MB`,
  })
  size_bytes!: number;

  @ApiProperty({ enum: BUCKETS, example: 'attachments' })
  @IsIn(BUCKETS, { message: `bucket ต้องเป็น ${BUCKETS.join(' หรือ ')}` })
  bucket!: Bucket;
}

export class UploadIntentResponseDto {
  @ApiProperty() asset_id!: string;

  @ApiProperty({
    description: 'ให้เบราว์เซอร์ PUT ไบต์ไปที่นี่ตรง ๆ ไม่ผ่าน backend',
  })
  upload_url!: string;

  @ApiProperty({ example: 'PUT' }) upload_method!: string;

  @ApiProperty({
    description: 'header ที่ต้องแนบไปกับ PUT',
    example: { 'content-type': 'application/octet-stream' },
  })
  upload_headers!: Record<string, string>;

  @ApiProperty({ example: '2026-08-11T09:31:00+07:00' })
  expires_at!: string;
}

export class AssetResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() owner_username!: string;
  @ApiProperty() bucket!: string;
  @ApiProperty() file_name!: string;
  @ApiProperty() mime_type!: string;
  @ApiProperty({ enum: ['IMAGE', 'VIDEO', 'CODE', 'DOCUMENT', 'ARCHIVE'] })
  kind!: string;

  @ApiProperty({
    description: 'ขนาดจริงเป็นไบต์ ส่งเป็น string เพราะ BigInt เกินช่วง JSON number',
    example: '4812004',
  })
  size_bytes!: string;

  @ApiProperty({ enum: ['PENDING', 'READY', 'BLOCKED'] })
  status!: string;

  @ApiProperty() created_at!: string;
}

export class DownloadUrlResponseDto {
  @ApiProperty() download_url!: string;
  @ApiProperty() expires_at!: string;

  @ApiProperty({
    description:
      'true = เบราว์เซอร์จะบังคับดาวน์โหลด ไม่เรนเดอร์เป็นหน้าเว็บ',
  })
  as_attachment!: boolean;
}

export function toAssetResponse(asset: AssetModel): AssetResponseDto {
  return {
    id: asset.id,
    owner_username: asset.ownerUsername,
    bucket: asset.bucket,
    file_name: asset.fileName,
    mime_type: asset.mimeType,
    kind: asset.kind,
    size_bytes: asset.sizeBytes.toString(),
    status: asset.status,
    created_at: asset.createdAt.toISOString(),
  };
}
