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
import { PaginationQuery } from '../../common/http/pagination.dto.js';
import {
  CreateReelCommentDto,
  CreateReelDto,
  ListReelsQuery,
  ReelCommentResponseDto,
  ReelResponseDto,
} from './dto/reel.dto.js';
import { LikeCountDto, ReelsService, ViewCountDto } from './reels.service.js';

/// URL เป็นคำนามพหูพจน์แบบ kebab-case ตามมาตรฐาน (Blueprint หน้า 7)
/// prefix /api/v1 ใส่ให้แล้วที่ main.ts
@ApiTags('reels')
@Controller('reels')
export class ReelsController {
  constructor(private readonly reels: ReelsService) {}

  @Get()
  @ApiOperation({
    summary: 'ฟีดคลิปสั้น เรียงใหม่ไปเก่า',
    description:
      'feed=following = เฉพาะคนที่ติดตาม · author_username = หน้าโปรไฟล์ของคนนั้น',
  })
  @ApiEnvelopeList(ReelResponseDto)
  list(@CurrentUser() user: GatewayUser, @Query() query: ListReelsQuery) {
    return this.reels.list(user, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'รายละเอียดคลิปเดียว' })
  @ApiEnvelope(ReelResponseDto)
  @ApiEnvelopeError(404, 'ไม่พบคลิป')
  findOne(
    @CurrentUser() user: GatewayUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.reels.findOne(user, id);
  }

  @Post()
  @ApiOperation({ summary: 'โพสต์คลิปใหม่จากไฟล์ที่อัปโหลดเสร็จแล้ว' })
  @ApiEnvelope(ReelResponseDto, { status: 201, description: 'สร้างคลิปสำเร็จ' })
  @ApiEnvelopeError(400, 'ไฟล์ยังไม่พร้อม หรือไม่ใช่วิดีโอ')
  @ApiEnvelopeError(403, 'ไฟล์นี้ไม่ใช่ของผู้เรียก')
  create(@CurrentUser() user: GatewayUser, @Body() dto: CreateReelDto) {
    return this.reels.create(user, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'ลบคลิป (เจ้าของ หรือ admin ระดับองค์กร)' })
  @ApiEnvelopeError(403, 'ลบคลิปของคนอื่นไม่ได้')
  async remove(
    @CurrentUser() user: GatewayUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.reels.remove(user, id);
  }

  @Post(':id/likes')
  @ApiOperation({ summary: 'กดไลก์คลิป (กดซ้ำไม่เพิ่มยอด)' })
  @ApiEnvelope(LikeCountDto)
  like(
    @CurrentUser() user: GatewayUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.reels.like(user, id);
  }

  @Delete(':id/likes')
  @ApiOperation({ summary: 'เลิกไลก์คลิป' })
  @ApiEnvelope(LikeCountDto)
  unlike(
    @CurrentUser() user: GatewayUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.reels.unlike(user, id);
  }

  @Post(':id/views')
  @ApiOperation({
    summary: 'บันทึกว่าดูคลิปแล้ว',
    description:
      'นับคนที่เคยดู ไม่ใช่จำนวนครั้งที่เล่น — คนเดิมเรียกซ้ำยอดไม่ขยับ จึงปั่นด้วยการรีเฟรชไม่ได้',
  })
  @ApiEnvelope(ViewCountDto, { status: 201, description: 'บันทึกแล้ว' })
  @ApiEnvelopeError(404, 'ไม่พบคลิปนี้')
  markViewed(
    @CurrentUser() user: GatewayUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.reels.markViewed(user, id);
  }

  @Get(':id/comments')
  @ApiOperation({ summary: 'ความคิดเห็นใต้คลิป (ใหม่สุดก่อน)' })
  @ApiEnvelopeList(ReelCommentResponseDto)
  listComments(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PaginationQuery,
  ) {
    return this.reels.listComments(id, query);
  }

  @Post(':id/comments')
  @ApiOperation({ summary: 'คอมเมนต์ใต้คลิป' })
  @ApiEnvelope(ReelCommentResponseDto, { status: 201 })
  @ApiEnvelopeError(404, 'ไม่พบคลิปนี้')
  addComment(
    @CurrentUser() user: GatewayUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateReelCommentDto,
  ) {
    return this.reels.addComment(user, id, dto.content);
  }

  @Delete(':id/comments/:commentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'ลบความคิดเห็น (เจ้าของ หรือผู้ดูแล)' })
  @ApiEnvelopeError(403, 'ลบความคิดเห็นของคนอื่นไม่ได้')
  async removeComment(
    @CurrentUser() user: GatewayUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('commentId', ParseUUIDPipe) commentId: string,
  ) {
    await this.reels.removeComment(user, id, commentId);
  }
}
