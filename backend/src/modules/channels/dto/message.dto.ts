import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaginationQuery } from '../../../common/http/pagination.dto.js';

export class MessageEmbedDto {
  @ApiProperty({ enum: ['REEL', 'POST'] })
  @IsIn(['REEL', 'POST'])
  kind!: 'REEL' | 'POST';

  @ApiProperty()
  @IsUUID('4')
  ref_id!: string;
}

export class SendMessageDto {
  @ApiPropertyOptional({ example: 'ส่งไฟล์โปรเจกต์ให้แล้วนะ' })
  @IsOptional()
  @IsString()
  @Length(1, 4000, { message: 'ข้อความยาวได้ไม่เกิน 4000 ตัวอักษร' })
  content?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10, { message: 'แนบไฟล์ได้ครั้งละไม่เกิน 10 ไฟล์' })
  @IsUUID('4', { each: true })
  asset_ids?: string[];

  @ApiPropertyOptional({
    type: MessageEmbedDto,
    description: 'แชร์คลิป Reels หรือโพสต์เข้าแชท — แสดงเป็น mini player',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => MessageEmbedDto)
  embed?: MessageEmbedDto;

  @ApiPropertyOptional({
    description:
      'ตอบกลับในเธรดของข้อความนี้ (แบบ Discord/Teams) — ข้อความที่มี parent_id ' +
      'จะไม่โผล่ในไทม์ไลน์หลัก และเธรดซ้อนเธรดไม่ได้',
  })
  @IsOptional()
  @IsUUID('4')
  parent_id?: string;

  @ApiProperty({
    description:
      'client สร้างเอง กันส่งซ้ำตอนเน็ตกระตุก และใช้เป็นคีย์ชั่วคราวใน UI',
    example: '01J9F2K7Q8',
  })
  @IsString()
  @Length(6, 64)
  client_nonce!: string;
}

export class EditMessageDto {
  @ApiProperty({ example: 'ขอแก้เป็น struct ไม่ใช่ class ครับ' })
  @IsString()
  @Length(1, 4000)
  content!: string;
}

export class ListMessagesQuery extends PaginationQuery {
  @ApiPropertyOptional({
    description:
      'ดึงเฉพาะข้อความที่ seq มากกว่าค่านี้ — ใช้ตอน socket หลุดแล้วต่อใหม่ ' +
      'เพื่อเติมช่วงที่ขาดโดยไม่ต้องโหลดทั้งห้อง',
    example: 1420,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  after_seq?: number;
}

export class MessageAttachmentDto {
  @ApiProperty() id!: string;
  @ApiProperty() file_name!: string;
  @ApiProperty() kind!: string;
  @ApiProperty() mime_type!: string;
  @ApiProperty({ example: '48120' }) size_bytes!: string;
}

export class MessageResponseDto {
  @ApiProperty() id!: string;

  @ApiProperty({
    description: 'ลำดับจริงของข้อความในห้อง — ใช้ตัวนี้เรียง ไม่ใช่ created_at',
    example: 1421,
  })
  seq!: number;

  @ApiProperty() channel_id!: string;
  @ApiProperty() author_username!: string;
  @ApiProperty({ nullable: true }) content!: string | null;
  @ApiProperty({ type: [MessageAttachmentDto] })
  attachments!: MessageAttachmentDto[];

  @ApiProperty({ nullable: true, type: MessageEmbedDto })
  embed!: { kind: string; ref_id: string } | null;

  @ApiProperty({
    nullable: true,
    description: 'ถ้าไม่ null ข้อความนี้เป็นคำตอบในเธรดของ id นั้น',
  })
  parent_id!: string | null;

  @ApiProperty({ example: 0, description: 'จำนวนคำตอบในเธรดของข้อความนี้' })
  reply_count!: number;

  @ApiProperty({ nullable: true }) pinned_at!: string | null;
  @ApiProperty({ nullable: true }) pinned_by_username!: string | null;

  @ApiProperty() client_nonce!: string;
  @ApiProperty({ nullable: true }) edited_at!: string | null;
  @ApiProperty() created_at!: string;
}
