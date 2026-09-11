import { ApiProperty } from '@nestjs/swagger';
import {
  IsEnum,
  IsIn,
  IsString,
  IsUUID,
  Length,
} from 'class-validator';
import { ReactionTarget } from '../../../generated/prisma/enums.js';

/// อิโมจิที่อนุญาต — เป็นรายการปิด ไม่ใช่ปล่อยอิสระ
///
/// เหตุผล: ถ้ารับอิโมจิอะไรก็ได้ ข้อความเดียวจะมีแถบรีแอ็กชัน 200 ตัวไม่ซ้ำกัน
/// ได้ (ทุกคนเลือกคนละตัว) ซึ่งทำให้แถบนั้นอ่านไม่ได้และคิวรีนับก็บวมตาม
/// สิบสองตัวนี้ครอบของ Facebook (like/love/haha/wow/sad/angry) ของ Teams
/// และของที่คนเรียนโปรแกรมมิ่งใช้จริง (✅ ❓ 💡 สำหรับตอบคำถามในกระดาน)
///
/// เพิ่มตัวใหม่ = แก้อาเรย์นี้บรรทัดเดียว ไม่ต้อง migrate เพราะเก็บเป็น string
export const ALLOWED_EMOJI = [
  '👍',
  '❤️',
  '😂',
  '😮',
  '😢',
  '😠',
  '🎉',
  '🔥',
  '🙏',
  '✅',
  '❓',
  '💡',
] as const;

export type AllowedEmoji = (typeof ALLOWED_EMOJI)[number];

export class ReactionTargetQuery {
  @ApiProperty({ enum: ReactionTarget, example: 'POST' })
  @IsEnum(ReactionTarget, { message: 'target_kind ต้องเป็น MESSAGE, POST หรือ REEL' })
  target_kind!: ReactionTarget;

  @ApiProperty({ example: '9f1c2b3a-0000-4000-8000-000000000000' })
  @IsUUID('4', { message: 'target_id ต้องเป็น UUID' })
  target_id!: string;
}

export class ReactDto extends ReactionTargetQuery {
  @ApiProperty({ enum: ALLOWED_EMOJI, example: '👍' })
  @IsString()
  @IsIn(ALLOWED_EMOJI as unknown as string[], {
    message: `อิโมจิที่ใช้ได้: ${ALLOWED_EMOJI.join(' ')}`,
  })
  emoji!: string;
}

export class UnreactQuery extends ReactDto {}

export class EmojiCountDto {
  @ApiProperty({ example: '👍' }) emoji!: string;
  @ApiProperty({ example: 12 }) count!: number;

  @ApiProperty({ description: 'ฉันกดอิโมจินี้อยู่ไหม' })
  reacted_by_me!: boolean;
}

export class ReactionSummaryDto {
  @ApiProperty({ enum: ReactionTarget }) target_kind!: ReactionTarget;
  @ApiProperty() target_id!: string;

  @ApiProperty({
    type: [EmojiCountDto],
    description: 'เรียงจากยอดมากไปน้อย เอาเฉพาะอิโมจิที่มีคนกดจริง',
  })
  totals!: EmojiCountDto[];

  @ApiProperty({ example: 15, description: 'ผลรวมทุกอิโมจิ' })
  total_count!: number;
}

/// เพดานจำนวน id ต่อหนึ่งคำขอ — หนึ่งหน้าจอไม่เคยแสดงเกินนี้
///
/// มีเพดานเพราะ target_ids มาจาก query string ซึ่งยาวได้จำกัด และเพื่อไม่ให้
/// ใครยิง id หมื่นตัวมาให้ groupBy ทำงานหนักในคำขอเดียว
export const MAX_SUMMARY_TARGETS = 100;

/// ขอยอดรีแอ็กชันของหลายชิ้นในคำขอเดียว
///
/// แก้ N+1 ที่หน้าจอแชท: เดิมหน้าบ้านยิงหนึ่งคำขอต่อหนึ่งข้อความ
/// สามสิบข้อความในหน้าจอ = สามสิบ round trip ซึ่งบนเน็ตจริง (80 ms ต่อรอบ)
/// คือการรอที่ผู้ใช้รู้สึกได้ ทั้งที่หลังบ้านมี summariesFor ที่ทำได้ในสองคิวรี
/// อยู่แล้วตั้งแต่แรก — ขาดแค่ทางเข้า
export class ReactionSummariesQuery {
  @ApiProperty({ enum: ReactionTarget, example: 'MESSAGE' })
  @IsEnum(ReactionTarget, {
    message: 'target_kind ต้องเป็น MESSAGE, POST หรือ REEL',
  })
  target_kind!: ReactionTarget;

  @ApiProperty({
    description: `id คั่นด้วยลูกน้ำ สูงสุด ${MAX_SUMMARY_TARGETS} ตัว`,
    example: '9f1c2b3a-0000-4000-8000-000000000000,...',
  })
  @IsString()
  @Length(1, 4000)
  target_ids!: string;
}
