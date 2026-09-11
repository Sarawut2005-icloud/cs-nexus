import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

/// เพดานที่มาจากคณิตศาสตร์ของ mesh P2P ไม่ใช่ตัวเลขที่ตั้งลอย ๆ
///
///   เสียง Opus ~32 kbps ต่อสาย · ห้อง 8 คน แต่ละคนส่ง 7 สาย = ~224 kbps ขึ้น
///   ยังไหวบนเน็ตทั่วไป
///
///   แชร์หน้าจอ 720p ~700 kbps ต่อผู้ชม · ถ้ามี 7 ผู้ชม = ~4.9 Mbps ขึ้น
///   จากเครื่องคนแชร์คนเดียว ซึ่งเน็ตมือถือหรือ wifi มหาลัยรับไม่ไหว
///   จึงจำกัดผู้ชมไว้ที่ 4 (~2.8 Mbps)
///
/// ถ้าวันหนึ่งมีงบซื้อ SFU เพดานพวกนี้จะหายไปเอง
export const MAX_SCREEN_VIEWERS = 4;

export class JoinVoiceDto {
  @ApiProperty({ description: 'ห้องที่จะเข้า ต้องเป็นสมาชิกอยู่แล้ว' })
  @IsUUID('4')
  channel_id!: string;
}

export class ListVoiceSessionsQuery {
  @ApiPropertyOptional({ description: 'กรองเฉพาะห้องนี้' })
  @IsOptional()
  @IsUUID('4')
  channel_id?: string;
}

export class IceServerDto {
  @ApiProperty({ example: ['stun:stun.l.google.com:19302'] })
  urls!: string[];

  @ApiPropertyOptional() username?: string;
  @ApiPropertyOptional() credential?: string;
}

export class VoiceParticipantDto {
  @ApiProperty() username!: string;
  @ApiProperty() joined_at!: string;
}

export class VoiceSessionDto {
  @ApiProperty() id!: string;
  @ApiProperty() channel_id!: string;
  @ApiProperty() started_at!: string;
  @ApiProperty({ type: [VoiceParticipantDto] })
  participants!: VoiceParticipantDto[];

  @ApiProperty({ example: 8 }) max_seats!: number;
  @ApiProperty({ example: 3 }) seats_taken!: number;
}

export class JoinVoiceResponseDto extends VoiceSessionDto {
  @ApiProperty({
    type: [IceServerDto],
    description:
      'ส่งจากเซิร์ฟเวอร์เพื่อไม่ให้หน้าบ้าน hardcode และเพื่อหมุน credential ของ TURN ได้',
  })
  ice_servers!: IceServerDto[];

  @ApiProperty({
    description:
      'false เมื่อไม่มี TURN — ผู้ใช้บางส่วนหลัง NAT ของมหาลัยหรือเน็ตมือถือจะเชื่อมไม่ติด',
  })
  turn_available!: boolean;

  @ApiProperty({ example: MAX_SCREEN_VIEWERS })
  max_screen_viewers!: number;
}
