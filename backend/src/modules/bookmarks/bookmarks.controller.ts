import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
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
import { BookmarksService } from './bookmarks.service.js';
import {
  BookmarkResponseDto,
  CreateBookmarkDto,
  ListBookmarksQuery,
} from './dto/bookmark.dto.js';

@ApiTags('bookmarks')
@Controller('bookmarks')
export class BookmarksController {
  constructor(private readonly bookmarks: BookmarksService) {}

  @Get()
  @ApiOperation({ summary: 'รายการที่ฉันบันทึกไว้ (เห็นได้เฉพาะเจ้าของ)' })
  @ApiEnvelopeList(BookmarkResponseDto)
  list(
    @CurrentUser() user: GatewayUser,
    @Query() query: ListBookmarksQuery,
  ) {
    return this.bookmarks.listMine(user, query);
  }

  @Post()
  @ApiOperation({ summary: 'บันทึกโพสต์หรือคลิปไว้ดูทีหลัง' })
  @ApiEnvelope(BookmarkResponseDto, { status: 201, description: 'บันทึกแล้ว' })
  @ApiEnvelopeError(404, 'ไม่พบสิ่งที่จะบันทึก')
  add(@CurrentUser() user: GatewayUser, @Body() dto: CreateBookmarkDto) {
    return this.bookmarks.add(user, dto);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'เอาออกจากรายการที่บันทึกไว้' })
  async remove(
    @CurrentUser() user: GatewayUser,
    @Query() query: CreateBookmarkDto,
  ) {
    await this.bookmarks.remove(user, query);
  }
}
