import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, Length, ValidateIf } from 'class-validator';
import { RelationDto } from '../../follows/dto/follow.dto.js';

export class ResolveProfilesQuery {
  @ApiPropertyOptional({
    description: 'รายชื่อ username คั่นด้วยลูกน้ำ สูงสุด 100 ชื่อต่อครั้ง',
    example: '6704101382-anuchat,6700000001-ajarn',
  })
  @IsOptional()
  @IsString()
  @Length(1, 6500)
  usernames?: string;
}

export class ProfileSummaryDto {
  @ApiProperty({ example: '6704101382-anuchat' }) username!: string;

  @ApiProperty({
    description:
      'ชื่อที่แสดง มาจาก Core ผ่านแคช — ถ้ายังไม่เคยซิงก์จะคืน username ไปก่อน',
    example: 'อนุชาติ ณัฐธยานนท์',
  })
  display_name!: string;

  @ApiProperty({ nullable: true }) avatar_url!: string | null;

  @ApiProperty({
    nullable: true,
    description: 'เวลาที่ซิงก์จาก Core ล่าสุด — null คือยังไม่เคยซิงก์',
  })
  synced_at!: string | null;

  @ApiProperty({
    enum: ['ADMIN', 'STAFF'],
    nullable: true,
    description:
      'เครื่องหมายยืนยันข้างชื่อ · null = สมาชิกทั่วไป · มาจาก layer2_role ของระบบย่อยนี้ ไม่ใช่ layer1_role (ซึ่งเราห้ามเก็บตามหน้า 10)',
  })
  badge!: 'ADMIN' | 'STAFF' | null;
}

export class ProfileStatsDto {
  @ApiProperty({ example: 12 }) reel_count!: number;
  @ApiProperty({ example: 34 }) post_count!: number;
  @ApiProperty({ example: 128 }) follower_count!: number;
  @ApiProperty({ example: 76 }) following_count!: number;
}

export class ProfileDetailDto extends ProfileSummaryDto {
  @ApiProperty({ type: ProfileStatsDto }) stats!: ProfileStatsDto;

  @ApiProperty({
    type: RelationDto,
    description: 'ความสัมพันธ์ระหว่างผู้เรียกกับเจ้าของโปรไฟล์นี้',
  })
  relation!: RelationDto;

  @ApiProperty({
    nullable: true,
    description:
      'สิทธิ์ในระบบย่อยนี้ (Layer 2) — แสดงเฉพาะโปรไฟล์ตัวเอง เพราะสิทธิ์ของคนอื่นไม่ใช่ข้อมูลสาธารณะ',
    example: 'GUEST',
  })
  layer2_role!: string | null;

  @ApiProperty({
    nullable: true,
    description: 'เข้าใช้ระบบย่อยนี้ครั้งแรกเมื่อไหร่',
  })
  joined_at!: string | null;
}

/// แก้ได้เฉพาะสิ่งที่เป็นของระบบย่อยนี้
///
/// **ไม่มี display_name / avatar_url / faculty ในนี้โดยตั้งใจ** —
/// Blueprint หน้า 10 กำหนดว่า Core เป็นแหล่งความจริงของตัวตน ถ้าเปิดให้แก้
/// ที่นี่จะเกิดสองเวอร์ชันของชื่อคนเดียวกัน แล้วไม่มีใครรู้ว่าอันไหนจริง
///
/// สิ่งที่แก้ได้คือ **เนื้อหาที่ผู้ใช้เขียนเพื่อชุมชนนี้** ซึ่งเป็นของเขาเอง
/// เหมือนโพสต์หรือคอมเมนต์
export class UpdateMyProfileDto {
  @ApiPropertyOptional({
    example: 'ปี 3 สาขาวิทยาการคอมพิวเตอร์ · สนใจ backend และ DevOps',
    description: 'คำแนะนำตัวในระบบย่อยนี้ · ส่งสตริงว่างเพื่อลบ',
  })
  @IsOptional()
  @IsString()
  @Length(0, 300, { message: 'คำแนะนำตัวยาวได้ไม่เกิน 300 ตัวอักษร' })
  bio?: string;

  @ApiPropertyOptional({
    description:
      'ไฟล์รูปปก ต้องอัปโหลดและ commit เสร็จแล้ว · ส่ง null เพื่อเอารูปปกออก',
    nullable: true,
  })
  @IsOptional()
  // ยอมรับ null เพื่อสั่งลบรูปปก — ValidateIf ปล่อยผ่านเมื่อเป็น null
  @ValidateIf((_object, value) => value !== null)
  @IsUUID('4')
  cover_asset_id?: string | null;
}

export class MyProfileDto extends ProfileDetailDto {
  @ApiProperty({ nullable: true, description: 'คำแนะนำตัวในระบบย่อยนี้' })
  bio!: string | null;

  @ApiProperty({
    nullable: true,
    description: 'signed URL ของรูปปก — อายุสั้น ขอใหม่ได้ทุกครั้งที่โหลดโปรไฟล์',
  })
  cover_url!: string | null;

  @ApiProperty({
    description:
      'field ที่แก้ที่ระบบย่อยนี้ไม่ได้ เพราะ Core เป็นแหล่งความจริง (หน้า 10)',
    example: ['display_name', 'avatar_url', 'faculty', 'layer1_role'],
  })
  managed_by_core!: string[];
}
