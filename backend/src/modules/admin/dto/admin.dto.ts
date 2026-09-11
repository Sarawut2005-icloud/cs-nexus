import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Min,
} from 'class-validator';
import { PaginationQuery } from '../../../common/http/pagination.dto.js';
import { Layer2Role } from '../../../generated/prisma/enums.js';
import type {
  AuditLogModel,
  SubsystemMemberModel,
} from '../../../generated/prisma/models.js';
import { USERNAME_PATTERN } from '../../follows/dto/follow.dto.js';

/// เพดานโควตาที่ผู้ดูแลตั้งให้คนหนึ่งได้ — 5 GB
///
/// มีเพดานเพราะพื้นที่เก็บไฟล์ของฟรีเทียร์คือ 1 GB ทั้งระบบ ถ้าไม่จำกัด
/// การพิมพ์เลขผิดหนึ่งครั้ง (ใส่ศูนย์เกิน) จะทำให้คนเดียวจองพื้นที่ได้เกิน
/// ที่ระบบมีจริง แล้วคนอื่นอัปโหลดไม่ได้ทั้งคณะ
export const MAX_QUOTA_BYTES = 5 * 1024 * 1024 * 1024;

export class ListAuditLogsQuery extends PaginationQuery {
  @ApiPropertyOptional({
    example: '6704101382-anuchat',
    description: 'กรองตามผู้กระทำ',
  })
  @IsOptional()
  @IsString()
  @Length(2, 64)
  actor_username?: string;

  @ApiPropertyOptional({
    example: 'message.delete',
    description: 'กรองตามการกระทำ เช่น reel.delete, report.resolved',
  })
  @IsOptional()
  @IsString()
  @Length(1, 64)
  action?: string;

  @ApiPropertyOptional({
    example: '2026-09-01T00:00:00+07:00',
    description: 'เอาเฉพาะรายการตั้งแต่เวลานี้ (ISO 8601)',
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  since?: string;

  @ApiPropertyOptional({ example: '2026-09-30T23:59:59+07:00' })
  @IsOptional()
  @IsISO8601({ strict: true })
  until?: string;
}

export class AuditLogResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: '6700000001-ajarn' }) actor_username!: string;
  @ApiProperty({ example: 'staff' }) actor_layer1_role!: string;
  @ApiProperty({ example: 'message.delete' }) action!: string;
  @ApiProperty({ example: 'MESSAGE' }) target_kind!: string;
  @ApiProperty() target_id!: string;

  @ApiProperty({
    nullable: true,
    description: 'บริบทตอนเกิดเหตุ เช่นใครเป็นเจ้าของของที่ถูกลบ',
  })
  metadata!: unknown;

  @ApiProperty() created_at!: string;
}

export class ListMembersQuery extends PaginationQuery {
  @ApiPropertyOptional({ enum: Layer2Role })
  @IsOptional()
  @IsIn(['GUEST', 'EDITOR', 'ADMIN'])
  layer2_role?: Layer2Role;

  @ApiPropertyOptional({
    description: 'ค้นจาก username บางส่วน',
    example: '67041',
  })
  @IsOptional()
  @IsString()
  @Length(1, 64)
  q?: string;
}

export class UpdateMemberRoleDto {
  @ApiProperty({
    enum: Layer2Role,
    description:
      'สิทธิ์ในระบบย่อยนี้เท่านั้น (Layer 2) — เปลี่ยนสิทธิ์ระดับองค์กร (Layer 1) ที่นี่ไม่ได้ ต้องไปที่ Admin Panel กลาง',
  })
  @IsIn(['GUEST', 'EDITOR', 'ADMIN'], {
    message: 'layer2_role ต้องเป็น GUEST, EDITOR หรือ ADMIN',
  })
  layer2_role!: Layer2Role;

  @ApiPropertyOptional({
    description: 'เหตุผล เก็บลง audit log เพื่อให้ตรวจย้อนหลังได้',
    example: 'ตั้งเป็นผู้ช่วยสอนประจำวิชา CS201',
  })
  @IsOptional()
  @IsString()
  @Length(0, 500)
  reason?: string;
}

export class UpdateMemberQuotaDto {
  @ApiProperty({
    example: 1073741824,
    description: `โควตาใหม่เป็นไบต์ สูงสุด ${MAX_QUOTA_BYTES} (5 GB)`,
  })
  @Type(() => Number)
  @IsInt({ message: 'storage_quota_bytes ต้องเป็นจำนวนเต็ม' })
  @Min(0)
  storage_quota_bytes!: number;

  @ApiPropertyOptional({ example: 'อาจารย์ขอพื้นที่เพิ่มสำหรับคลิปสอน' })
  @IsOptional()
  @IsString()
  @Length(0, 500)
  reason?: string;
}

export class MemberTargetParam {
  @ApiProperty({ example: '6704101382-anuchat' })
  @IsString()
  @Matches(USERNAME_PATTERN, { message: 'รูปแบบ username ไม่ถูกต้อง' })
  username!: string;
}

export class MemberResponseDto {
  @ApiProperty() username!: string;
  @ApiProperty({ enum: Layer2Role }) layer2_role!: Layer2Role;

  @ApiProperty({
    description:
      'true = ผู้ดูแลตั้งด้วยมือ · false = แปลงมาจากสิทธิ์ระดับองค์กรอัตโนมัติ',
  })
  layer2_role_explicit!: boolean;
  @ApiProperty({ example: '48120040' }) storage_used_bytes!: string;
  @ApiProperty({ example: '209715200' }) storage_quota_bytes!: string;
  @ApiProperty() created_at!: string;
  @ApiProperty() updated_at!: string;
}

export function toAuditLogResponse(row: AuditLogModel): AuditLogResponseDto {
  return {
    id: row.id,
    actor_username: row.actorUsername,
    actor_layer1_role: row.actorLayer1Role,
    action: row.action,
    target_kind: row.targetKind,
    target_id: row.targetId,
    metadata: row.metadata ?? null,
    created_at: row.createdAt.toISOString(),
  };
}

export function toMemberResponse(
  row: SubsystemMemberModel,
): MemberResponseDto {
  return {
    username: row.username,
    layer2_role: row.layer2Role,
    layer2_role_explicit: row.layer2RoleExplicit,
    storage_used_bytes: row.storageUsedBytes.toString(),
    storage_quota_bytes: row.storageQuotaBytes.toString(),
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}
