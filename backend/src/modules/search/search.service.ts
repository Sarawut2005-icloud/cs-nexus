import { Injectable } from '@nestjs/common';
import type { CoreHubUser } from '../../common/auth/core-user.js';
import { Paginated } from '../../common/http/envelope.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import {
  PREVIEW_PER_KIND,
  SearchAllResponseDto,
  SearchHitDto,
  SearchQuery,
} from './dto/search.dto.js';

const SNIPPET_LENGTH = 160;

@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

  /// ค้นทุกหมวดพร้อมกัน — คืนตัวอย่างไม่กี่รายการต่อหมวด พร้อมยอดรวมของแต่ละหมวด
  ///
  /// ไม่แบ่งหน้าในโหมดนี้โดยตั้งใจ: การเรียงผลจากสี่ตารางที่คนละหน่วยวัด
  /// ให้เป็นลำดับเดียวต้องมีคะแนนความเกี่ยวข้อง ซึ่งเราไม่มี การแกล้งแบ่งหน้า
  /// จะได้หน้าที่สองที่ไม่มีความหมาย — ให้ผู้ใช้กดแท็บหมวดแล้วแบ่งหน้าในหมวดนั้น
  async searchAll(
    user: CoreHubUser,
    query: SearchQuery,
  ): Promise<SearchAllResponseDto> {
    const q = query.q.trim();

    const [reels, posts, people, messages, counts] = await Promise.all([
      this.reelHits(q, PREVIEW_PER_KIND, 0),
      this.postHits(q, PREVIEW_PER_KIND, 0),
      this.peopleHits(q, PREVIEW_PER_KIND, 0),
      this.messageHits(user, q, PREVIEW_PER_KIND, 0),
      this.counts(user, q),
    ]);

    return {
      query: q,
      counts,
      hits: [...reels, ...posts, ...people, ...messages],
    };
  }

  async searchOne(
    user: CoreHubUser,
    query: SearchQuery,
  ): Promise<Paginated<SearchHitDto>> {
    const q = query.q.trim();
    const kind = query.kind ?? 'all';

    const [hits, total] = await Promise.all([
      kind === 'reels'
        ? this.reelHits(q, query.take, query.skip)
        : kind === 'posts'
          ? this.postHits(q, query.take, query.skip)
          : kind === 'people'
            ? this.peopleHits(q, query.take, query.skip)
            : this.messageHits(user, q, query.take, query.skip),
      this.countOne(user, q, kind),
    ]);

    return new Paginated(hits, query.meta(total));
  }

  private async counts(user: CoreHubUser, q: string) {
    const [reels, posts, people, messages] = await Promise.all([
      this.countOne(user, q, 'reels'),
      this.countOne(user, q, 'posts'),
      this.countOne(user, q, 'people'),
      this.countOne(user, q, 'messages'),
    ]);

    return { reels, posts, people, messages };
  }

  private async countOne(
    user: CoreHubUser,
    q: string,
    kind: string,
  ): Promise<number> {
    if (kind === 'reels') {
      return this.prisma.reel.count({ where: this.reelWhere(q) });
    }

    if (kind === 'posts') {
      return this.prisma.post.count({ where: this.postWhere(q) });
    }

    if (kind === 'people') {
      return this.prisma.profileCache.count({ where: this.peopleWhere(q) });
    }

    return this.prisma.message.count({
      where: await this.messageWhere(user, q),
    });
  }

  private async reelHits(
    q: string,
    take: number,
    skip: number,
  ): Promise<SearchHitDto[]> {
    const rows = await this.prisma.reel.findMany({
      where: this.reelWhere(q),
      orderBy: { createdAt: 'desc' },
      take,
      skip,
    });

    return rows.map((row) => ({
      kind: 'REEL',
      id: row.id,
      title: row.title,
      snippet: snippet(row.caption, q),
      author_core_user_id: row.authorCoreUserId,
      channel_id: null,
      created_at: row.createdAt.toISOString(),
    }));
  }

  private async postHits(
    q: string,
    take: number,
    skip: number,
  ): Promise<SearchHitDto[]> {
    const rows = await this.prisma.post.findMany({
      where: this.postWhere(q),
      orderBy: { createdAt: 'desc' },
      take,
      skip,
    });

    return rows.map((row) => ({
      kind: 'POST',
      id: row.id,
      title: row.title,
      snippet: snippet(row.content, q),
      author_core_user_id: row.authorCoreUserId,
      channel_id: null,
      created_at: row.createdAt.toISOString(),
    }));
  }

  /// ค้นคน — ค้นได้เฉพาะจากแคชชื่อที่ซิงก์มาจาก Core
  ///
  /// ข้อจำกัดที่ต้องรู้: คนที่ยังไม่เคยถูกซิงก์จะหาด้วยชื่อจริงไม่เจอ
  /// (หาด้วย coreUserId เจอ เพราะ coreUserId คือคีย์ของตารางแคช)
  /// ทางแก้จริงคือให้ Core มี endpoint ค้นคน แล้วเราเรียกต่อ — TODO(PL) กับ PM
  private async peopleHits(
    q: string,
    take: number,
    skip: number,
  ): Promise<SearchHitDto[]> {
    const rows = await this.prisma.profileCache.findMany({
      where: this.peopleWhere(q),
      orderBy: { coreUserId: 'asc' },
      take,
      skip,
    });

    return rows.map((row) => ({
      kind: 'PERSON',
      id: row.coreUserId,
      title: row.displayName,
      snippet: row.coreUserId,
      author_core_user_id: row.coreUserId,
      channel_id: null,
      created_at: null,
    }));
  }

  private async messageHits(
    user: CoreHubUser,
    q: string,
    take: number,
    skip: number,
  ): Promise<SearchHitDto[]> {
    const rows = await this.prisma.message.findMany({
      where: await this.messageWhere(user, q),
      orderBy: { createdAt: 'desc' },
      take,
      skip,
      include: { channel: { select: { name: true, kind: true } } },
    });

    return rows.map((row) => ({
      kind: 'MESSAGE',
      id: row.id,
      title: row.channel.name ?? (row.channel.kind === 'DM' ? 'แชทส่วนตัว' : 'ห้องแชท'),
      snippet: snippet(row.content, q),
      author_core_user_id: row.authorCoreUserId,
      channel_id: row.channelId,
      created_at: row.createdAt.toISOString(),
    }));
  }

  private reelWhere(q: string) {
    return {
      OR: [
        { title: { contains: q, mode: 'insensitive' as const } },
        { caption: { contains: q, mode: 'insensitive' as const } },
      ],
    };
  }

  private postWhere(q: string) {
    return {
      OR: [
        { title: { contains: q, mode: 'insensitive' as const } },
        { content: { contains: q, mode: 'insensitive' as const } },
        { courseTag: { contains: q, mode: 'insensitive' as const } },
      ],
    };
  }

  private peopleWhere(q: string) {
    return {
      OR: [
        { displayName: { contains: q, mode: 'insensitive' as const } },
        { coreUserId: { contains: q, mode: 'insensitive' as const } },
      ],
    };
  }

  /// ค้นข้อความได้เฉพาะในห้องที่ตัวเองเป็นสมาชิก
  ///
  /// นี่เป็นเงื่อนไขที่ห้ามลืม: ถ้าค้นทั้งตาราง ช่องค้นหาจะกลายเป็นช่องอ่าน
  /// แชทส่วนตัวของคนอื่นทั้งระบบด้วยการเดาคำ ซึ่งร้ายแรงกว่าบั๊กใด ๆ ในระบบนี้
  private async messageWhere(user: CoreHubUser, q: string) {
    const memberships = await this.prisma.channelMember.findMany({
      where: { coreUserId: user.coreUserId },
      select: { channelId: true },
    });

    return {
      deletedAt: null,
      content: { contains: q, mode: 'insensitive' as const },
      channelId: { in: memberships.map((m) => m.channelId) },
    };
  }
}

/// ตัดข้อความรอบ ๆ คำค้นให้พออ่านรู้บริบท ไม่ใช่ส่งเนื้อหา 8000 ตัวอักษรกลับไป
function snippet(text: string | null, q: string): string | null {
  if (!text) {
    return null;
  }

  const at = text.toLowerCase().indexOf(q.toLowerCase());

  if (at < 0) {
    return text.slice(0, SNIPPET_LENGTH);
  }

  const start = Math.max(0, at - 40);
  const cut = text.slice(start, start + SNIPPET_LENGTH);

  return (start > 0 ? '…' : '') + cut + (start + SNIPPET_LENGTH < text.length ? '…' : '');
}
