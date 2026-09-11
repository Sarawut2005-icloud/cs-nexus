import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, Length } from 'class-validator';

/// อายุของสตอรี่ — 24 ชั่วโมงเหมือน Instagram และ Facebook
///
/// เก็บเป็นเวลาหมดอายุตายตัวในฐานข้อมูล ไม่คำนวณสด ๆ ตอนคิวรี
/// เพราะถ้าวันหนึ่งเปลี่ยนค่านี้ สตอรี่เก่าจะยืดหรือหดอายุตามย้อนหลัง
/// ซึ่งไม่ตรงกับที่ผู้โพสต์ตกลงไว้ตอนกดโพสต์
export const STORY_TTL_MS = 24 * 60 * 60 * 1000;

export class CreateStoryDto {
  @ApiProperty({
    description: 'ไฟล์ที่อัปโหลดและ commit เสร็จแล้ว ต้องเป็นรูปหรือวิดีโอ',
  })
  @IsUUID('4')
  asset_id!: string;

  @ApiPropertyOptional({ example: 'ติวกันคืนนี้ 20:00 นะ' })
  @IsOptional()
  @IsString()
  @Length(1, 300)
  caption?: string;
}

export class StoryItemDto {
  @ApiProperty() id!: string;
  @ApiProperty() author_username!: string;

  @ApiProperty({ enum: ['IMAGE', 'VIDEO'] })
  kind!: string;

  @ApiProperty({
    description:
      'signed URL อายุสั้น — ถ้าเปิดค้างไว้นานแล้วโหลดไม่ขึ้น ให้ดึงรายการใหม่',
  })
  media_url!: string;

  @ApiProperty({ description: 'ใช้ขอ URL ใหม่ถ้าอันเดิมหมดอายุ' })
  asset_id!: string;

  @ApiProperty({ nullable: true }) caption!: string | null;
  @ApiProperty({ description: 'ผู้เรียกดูสตอรี่นี้ไปแล้วหรือยัง' })
  viewed_by_me!: boolean;

  @ApiProperty({
    example: 12,
    description: 'จำนวนผู้ชม — เจ้าของเห็นเลขจริง คนอื่นเห็น 0',
  })
  view_count!: number;

  @ApiProperty() created_at!: string;
  @ApiProperty() expires_at!: string;
}

/// สตอรี่จัดกลุ่มตามเจ้าของ — รูปแบบที่แถวรูปโปรไฟล์ด้านบนฟีดต้องใช้
export class StoryTrayDto {
  @ApiProperty() author_username!: string;

  @ApiProperty({
    description: 'ยังมีสตอรี่ที่ผู้เรียกไม่ได้ดู — ใช้ตัดสินว่าวงแหวนติดสีไหม',
  })
  has_unseen!: boolean;

  @ApiProperty({ description: 'true = เป็นสตอรี่ของผู้เรียกเอง' })
  is_me!: boolean;

  @ApiProperty({ type: [StoryItemDto] })
  stories!: StoryItemDto[];
}

export class StoryViewerDto {
  @ApiProperty() username!: string;
  @ApiProperty() viewed_at!: string;
}
