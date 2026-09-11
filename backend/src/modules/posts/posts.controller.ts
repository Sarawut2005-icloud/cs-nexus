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
import { PaginationQuery } from '../../common/http/pagination.dto.js';
import {
  CreateCommentDto,
  CreatePostDto,
  ListPostsQuery,
  PostCommentResponseDto,
  PostResponseDto,
} from './dto/post.dto.js';
import { PostsService } from './posts.service.js';

/// กระดานข่าวและถามตอบประจำสาขา (Blueprint ของ AIE 4 หน้า 2)
@ApiTags('posts')
@Controller('posts')
export class PostsController {
  constructor(private readonly posts: PostsService) {}

  @Get()
  @ApiOperation({ summary: 'กระดานข่าวทั้งหมด กรองตามแท็กวิชาได้' })
  @ApiEnvelopeList(PostResponseDto)
  list(@CurrentUser() user: GatewayUser, @Query() query: ListPostsQuery) {
    return this.posts.list(user, query);
  }

  @Post()
  @ApiOperation({ summary: 'ตั้งกระทู้ใหม่' })
  @ApiEnvelope(PostResponseDto, { status: 201 })
  create(@CurrentUser() user: GatewayUser, @Body() dto: CreatePostDto) {
    return this.posts.create(user, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'รายละเอียดกระทู้' })
  @ApiEnvelope(PostResponseDto)
  @ApiEnvelopeError(404, 'ไม่พบกระทู้')
  findOne(
    @CurrentUser() user: GatewayUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.posts.findOne(user, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'ลบกระทู้ (เจ้าของ บุคลากร หรือผู้ดูแล)' })
  @ApiEnvelopeError(403, 'ลบกระทู้ของคนอื่นไม่ได้')
  async remove(
    @CurrentUser() user: GatewayUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.posts.remove(user, id);
  }

  @Get(':id/comments')
  @ApiOperation({ summary: 'ความคิดเห็นในกระทู้ เรียงเก่าไปใหม่' })
  @ApiEnvelopeList(PostCommentResponseDto)
  listComments(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PaginationQuery,
  ) {
    return this.posts.listComments(id, query);
  }

  @Post(':id/comments')
  @ApiOperation({ summary: 'ตอบกระทู้' })
  @ApiEnvelope(PostCommentResponseDto, { status: 201 })
  addComment(
    @CurrentUser() user: GatewayUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateCommentDto,
  ) {
    return this.posts.addComment(user, id, dto);
  }

  @Delete(':id/comments/:commentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'ลบความคิดเห็น' })
  @ApiEnvelopeError(403, 'ลบความคิดเห็นของคนอื่นไม่ได้')
  async removeComment(
    @CurrentUser() user: GatewayUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('commentId', ParseUUIDPipe) commentId: string,
  ) {
    await this.posts.removeComment(user, id, commentId);
  }
}
