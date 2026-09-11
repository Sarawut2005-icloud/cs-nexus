import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsIn, IsOptional, IsString, Length } from 'class-validator';
import { PaginationQuery } from '../../../common/http/pagination.dto.js';
import {
  ReportStatus,
  ReportTarget,
} from '../../../generated/prisma/enums.js';
import type { ReportModel } from '../../../generated/prisma/models.js';

export class CreateReportDto {
  @ApiProperty({ enum: ReportTarget, example: 'POST' })
  @IsEnum(ReportTarget, {
    message: 'target_kind ต้องเป็น REEL, POST, MESSAGE, COMMENT หรือ USER',
  })
  target_kind!: ReportTarget;

  @ApiProperty({
    example: '9f1c2b3a-0000-4000-8000-000000000000',
    description: 'id ของสิ่งที่รายงาน · ถ้าเป็น USER ให้ใส่ username',
  })
  @IsString()
  @Length(1, 128)
  target_id!: string;

  @ApiProperty({ example: 'โพสต์นี้มีข้อความคุกคามรุ่นน้อง' })
  @IsString()
  @Length(10, 1000, {
    message: 'เหตุผลต้องยาว 10-1000 ตัวอักษร เพื่อให้ผู้ดูแลตัดสินได้',
  })
  reason!: string;
}

export class ListReportsQuery extends PaginationQuery {
  @ApiPropertyOptional({ enum: ReportStatus, default: 'OPEN' })
  @IsOptional()
  @IsEnum(ReportStatus)
  status?: ReportStatus;

  @ApiPropertyOptional({ enum: ReportTarget })
  @IsOptional()
  @IsEnum(ReportTarget)
  target_kind?: ReportTarget;
}

export class ResolveReportDto {
  @ApiProperty({
    enum: ['RESOLVED', 'REJECTED'],
    description: 'RESOLVED = จัดการแล้ว · REJECTED = พิจารณาแล้วไม่เข้าข่าย',
  })
  @IsIn(['RESOLVED', 'REJECTED'], {
    message: 'status ต้องเป็น RESOLVED หรือ REJECTED',
  })
  status!: 'RESOLVED' | 'REJECTED';

  @ApiPropertyOptional({ description: 'บันทึกของผู้ดูแล เก็บลง audit log' })
  @IsOptional()
  @IsString()
  @Length(0, 1000)
  note?: string;
}

export class ReportResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: ReportTarget }) target_kind!: ReportTarget;
  @ApiProperty() target_id!: string;
  @ApiProperty() reason!: string;
  @ApiProperty({ enum: ReportStatus }) status!: ReportStatus;

  @ApiProperty({
    description:
      'ผู้รายงาน — ผู้ดูแลเห็นได้ เพราะการรายงานเท็จซ้ำ ๆ ต้องตามตัวได้',
  })
  reporter_username!: string;

  @ApiProperty({ nullable: true }) resolved_by_username!: string | null;
  @ApiProperty({ nullable: true }) resolved_at!: string | null;
  @ApiProperty() created_at!: string;
}

export function toReportResponse(row: ReportModel): ReportResponseDto {
  return {
    id: row.id,
    target_kind: row.targetKind,
    target_id: row.targetId,
    reason: row.reason,
    status: row.status,
    reporter_username: row.reporterUsername,
    resolved_by_username: row.resolvedByUsername,
    resolved_at: row.resolvedAt?.toISOString() ?? null,
    created_at: row.createdAt.toISOString(),
  };
}
