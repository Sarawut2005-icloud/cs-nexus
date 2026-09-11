import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
} from 'class-validator';
import { PaginationQuery } from '../../../common/http/pagination.dto.js';
import { MeetingStatus } from '../../../generated/prisma/enums.js';
import type { MeetingModel } from '../../../generated/prisma/models.js';

/// นัดสั้นสุด 5 นาที ยาวสุด 8 ชั่วโมง
///
/// เพดานบนกันความผิดพลาดตอนพิมพ์วันที่ (เช่นใส่ปีผิดแล้วได้นัดยาวสามเดือน
/// ซึ่งจะค้างอยู่ในรายการ "กำลังจะถึง" ตลอดไป)
export const MIN_MEETING_MS = 5 * 60 * 1000;
export const MAX_MEETING_MS = 8 * 60 * 60 * 1000;

export class CreateMeetingDto {
  @ApiProperty({ description: 'ห้องที่จะจัดประชุม ต้องเป็นสมาชิกอยู่แล้ว' })
  @IsUUID('4')
  channel_id!: string;

  @ApiProperty({ example: 'ติวก่อนสอบกลางภาค CS201' })
  @IsString()
  @Length(1, 200)
  title!: string;

  @ApiPropertyOptional({ example: 'หัวข้อ: pointer, struct, linked list' })
  @IsOptional()
  @IsString()
  @Length(1, 4000)
  agenda?: string;

  @ApiProperty({
    example: '2026-09-15T13:00:00+07:00',
    description: 'ISO 8601 พร้อม timezone offset (Blueprint หน้า 7)',
  })
  @IsISO8601({ strict: true }, { message: 'starts_at ต้องเป็น ISO 8601' })
  starts_at!: string;

  @ApiProperty({ example: '2026-09-15T15:00:00+07:00' })
  @IsISO8601({ strict: true }, { message: 'ends_at ต้องเป็น ISO 8601' })
  ends_at!: string;
}

export class ListMeetingsQuery extends PaginationQuery {
  @ApiPropertyOptional({ description: 'กรองเฉพาะห้องนี้' })
  @IsOptional()
  @IsUUID('4')
  channel_id?: string;

  @ApiPropertyOptional({
    description:
      'true = เอาเฉพาะนัดที่ยังไม่จบ (default) · false = ดูย้อนหลังทั้งหมด',
    example: 'true',
  })
  @IsOptional()
  @IsString()
  upcoming_only?: string;
}

export class MeetingResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() channel_id!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ nullable: true }) agenda!: string | null;
  @ApiProperty({ example: '2026-09-15T13:00:00+07:00' }) starts_at!: string;
  @ApiProperty() ends_at!: string;
  @ApiProperty({ enum: MeetingStatus }) status!: MeetingStatus;
  @ApiProperty() created_by_username!: string;

  @ApiProperty({
    description:
      'ตอนนี้อยู่ในช่วงเวลาประชุมแล้วหรือยัง — คำนวณจากเวลาเซิร์ฟเวอร์ เพื่อไม่ให้ ' +
      'นาฬิกาที่ตั้งผิดในเครื่องผู้ใช้ทำให้ปุ่มเข้าห้องโผล่ผิดเวลา',
  })
  joinable_now!: boolean;

  @ApiProperty() created_at!: string;
}

export function toMeetingResponse(row: MeetingModel): MeetingResponseDto {
  const now = Date.now();

  return {
    id: row.id,
    channel_id: row.channelId,
    title: row.title,
    agenda: row.agenda,
    starts_at: row.startsAt.toISOString(),
    ends_at: row.endsAt.toISOString(),
    status: row.status,
    created_by_username: row.createdByUsername,
    joinable_now:
      row.status !== 'CANCELLED' &&
      now >= row.startsAt.getTime() - 10 * 60 * 1000 && // เข้าได้ก่อนเวลา 10 นาที
      now <= row.endsAt.getTime(),
    created_at: row.createdAt.toISOString(),
  };
}
