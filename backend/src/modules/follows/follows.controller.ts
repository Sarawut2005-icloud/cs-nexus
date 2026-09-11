import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
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
  FollowDto,
  FollowEdgeDto,
  RelationDto,
} from './dto/follow.dto.js';
import { FollowsService } from './follows.service.js';

@ApiTags('follows')
@Controller('follows')
export class FollowsController {
  constructor(private readonly follows: FollowsService) {}

  @Get('followers')
  @ApiOperation({ summary: 'คนที่ติดตามฉัน' })
  @ApiEnvelopeList(FollowEdgeDto)
  myFollowers(
    @CurrentUser() user: GatewayUser,
    @Query() query: PaginationQuery,
  ) {
    return this.follows.followers(user.username, query);
  }

  @Get('following')
  @ApiOperation({ summary: 'คนที่ฉันติดตาม' })
  @ApiEnvelopeList(FollowEdgeDto)
  myFollowing(
    @CurrentUser() user: GatewayUser,
    @Query() query: PaginationQuery,
  ) {
    return this.follows.following(user.username, query);
  }

  @Get('suggestions')
  @ApiOperation({
    summary: 'คนที่น่าติดตาม จากคนที่คนที่เราติดตามอยู่ติดตามอยู่',
    description:
      'คืนอาเรย์ว่างถ้าผู้ใช้ยังไม่ได้ติดตามใครเลย — ตั้งใจไม่ตกไปหาอันดับยอดนิยม เพราะจะทำให้ผู้ใช้ใหม่ทุกคนเห็นรายชื่อเดียวกันหมด',
  })
  suggestions(@CurrentUser() user: GatewayUser) {
    return this.follows.suggestions(user, 10);
  }

  @Post()
  @ApiOperation({ summary: 'กดติดตามคนหนึ่ง (กดซ้ำไม่แจ้งเตือนซ้ำ)' })
  @ApiEnvelope(RelationDto, { status: 201, description: 'ติดตามแล้ว' })
  @ApiEnvelopeError(400, 'ติดตามตัวเองไม่ได้')
  follow(@CurrentUser() user: GatewayUser, @Body() dto: FollowDto) {
    return this.follows.follow(user, dto.username);
  }

  @Delete(':username')
  @ApiOperation({ summary: 'เลิกติดตาม' })
  @ApiEnvelope(RelationDto)
  unfollow(
    @CurrentUser() user: GatewayUser,
    @Param('username') username: string,
  ) {
    return this.follows.unfollow(user, username);
  }
}
