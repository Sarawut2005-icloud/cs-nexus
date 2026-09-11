import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length, Matches } from 'class-validator';

/// รูปแบบ username ของ CSMJU2030 เช่น "6704101382-anuchat"
/// ตรวจที่นี่เพื่อไม่ให้ใครยัดอักขระแปลก ๆ ลงกราฟการติดตาม
export const USERNAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{1,63}$/;

export class FollowDto {
  @ApiProperty({ example: '6700000001-ajarn' })
  @IsString()
  @Length(2, 64)
  @Matches(USERNAME_PATTERN, { message: 'รูปแบบ username ไม่ถูกต้อง' })
  username!: string;
}

export class FollowEdgeDto {
  @ApiProperty({ example: '6704101382-anuchat' }) username!: string;
  @ApiProperty() created_at!: string;
}

/// ความสัมพันธ์ระหว่างฉันกับอีกคน — หน้าบ้านใช้ตัดสินว่าปุ่มควรเขียนว่าอะไร
///
/// ติดตามเป็นทิศทางเดียว ความเป็นเพื่อนสองทางคำนวณจากการมีทั้งสองด้าน
/// จึงไม่ต้องมีขั้นตอน "ส่งคำขอเป็นเพื่อน / กดตอบรับ" ให้ผู้ใช้ทำ
export class RelationDto {
  @ApiProperty({ description: 'ฉันติดตามเขาอยู่ไหม' })
  following!: boolean;

  @ApiProperty({ description: 'เขาติดตามฉันอยู่ไหม' })
  followed_by!: boolean;

  @ApiProperty({ description: 'ติดตามกันทั้งสองทาง = เพื่อนกันแบบ Facebook' })
  mutual!: boolean;
}

export class FollowStatsDto {
  @ApiProperty({ example: 42 }) follower_count!: number;
  @ApiProperty({ example: 17 }) following_count!: number;
}
