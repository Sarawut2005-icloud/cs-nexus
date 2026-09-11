import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, Length } from 'class-validator';
import { ApiEnvelope } from '../../common/http/api-envelope.decorator.js';
import { EventsGateway } from './events.gateway.js';

export class PresenceQuery {
  @ApiPropertyOptional({
    description:
      'รายชื่อ username คั่นด้วยลูกน้ำ · เว้นว่างเพื่อขอทุกคนที่ออนไลน์อยู่',
    example: '6704101382-anuchat,6700000001-ajarn',
  })
  @IsOptional()
  @IsString()
  @Length(1, 6500)
  usernames?: string;
}

export class PresenceResponseDto {
  @ApiProperty({
    type: [String],
    description: 'คนที่มี socket เปิดอยู่ตอนนี้',
    example: ['6704101382-anuchat'],
  })
  online_usernames!: string[];

  @ApiProperty({
    example: 3,
    description: 'จำนวนคนที่ออนไลน์ทั้งระบบ (ไม่ขึ้นกับตัวกรอง usernames)',
  })
  total_online!: number;
}

/// ใครออนไลน์อยู่ตอนนี้
///
/// ต้องมีทั้ง REST และ event `presence:changed`:
///   - event บอก "การเปลี่ยนแปลง" แต่คนที่เพิ่งเปิดหน้าไม่เคยได้ยิน event
///     ของคนที่ออนไลน์อยู่ก่อนแล้ว
///   - REST ให้ภาพตั้งต้น แล้ว event ทำให้มันสดต่อ
///
/// ข้อจำกัดที่ต้องรู้: สถานะออนไลน์นับจาก socket ที่เปิดอยู่ในโพรเซสนี้
/// ถ้าสเกลเป็นหลาย instance ต้องย้ายไป Redis ไม่งั้นแต่ละ instance จะเห็น
/// คนละครึ่งของผู้ใช้
///
/// TODO(PL): ถาม PM ว่าต้องมีปุ่ม "ซ่อนสถานะออนไลน์" ไหม — ตอนนี้ทุกคน
/// ในระบบย่อยเห็นสถานะของกันหมด (เหมือน Discord) ซึ่ง Instagram ให้ปิดได้
@ApiTags('presence')
@Controller('presence')
export class PresenceController {
  constructor(private readonly events: EventsGateway) {}

  @Get()
  @ApiOperation({ summary: 'ใครออนไลน์อยู่ตอนนี้' })
  @ApiEnvelope(PresenceResponseDto)
  get(@Query() query: PresenceQuery): PresenceResponseDto {
    const online = this.events.onlineUsernames();

    const asked = (query.usernames ?? '')
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean);

    return {
      online_usernames:
        asked.length > 0 ? online.filter((name) => asked.includes(name)) : online,
      total_online: online.length,
    };
  }
}
