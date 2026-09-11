import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
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
} from '../../common/http/api-envelope.decorator.js';
import {
  MAX_SUMMARY_TARGETS,
  ReactDto,
  ReactionSummariesQuery,
  ReactionSummaryDto,
  ReactionTargetQuery,
  UnreactQuery,
} from './dto/reaction.dto.js';
import { ReactionsService } from './reactions.service.js';

/// เป้าหมายอยู่ใน body/query ไม่ใช่ใน path เพราะรีแอ็กชันใช้ได้กับสามชนิด
/// (ข้อความ โพสต์ คลิป) การทำ /posts/:id/reactions + /reels/:id/reactions +
/// /messages/:id/reactions จะได้ตรรกะเดียวกันสามชุดที่ต้องแก้พร้อมกันตลอด
@ApiTags('reactions')
@Controller('reactions')
export class ReactionsController {
  constructor(private readonly reactions: ReactionsService) {}

  @Get()
  @ApiOperation({ summary: 'ยอดรีแอ็กชันของสิ่งหนึ่ง พร้อมบอกว่าฉันกดอะไรไว้' })
  @ApiEnvelope(ReactionSummaryDto)
  summary(
    @CurrentUser() user: GatewayUser,
    @Query() query: ReactionTargetQuery,
  ) {
    return this.reactions.summaryFor(user, query);
  }

  @Get('summaries')
  @ApiOperation({
    summary: 'ยอดรีแอ็กชันของหลายชิ้นในคำขอเดียว',
    description:
      'แก้ N+1 ของหน้าจอแชท — เดิมต้องยิงหนึ่งคำขอต่อหนึ่งข้อความ · หลังบ้านทำงานสองคิวรีไม่ว่าจะขอกี่ id',
  })
  @ApiEnvelope(ReactionSummaryDto)
  @ApiEnvelopeError(400, `ขอได้สูงสุด ${MAX_SUMMARY_TARGETS} id ต่อครั้ง`)
  summaries(
    @CurrentUser() user: GatewayUser,
    @Query() query: ReactionSummariesQuery,
  ) {
    const ids = [
      ...new Set(
        query.target_ids
          .split(',')
          .map((id) => id.trim())
          .filter(Boolean),
      ),
    ];

    if (ids.length > MAX_SUMMARY_TARGETS) {
      throw new BadRequestException(
        `ขอยอดรีแอ็กชันได้สูงสุด ${MAX_SUMMARY_TARGETS} รายการต่อครั้ง`,
      );
    }

    return this.reactions.summariesFor(user, query.target_kind, ids);
  }

  @Post()
  @ApiOperation({ summary: 'กดอิโมจิ (กดซ้ำตัวเดิมไม่เพิ่มยอด)' })
  @ApiEnvelope(ReactionSummaryDto, { status: 201, description: 'กดแล้ว' })
  @ApiEnvelopeError(400, 'อิโมจิไม่อยู่ในรายการที่อนุญาต')
  @ApiEnvelopeError(404, 'ไม่พบสิ่งที่จะกด หรือไม่ได้เป็นสมาชิกห้องนั้น')
  react(@CurrentUser() user: GatewayUser, @Body() dto: ReactDto) {
    return this.reactions.react(user, dto);
  }

  @Delete()
  @ApiOperation({ summary: 'ถอนอิโมจิที่กดไว้' })
  @ApiEnvelope(ReactionSummaryDto)
  unreact(@CurrentUser() user: GatewayUser, @Query() query: UnreactQuery) {
    return this.reactions.unreact(user, query);
  }
}
