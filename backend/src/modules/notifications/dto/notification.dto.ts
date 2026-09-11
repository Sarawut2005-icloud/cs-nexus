import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBooleanString, IsOptional } from 'class-validator';
import { PaginationQuery } from '../../../common/http/pagination.dto.js';
import type { NotificationModel } from '../../../generated/prisma/models.js';

export class ListNotificationsQuery extends PaginationQuery {
  @ApiPropertyOptional({
    description: 'true = เอาเฉพาะที่ยังไม่อ่าน',
    example: 'true',
  })
  @IsOptional()
  @IsBooleanString({ message: 'unread_only ต้องเป็น true หรือ false' })
  unread_only?: string;
}

export class NotificationResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'MENTION' }) kind!: string;
  @ApiProperty({ description: 'id ของสิ่งที่ถูกกระทำ' }) ref_id!: string;

  @ApiProperty({ nullable: true, example: '6700000001-ajarn' })
  actor_username!: string | null;

  @ApiProperty({
    nullable: true,
    description: 'บริบทเพิ่มเติมตอนเกิดเหตุ เช่น channel_id, emoji, preview',
    example: { channel_id: 'b1f0c2de-...', preview: 'ฝากดูโค้ดหน่อยครับ' },
  })
  payload!: unknown;

  @ApiProperty({ nullable: true }) read_at!: string | null;
  @ApiProperty() created_at!: string;
}

export class UnreadCountDto {
  @ApiProperty({ example: 7 }) unread_count!: number;
}

export function toNotificationResponse(
  row: NotificationModel,
): NotificationResponseDto {
  return {
    id: row.id,
    kind: row.kind,
    ref_id: row.refId,
    actor_username: row.actorUsername,
    payload: row.payload ?? null,
    read_at: row.readAt?.toISOString() ?? null,
    created_at: row.createdAt.toISOString(),
  };
}
