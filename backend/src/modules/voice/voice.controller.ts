import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, type GatewayUser } from '../../common/auth/gateway-user.js';
import {
  ApiEnvelope,
  ApiEnvelopeError,
  ApiEnvelopeList,
} from '../../common/http/api-envelope.decorator.js';
import {
  JoinVoiceDto,
  JoinVoiceResponseDto,
  ListVoiceSessionsQuery,
  VoiceSessionDto,
} from './dto/voice.dto.js';
import { VoiceService } from './voice.service.js';

/// ห้องคอลเสียงแบบ always-on (Blueprint ของ AIE 4 หน้า 1)
/// เข้า-ออกอิสระ ไม่ต้องมีใครกดเริ่มห้อง
@ApiTags('voice-sessions')
@Controller('voice-sessions')
export class VoiceController {
  constructor(private readonly voice: VoiceService) {}

  @Get()
  @ApiOperation({
    summary: 'ห้องเสียงที่กำลังเปิดอยู่ (เห็นเฉพาะห้องที่ตัวเองเป็นสมาชิก)',
  })
  @ApiEnvelopeList(VoiceSessionDto)
  async list(
    @CurrentUser() user: GatewayUser,
    @Query() query: ListVoiceSessionsQuery,
  ) {
    return this.voice.listActive(user, query.channel_id);
  }

  @Post()
  @ApiOperation({
    summary: 'เข้าห้องเสียง — คืนรายชื่อคนในห้องและ ICE server สำหรับ WebRTC',
  })
  @ApiEnvelope(JoinVoiceResponseDto, { status: 201 })
  @ApiEnvelopeError(409, 'ห้องเต็มตามเพดานของ mesh P2P')
  @ApiEnvelopeError(404, 'ไม่ได้เป็นสมาชิกห้องนี้')
  join(@CurrentUser() user: GatewayUser, @Body() dto: JoinVoiceDto) {
    return this.voice.join(user, dto.channel_id);
  }

  @Delete(':id/participants/me')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'ออกจากห้องเสียง' })
  async leave(
    @CurrentUser() user: GatewayUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.voice.leave(user, id);
  }
}
