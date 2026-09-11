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
import { ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, Min } from 'class-validator';
import { CurrentUser, type GatewayUser } from '../../common/auth/gateway-user.js';
import {
  ApiEnvelope,
  ApiEnvelopeError,
  ApiEnvelopeList,
} from '../../common/http/api-envelope.decorator.js';
import { PaginationQuery } from '../../common/http/pagination.dto.js';
import { ChannelsService } from './channels.service.js';
import {
  AddMembersDto,
  ChannelResponseDto,
  CreateChannelDto,
  CreateDirectChannelDto,
} from './dto/channel.dto.js';

export class MarkReadDto {
  @ApiProperty({ example: 1421 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  seq!: number;
}

export class MarkReadResponseDto {
  @ApiProperty({ example: 1421 }) last_read_seq!: number;
}

export class AddMembersResponseDto {
  @ApiProperty({ example: 3 }) added!: number;
}

@ApiTags('channels')
@Controller('channels')
export class ChannelsController {
  constructor(private readonly channels: ChannelsService) {}

  @Get()
  @ApiOperation({ summary: 'ห้องทั้งหมดที่ฉันเป็นสมาชิก พร้อมจำนวนที่ยังไม่อ่าน' })
  @ApiEnvelopeList(ChannelResponseDto)
  list(@CurrentUser() user: GatewayUser, @Query() query: PaginationQuery) {
    return this.channels.listMine(user, query);
  }

  @Post()
  @ApiOperation({ summary: 'สร้างห้องกลุ่ม ห้องประจำวิชา หรือห้องเสียง' })
  @ApiEnvelope(ChannelResponseDto, { status: 201 })
  @ApiEnvelopeError(403, 'นักศึกษาสร้างห้องประจำวิชาไม่ได้')
  create(@CurrentUser() user: GatewayUser, @Body() dto: CreateChannelDto) {
    return this.channels.create(user, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'รายละเอียดห้อง (ต้องเป็นสมาชิก)' })
  @ApiEnvelope(ChannelResponseDto)
  @ApiEnvelopeError(404, 'ไม่พบห้อง หรือไม่ได้เป็นสมาชิก')
  findOne(
    @CurrentUser() user: GatewayUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.channels.findOne(user, id);
  }

  @Post(':id/members')
  @ApiOperation({ summary: 'เพิ่มสมาชิกเข้าห้อง (เฉพาะผู้ดูแลห้อง)' })
  @ApiEnvelope(AddMembersResponseDto, { status: 201 })
  addMembers(
    @CurrentUser() user: GatewayUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddMembersDto,
  ) {
    return this.channels.addMembers(user, id, dto);
  }

  @Delete(':id/members/me')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'ออกจากห้อง' })
  async leave(
    @CurrentUser() user: GatewayUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.channels.leave(user, id);
  }

  @Post(':id/read-markers')
  @ApiOperation({ summary: 'บันทึกว่าอ่านถึงข้อความลำดับใดแล้ว' })
  @ApiEnvelope(MarkReadResponseDto, { status: 201 })
  markRead(
    @CurrentUser() user: GatewayUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MarkReadDto,
  ) {
    return this.channels.markRead(user, id, dto.seq);
  }
}

@ApiTags('direct-channels')
@Controller('direct-channels')
export class DirectChannelsController {
  constructor(private readonly channels: ChannelsService) {}

  @Post()
  @ApiOperation({
    summary: 'เปิดแชทส่วนตัวกับคนหนึ่งคน — ถ้ามีห้องเดิมอยู่แล้วจะคืนห้องเดิม',
  })
  @ApiEnvelope(ChannelResponseDto, { status: 201 })
  @ApiEnvelopeError(400, 'สร้างห้องกับตัวเองไม่ได้')
  create(
    @CurrentUser() user: GatewayUser,
    @Body() dto: CreateDirectChannelDto,
  ) {
    return this.channels.createOrFindDirect(user, dto);
  }
}
