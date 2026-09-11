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
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CurrentUser,
  type GatewayUser,
} from '../../common/auth/gateway-user.js';
import { Layer1Roles } from '../../common/auth/layer1-roles.decorator.js';
import {
  ApiEnvelope,
  ApiEnvelopeError,
} from '../../common/http/api-envelope.decorator.js';
import {
  CreateStoryDto,
  StoryItemDto,
  StoryTrayDto,
  StoryViewerDto,
} from './dto/story.dto.js';
import { StoriesService } from './stories.service.js';

@ApiTags('stories')
@Controller('stories')
export class StoriesController {
  constructor(private readonly stories: StoriesService) {}

  @Get()
  @ApiOperation({
    summary: 'แถวสตอรี่บนสุดของฟีด จัดกลุ่มตามเจ้าของ',
    description:
      'เห็นของตัวเองและของคนที่ติดตาม · สตอรี่ที่หมดอายุถูกกรองออกตอนอ่าน จึงหายตรงเวลาแม้ตัวเก็บกวาดไม่ได้รัน · ของตัวเองอยู่ซ้ายสุด แล้วเรียงคนที่ยังมีของไม่ได้ดูขึ้นก่อน',
  })
  @ApiEnvelope(StoryTrayDto)
  tray(@CurrentUser() user: GatewayUser) {
    return this.stories.tray(user);
  }

  @Post()
  @ApiOperation({
    summary: 'โพสต์สตอรี่จากไฟล์ที่อัปโหลดเสร็จแล้ว (อายุ 24 ชั่วโมง)',
  })
  @ApiEnvelope(StoryItemDto, { status: 201, description: 'โพสต์แล้ว' })
  @ApiEnvelopeError(400, 'ไฟล์ไม่ใช่รูปหรือวิดีโอ ยังไม่ commit หรือถูกใช้ไปแล้ว')
  @ApiEnvelopeError(403, 'โพสต์จากไฟล์ของคนอื่นไม่ได้')
  create(@CurrentUser() user: GatewayUser, @Body() dto: CreateStoryDto) {
    return this.stories.create(user, dto);
  }

  @Post(':id/views')
  @ApiOperation({
    summary: 'บันทึกว่าดูสตอรี่แล้ว',
    description:
      'กดซ้ำไม่เพิ่มยอด · ยอดผู้ชมที่คืนมาเป็น 0 ถ้าผู้เรียกไม่ใช่เจ้าของ เพราะคนอื่นไม่ควรรู้ว่าสตอรี่นี้มีคนดูกี่คน',
  })
  @ApiEnvelopeError(404, 'ไม่พบสตอรี่ หมดอายุ หรือไม่ได้ติดตามเจ้าของ')
  markViewed(
    @CurrentUser() user: GatewayUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.stories.markViewed(user, id);
  }

  @Get(':id/viewers')
  @ApiOperation({
    summary: 'รายชื่อผู้ชม — เจ้าของสตอรี่เท่านั้น',
  })
  @ApiEnvelope(StoryViewerDto)
  @ApiEnvelopeError(403, 'ดูรายชื่อผู้ชมของคนอื่นไม่ได้')
  viewers(
    @CurrentUser() user: GatewayUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.stories.viewers(user, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'ลบสตอรี่ (เจ้าของ หรือผู้ดูแลองค์กร)' })
  @ApiEnvelopeError(403, 'ลบสตอรี่ของคนอื่นไม่ได้')
  async remove(
    @CurrentUser() user: GatewayUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.stories.remove(user, id);
  }

  @Post('maintenance/sweeps')
  @Layer1Roles('admin')
  @ApiOperation({
    summary: 'สั่งเก็บกวาดสตอรี่ที่หมดอายุทันที (ผู้ดูแลองค์กร)',
    description:
      'ปกติทำงานเองทุก 30 นาที · ไม่ใช่สิ่งที่ทำให้ฟีเจอร์ถูกต้อง (การหมดอายุบังคับตอนอ่านไปแล้ว) แต่เป็นการคืนพื้นที่เก็บไฟล์ให้เจ้าของ',
  })
  @ApiEnvelopeError(403, 'เฉพาะผู้ดูแลระดับองค์กร')
  async sweep() {
    return { removed: await this.stories.sweepExpired() };
  }
}
