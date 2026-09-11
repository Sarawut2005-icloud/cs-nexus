import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from 'class-validator';
import { PaginationQuery } from '../../../common/http/pagination.dto.js';
import type {
  ReelCommentModel,
  ReelModel,
} from '../../../generated/prisma/models.js';

/// JSON field ต้องเป็น snake_case ทั้งหมด (Blueprint หน้า 7)
/// จึงตั้งชื่อ property เป็น snake_case ตรง ๆ แทนที่จะพึ่ง interceptor แปลงชื่อ
/// เพราะแบบนี้ openapi.json สะท้อนของจริงเสมอ ไม่มีเวทมนตร์ซ่อน

export class CreateReelDto {
  @ApiProperty({ example: 'โชว์ UI ฟีด Reels ด้วย Tailwind' })
  @IsString()
  @Length(1, 120, { message: 'title ต้องยาว 1-120 ตัวอักษร' })
  title!: string;

  @ApiPropertyOptional({ example: 'ทำด้วย Next.js + Framer Motion #CSNexus' })
  @IsOptional()
  @IsString()
  @Length(0, 2000)
  caption?: string;

  @ApiProperty({
    description: 'id ของ Asset ที่ commit แล้วและสถานะเป็น READY',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsUUID('4', { message: 'asset_id ต้องเป็น UUID' })
  asset_id!: string;

  @ApiProperty({
    description: 'ความยาวคลิปเป็นมิลลิวินาที สูงสุด 60 วินาที',
    example: 28500,
  })
  @IsInt()
  @Min(1000, { message: 'คลิปต้องยาวกว่า 1 วินาที' })
  @Max(60_000, { message: 'คลิปยาวได้ไม่เกิน 60 วินาที เพื่อคุมค่าข้อมูลขาออก' })
  duration_ms!: number;
}

export class ReelResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ nullable: true }) caption!: string | null;
  @ApiProperty() asset_id!: string;
  @ApiProperty() duration_ms!: number;

  @ApiProperty({
    description: 'Shared Identity ของเจ้าของคลิป — ไม่มี student_id ซ้ำซ้อน',
    example: '6704101382-anuchat',
  })
  author_username!: string;

  @ApiProperty() like_count!: number;
  @ApiProperty() view_count!: number;
  @ApiProperty({ description: 'ผู้เรียกกดไลก์คลิปนี้ไว้หรือยัง' })
  liked_by_me!: boolean;

  @ApiProperty({
    description: 'ISO 8601 พร้อม offset ตามมาตรฐาน',
    example: '2026-08-11T09:30:00+07:00',
  })
  created_at!: string;
}

/// map แถวจากฐานข้อมูล (camelCase) เป็น payload มาตรฐาน (snake_case)
export function toReelResponse(
  reel: ReelModel,
  options: { likedByMe: boolean },
): ReelResponseDto {
  return {
    id: reel.id,
    title: reel.title,
    caption: reel.caption,
    asset_id: reel.assetId,
    duration_ms: reel.durationMs,
    author_username: reel.authorUsername,
    like_count: reel.likeCount,
    view_count: reel.viewCount,
    liked_by_me: options.likedByMe,
    created_at: reel.createdAt.toISOString(),
  };
}

export class ListReelsQuery extends PaginationQuery {
  @ApiPropertyOptional({
    enum: ['all', 'following'],
    default: 'all',
    description:
      'following = เฉพาะคลิปของคนที่ฉันติดตาม (รวมของตัวเอง) — ฟีดแบบ Instagram',
  })
  @IsOptional()
  @IsIn(['all', 'following'])
  feed?: 'all' | 'following';

  @ApiPropertyOptional({
    example: '6704101382-anuchat',
    description: 'เฉพาะคลิปของคนนี้ — ใช้ทำหน้าโปรไฟล์',
  })
  @IsOptional()
  @IsString()
  @Length(2, 64)
  author_username?: string;
}

export class CreateReelCommentDto {
  @ApiProperty({ example: 'ตัดต่อดีมากครับ' })
  @IsString()
  @Length(1, 1000)
  content!: string;
}

export class ReelCommentResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() reel_id!: string;
  @ApiProperty() author_username!: string;
  @ApiProperty() content!: string;
  @ApiProperty() created_at!: string;
}

export function toReelCommentResponse(
  comment: ReelCommentModel,
): ReelCommentResponseDto {
  return {
    id: comment.id,
    reel_id: comment.reelId,
    author_username: comment.authorUsername,
    content: comment.content,
    created_at: comment.createdAt.toISOString(),
  };
}
