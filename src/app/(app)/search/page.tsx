'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Film, Hash, Loader2, MessageSquare, Search, User } from 'lucide-react';
import { api, ApiError, qs } from '@/lib/csmju/api';
import type { SearchAll, SearchHit } from '@/lib/csmju/types';

const KINDS = [
  { value: 'all', label: 'ทุกหมวด' },
  { value: 'posts', label: 'กระทู้' },
  { value: 'reels', label: 'คลิป' },
  { value: 'people', label: 'คน' },
  { value: 'messages', label: 'ข้อความแชท' },
] as const;

const ICON: Record<string, typeof Hash> = {
  POST: Hash,
  REEL: Film,
  PERSON: User,
  MESSAGE: MessageSquare,
};

/// ค้นหา — คลิป กระทู้ คน และข้อความแชท
///
/// **ข้อความแชทค้นได้เฉพาะห้องที่ผู้เรียกเป็นสมาชิก** หลังบ้านบังคับไว้
/// ถ้าไม่บังคับ ช่องนี้จะกลายเป็นช่องอ่านแชทส่วนตัวของคนอื่นด้วยการเดาคำ
///
/// โหมด `all` ไม่แบ่งหน้าโดยตั้งใจ — การเรียงผลจากสี่ตารางที่คนละหน่วยวัด
/// ต้องมีคะแนนความเกี่ยวข้องซึ่งเราไม่มี จึงคืนตัวอย่าง 5 รายการต่อหมวด
/// พร้อมยอดรวม แล้วให้กดแท็บหมวดเพื่อดูทั้งหมด
export default function SearchPage() {
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<(typeof KINDS)[number]['value']>('all');
  const [all, setAll] = useState<SearchAll | null>(null);
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(nextKind = kind) {
    const q = query.trim();

    if (q.length < 2) {
      setError('คำค้นต้องยาวอย่างน้อย 2 ตัวอักษร');

      return;
    }

    setBusy(true);
    setError(null);
    setKind(nextKind);

    try {
      if (nextKind === 'all') {
        setHits(null);
        setAll(await api.get<SearchAll>(`/search${qs({ q, kind: 'all' })}`));
      } else {
        setAll(null);

        const page = await api.list<SearchHit>(
          `/search${qs({ q, kind: nextKind, per_page: 30 })}`,
        );

        setHits(page.items);
        setTotal(page.meta.total_items);
      }
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'ค้นหาไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <header className="mb-4">
        <h1 className="text-xl font-semibold">ค้นหา</h1>
        <p className="text-sm text-muted-foreground">
          ข้อความแชทค้นได้เฉพาะห้องที่คุณเป็นสมาชิก
        </p>
      </header>

      <div className="flex gap-2">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void run();
          }}
          placeholder="พิมพ์คำค้น เช่น pointer"
          className="min-w-0 flex-1 rounded-lg border border-input bg-card px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />

        <button
          type="button"
          onClick={() => void run()}
          disabled={busy}
          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-40"
        >
          {busy ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Search className="size-4" />
          )}
          ค้นหา
        </button>
      </div>

      <div className="mt-3 flex flex-wrap gap-1">
        {KINDS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => void run(option.value)}
            className={`rounded-full border px-3 py-1 text-sm transition-colors ${
              kind === option.value
                ? 'border-primary bg-secondary text-secondary-foreground'
                : 'border-border hover:bg-accent'
            }`}
          >
            {option.label}
            {all && option.value !== 'all' && (
              <span className="ml-1 tabular-nums text-muted-foreground">
                {all.counts[option.value as keyof typeof all.counts]}
              </span>
            )}
          </button>
        ))}
      </div>

      {error && (
        <p className="mt-3 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {all && (
        <>
          <p className="mt-4 text-sm text-muted-foreground">
            พบ {all.counts.posts} กระทู้ · {all.counts.reels} คลิป ·{' '}
            {all.counts.people} คน · {all.counts.messages} ข้อความ
            {all.hits.length > 0 && ' (แสดงตัวอย่างไม่เกิน 5 รายการต่อหมวด)'}
          </p>

          <HitList hits={all.hits} />
        </>
      )}

      {hits && (
        <>
          <p className="mt-4 text-sm text-muted-foreground">
            พบ {total} รายการ {hits.length < total && `(แสดง ${hits.length})`}
          </p>

          <HitList hits={hits} />
        </>
      )}
    </div>
  );
}

function HitList({ hits }: { hits: SearchHit[] }) {
  if (hits.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        ไม่พบผลลัพธ์
      </p>
    );
  }

  return (
    <ul className="mt-2 space-y-2">
      {hits.map((hit) => {
        const Icon = ICON[hit.kind] ?? Hash;
        const href =
          hit.kind === 'PERSON'
            ? `/profile/${encodeURIComponent(hit.id)}`
            : hit.kind === 'MESSAGE'
              ? '/chat'
              : hit.kind === 'REEL'
                ? '/reels'
                : '/feed';

        return (
          <li key={`${hit.kind}-${hit.id}`}>
            <Link
              href={href}
              className="flex items-start gap-2.5 rounded-xl border border-border bg-card p-3 transition-colors hover:bg-accent"
            >
              <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />

              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{hit.title}</span>

                {hit.snippet && (
                  <span className="mt-0.5 block line-clamp-2 text-sm text-muted-foreground">
                    {hit.snippet}
                  </span>
                )}

                <span className="mt-1 block text-[11px] text-muted-foreground">
                  {hit.kind}
                  {hit.author_username ? ` · ${hit.author_username}` : ''}
                  {hit.created_at
                    ? ` · ${new Date(hit.created_at).toLocaleDateString('th-TH')}`
                    : ''}
                </span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
