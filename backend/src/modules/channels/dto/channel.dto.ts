import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Min,
} from 'class-validator';
import type { ChannelModel } from '../../../generated/prisma/models.js';

export const CREATABLE_KINDS = ['GROUP', 'COURSE', 'VOICE'] as const;
export type CreatableKind = (typeof CREATABLE_KINDS)[number];

export class CreateChannelDto {
  @ApiProperty({
    enum: CREATABLE_KINDS,
    description: 'DM สร้างผ่าน /direct-channels แทน เพราะต้องหาห้องเดิมก่อน',
  })
  @IsIn(CREATABLE_KINDS)
  kind!: CreatableKind;

  @ApiProperty({ example: 'ติวสอบ Data Structures' })
  @IsString()
  @Length(1, 80, { message: 'ชื่อห้องต้องยาว 1-80 ตัวอักษร' })
  name!: string;

  @ApiPropertyOptional({ example: 'CS201' })
  @IsOptional()
  @IsString()
  @Length(1, 20)
  course_tag?: string;

  @ApiPropertyOptional({
    minimum: 2,
    default: 8,
    description:
      'เพดานคนในห้องเสียง — mesh P2P รับไหวถึง 8 คน เกินกว่านั้นเสียงจะขาด',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2)
  max_seats?: number;
}

export class CreateDirectChannelDto {
  @ApiProperty({
    example: '6704101999-somchai',
    description: 'coreUserId ของอีกฝ่าย ตาม Shared Identity ของ CSMJU2030',
  })
  @IsString()
  @Matches(/^[A-Za-z0-9._-]{3,64}$/, {
    message: 'coreUserId ไม่ถูกต้องตามรูปแบบของระบบกลาง',
  })
  peer_core_user_id!: string;
}

export class AddMembersDto {
  @ApiProperty({ type: [String], example: ['6704101999-somchai'] })
  @IsArray()
  @ArrayMaxSize(50, { message: 'เพิ่มได้ครั้งละไม่เกิน 50 คน' })
  @IsString({ each: true })
  coreUserIds!: string[];
}

export class ChannelResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: ['DM', 'GROUP', 'COURSE', 'VOICE'] }) kind!: string;
  @ApiProperty({ nullable: true }) name!: string | null;
  @ApiProperty({ nullable: true }) course_tag!: string | null;
  @ApiProperty() max_seats!: number;
  @ApiProperty() member_count!: number;

  @ApiProperty({ enum: ['MEMBER', 'MODERATOR'] })
  my_role!: string;

  @ApiProperty({ description: 'จำนวนข้อความที่ยังไม่ได้อ่าน' })
  unread_count!: number;

  /// คู่สนทนาของห้อง DM — null สำหรับห้องชนิดอื่น
  ///
  /// **ถ้าไม่มีค่านี้ ปุ่มโทรในหน้าแชทส่วนตัวจะกดไม่ได้เลย** เพราะหน้าบ้าน
  /// ไม่มีทางรู้ว่าจะโทรหา `coreUserId` ไหน ก่อนหน้านี้มันเดาจาก `name` ของ
  /// ห้อง ซึ่งห้อง DM ไม่เคยตั้งชื่อ ปุ่มจึงถูกปิดใช้งานถาวรทุกห้อง
  ///
  /// ส่งเฉพาะห้อง DM เพราะห้องกลุ่มไม่มี "คู่" และการส่งรายชื่อสมาชิกทั้งหมด
  /// มากับรายการห้องจะกลายเป็นคิวรีต่อหนึ่งห้อง (N+1) ตอนโหลดรายการ
  @ApiProperty({
    nullable: true,
    description: 'coreUserId ของคู่สนทนา (เฉพาะห้อง DM)',
  })
  peer_core_user_id!: string | null;

  @ApiProperty() created_at!: string;
}

export function toChannelResponse(
  channel: ChannelModel,
  extra: {
    memberCount: number;
    myRole: string;
    unreadCount: number;
    /// ผู้เรียกที่รู้จักคู่สนทนาส่งมาให้ — ไม่ส่งมาก็ถือว่าไม่มี
    peerCoreUserId?: string | null;
  },
): ChannelResponseDto {
  return {
    id: channel.id,
    kind: channel.kind,
    name: channel.name,
    course_tag: channel.courseTag,
    max_seats: channel.maxSeats,
    member_count: extra.memberCount,
    my_role: extra.myRole,
    unread_count: extra.unreadCount,
    peer_core_user_id: extra.peerCoreUserId ?? null,
    created_at: channel.createdAt.toISOString(),
  };
}
