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
import {
  CurrentUser,
  type GatewayUser,
} from '../../common/auth/gateway-user.js';
import {
  ApiEnvelope,
  ApiEnvelopeError,
  ApiEnvelopeList,
} from '../../common/http/api-envelope.decorator.js';
import { Layer1Roles } from '../../common/auth/layer1-roles.decorator.js';
import { PaginationQuery } from '../../common/http/pagination.dto.js';
import { AssetsSweeper } from './assets-sweeper.service.js';
import { AssetsService } from './assets.service.js';
import {
  AssetResponseDto,
  CreateUploadIntentDto,
  DownloadUrlResponseDto,
  UploadIntentResponseDto,
} from './dto/asset.dto.js';

@ApiTags('assets')
@Controller('assets')
export class AssetsController {
  constructor(
    private readonly assets: AssetsService,
    private readonly sweeper: AssetsSweeper,
  ) {}

  @Get()
  @ApiOperation({ summary: 'ไฟล์ของฉันที่อัปโหลดสำเร็จแล้ว' })
  @ApiEnvelopeList(AssetResponseDto)
  list(@CurrentUser() user: GatewayUser, @Query() query: PaginationQuery) {
    return this.assets.listMine(user, query);
  }

  @Post('maintenance/sweeps')
  @Layer1Roles('admin')
  @ApiOperation({
    summary: 'สั่งเก็บกวาดรายการอัปโหลดที่ค้างทันที (ผู้ดูแลองค์กร)',
    description:
      'ปกติตัวกวาดทำงานเองทุก 30 นาที — endpoint นี้มีไว้ให้กวาดทันทีตอนตรวจปัญหาพื้นที่เก็บไฟล์เต็ม',
  })
  @ApiEnvelopeError(403, 'เฉพาะผู้ดูแลระดับองค์กร')
  sweep() {
    return this.sweeper.sweep();
  }

  @Post('upload-intents')
  @ApiOperation({
    summary: 'จังหวะ 1 — ขอสิทธิ์อัปโหลด (ตรวจโควตาและนามสกุลก่อนออก URL)',
  })
  @ApiEnvelope(UploadIntentResponseDto, { status: 201 })
  @ApiEnvelopeError(400, 'นามสกุลไฟล์ที่รับไม่ได้')
  @ApiEnvelopeError(413, 'พื้นที่เก็บไฟล์ไม่พอ')
  createUploadIntent(
    @CurrentUser() user: GatewayUser,
    @Body() dto: CreateUploadIntentDto,
  ) {
    return this.assets.createUploadIntent(user, dto);
  }

  @Post(':id/commit')
  @ApiOperation({
    summary:
      'จังหวะ 3 — ยืนยันการอัปโหลด (ตรวจขนาดจริงและลายเซ็นไฟล์ แล้วบวกโควตา)',
  })
  @ApiEnvelope(AssetResponseDto)
  @ApiEnvelopeError(400, 'ยังไม่พบไฟล์ในที่เก็บ หรือเนื้อไฟล์ไม่ตรงกับนามสกุล')
  @ApiEnvelopeError(413, 'ไฟล์จริงใหญ่เกินพื้นที่ที่เหลือ')
  commit(
    @CurrentUser() user: GatewayUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.assets.commit(user, id);
  }

  @Get(':id/download-url')
  @ApiOperation({ summary: 'ขอ URL อ่านไฟล์แบบมีอายุ 2 นาที' })
  @ApiEnvelope(DownloadUrlResponseDto)
  @ApiEnvelopeError(403, 'ไม่มีสิทธิ์เข้าถึงไฟล์นี้')
  downloadUrl(
    @CurrentUser() user: GatewayUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.assets.createDownloadUrl(user, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'ลบไฟล์และคืนพื้นที่ให้เจ้าของ' })
  @ApiEnvelopeError(400, 'ไฟล์ถูกใช้เป็นคลิป Reels อยู่')
  async remove(
    @CurrentUser() user: GatewayUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.assets.remove(user, id);
  }
}
