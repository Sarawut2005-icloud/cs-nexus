import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { PaginationMeta } from './envelope.js';

/// Query มาตรฐานของทุก list endpoint (Blueprint หน้า 7)
///   GET /api/v1/equipment-items?page=2&per_page=50
export class PaginationQuery {
  @ApiPropertyOptional({ minimum: 1, default: 1, example: 2 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'page ต้องเป็นจำนวนเต็ม' })
  @Min(1, { message: 'page ต้องเริ่มที่ 1' })
  page: number = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20, example: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'per_page ต้องเป็นจำนวนเต็ม' })
  @Min(1)
  @Max(100, { message: 'per_page สูงสุด 100 รายการ' })
  per_page: number = 20;

  get skip(): number {
    return (this.page - 1) * this.per_page;
  }

  get take(): number {
    return this.per_page;
  }

  meta(totalItems: number): PaginationMeta {
    return {
      current_page: this.page,
      per_page: this.per_page,
      total_pages: Math.max(1, Math.ceil(totalItems / this.per_page)),
      total_items: totalItems,
    };
  }
}
