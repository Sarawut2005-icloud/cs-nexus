import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';
import { PaginationQuery } from '../../../common/http/pagination.dto.js';
import { ReactionSummaryDto } from '../../reactions/dto/reaction.dto.js';
import type {
  PostCommentModel,
  PostModel,
} from '../../../generated/prisma/models.js';

export class CreatePostDto {
  @ApiProperty({ example: 'ถามเรื่อง pointer ใน C ครับ' })
  @IsString()
  @Length(1, 200, { message: 'หัวข้อต้องยาว 1-200 ตัวอักษร' })
  title!: string;

  @ApiProperty({ example: 'ทำไม *ptr กับ &var ให้ผลไม่เหมือนกันครับ' })
  @IsString()
  @Length(1, 8000, { message: 'เนื้อหายาวได้ไม่เกิน 8000 ตัวอักษร' })
  content!: string;

  @ApiPropertyOptional({
    example: 'CS201',
    description: 'แท็กวิชา ใช้กรองกระดานข่าวตามรายวิชา',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{2,4}[0-9]{3}$/, {
    message: 'แท็กวิชาต้องอยู่ในรูปแบบเช่น CS201',
  })
  course_tag?: string;
}

export class CreateCommentDto {
  @ApiProperty({ example: 'ลองวาดภาพหน่วยความจำดูครับ จะเห็นชัดขึ้น' })
  @IsString()
  @Length(1, 4000)
  content!: string;
}

export class ListPostsQuery extends PaginationQuery {
  @ApiPropertyOptional({ example: 'CS201' })
  @IsOptional()
  @IsString()
  @Length(1, 20)
  course_tag?: string;

  @ApiPropertyOptional({
    enum: ['all', 'following'],
    default: 'all',
    description: 'following = เฉพาะกระทู้ของคนที่ฉันติดตาม (รวมของตัวเอง)',
  })
  @IsOptional()
  @IsIn(['all', 'following'])
  feed?: 'all' | 'following';

  @ApiPropertyOptional({
    example: '6704101382-anuchat',
    description: 'เฉพาะกระทู้ของคนนี้ — ใช้ทำหน้าโปรไฟล์',
  })
  @IsOptional()
  @IsString()
  @Length(2, 64)
  author_username?: string;
}

export class PostResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() title!: string;
  @ApiProperty() content!: string;
  @ApiProperty({ nullable: true }) course_tag!: string | null;
  @ApiProperty({ example: '6704101382-anuchat' }) author_username!: string;
  @ApiProperty() comment_count!: number;

  @ApiProperty({
    type: ReactionSummaryDto,
    nullable: true,
    description: 'ยอดอิโมจิรีแอ็กชัน พร้อมบอกว่าผู้เรียกกดอะไรไว้',
  })
  reactions!: ReactionSummaryDto | null;

  @ApiProperty({ example: '2026-08-11T09:30:00+07:00' }) created_at!: string;
}

export class PostCommentResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() post_id!: string;
  @ApiProperty() author_username!: string;
  @ApiProperty() content!: string;
  @ApiProperty() created_at!: string;
}

export function toPostResponse(
  post: PostModel,
  reactions: ReactionSummaryDto | null = null,
): PostResponseDto {
  return {
    id: post.id,
    title: post.title,
    content: post.content,
    course_tag: post.courseTag,
    author_username: post.authorUsername,
    comment_count: post.commentCount,
    reactions,
    created_at: post.createdAt.toISOString(),
  };
}

export function toCommentResponse(
  comment: PostCommentModel,
): PostCommentResponseDto {
  return {
    id: comment.id,
    post_id: comment.postId,
    author_username: comment.authorUsername,
    content: comment.content,
    created_at: comment.createdAt.toISOString(),
  };
}
