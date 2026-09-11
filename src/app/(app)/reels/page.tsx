'use client';

import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bookmark,
  BookmarkCheck,
  Eye,
  Heart,
  Loader2,
  MessageSquare,
  Send,
  Upload,
} from 'lucide-react';
import { Avatar, UserName } from '@/components/csmju/user-name';
import { api, ApiError, qs } from '@/lib/csmju/api';
import { getIdentity } from '@/lib/csmju/identity';
import type {
  Bookmark as BookmarkRow,
  Reel,
  ReelComment,
} from '@/lib/csmju/types';

/// ฟีดคลิปสั้น — ไลก์ คอมเมนต์ บันทึก และนับผู้ชม
///
/// ยอดผู้ชมนับ "คนที่เคยดู" ไม่ใช่ "จำนวนครั้งที่เล่น" หลังบ้านมีคีย์
/// (reel_id, username) จึงกดซ้ำไม่เพิ่มยอด — หน้านี้ยิงบันทึกการดูครั้งเดียว
/// ต่อคลิปต่อรอบการโหลด ไม่ยิงทุกครั้งที่เลื่อนผ่าน

export default function ReelsPage() {
  const [feed, setFeed] = useState<'all' | 'following'>('all');
  const viewed = useRef<Set<string>>(new Set());
  const queryClient = useQueryClient();

  const reelsKey = ['reels', feed] as const;

  type ReelsData = { reels: Reel[]; saved: Set<string> };

  const {
    data,
    isPending: loading,
    error: queryError,
  } = useQuery({
    queryKey: reelsKey,
    queryFn: async (): Promise<ReelsData> => {
      const [page, bookmarks] = await Promise.all([
        api.list<Reel>(
          `/reels${qs({
            per_page: 20,
            feed: feed === 'following' ? 'following' : undefined,
          })}`,
        ),
        api.list<BookmarkRow>('/bookmarks?target_kind=REEL&per_page=100'),
      ]);

      return {
        reels: page.items,
        saved: new Set(bookmarks.items.map((row) => row.target_id)),
      };
    },
  });

  const reels = data?.reels ?? [];
  const saved = data?.saved ?? new Set<string>();

  const error = queryError
    ? queryError instanceof ApiError
      ? queryError.message
      : 'โหลดคลิปไม่สำเร็จ — หลังบ้านรันอยู่ไหม'
    : null;

  function patchReels(update: (current: ReelsData) => ReelsData) {
    queryClient.setQueryData<ReelsData>(reelsKey, (current) =>
      update(current ?? { reels: [], saved: new Set<string>() }),
    );
  }

  function setReels(update: (prev: Reel[]) => Reel[]) {
    patchReels((current) => ({ ...current, reels: update(current.reels) }));
  }

  function setSaved(update: (prev: Set<string>) => Set<string>) {
    patchReels((current) => ({ ...current, saved: update(current.saved) }));
  }

  async function markViewed(reel: Reel) {
    if (viewed.current.has(reel.id)) return;

    viewed.current.add(reel.id);

    try {
      const result = await api.post<{ view_count: number }>(
        `/reels/${reel.id}/views`,
      );

      setReels((prev) =>
        prev.map((row) =>
          row.id === reel.id ? { ...row, view_count: result.view_count } : row,
        ),
      );
    } catch {
      // นับวิวพลาดไม่ควรรบกวนผู้ดู
    }
  }

  async function toggleLike(reel: Reel) {
    const result = reel.liked_by_me
      ? await api.del<{ like_count: number }>(`/reels/${reel.id}/likes`)
      : await api.post<{ like_count: number }>(`/reels/${reel.id}/likes`);

    setReels((prev) =>
      prev.map((row) =>
        row.id === reel.id
          ? {
              ...row,
              like_count: result.like_count,
              liked_by_me: !reel.liked_by_me,
            }
          : row,
      ),
    );
  }

  async function toggleSave(reel: Reel) {
    if (saved.has(reel.id)) {
      await api.del(
        `/bookmarks${qs({ target_kind: 'REEL', target_id: reel.id })}`,
      );
      setSaved((prev) => {
        const next = new Set(prev);
        next.delete(reel.id);
        return next;
      });
    } else {
      await api.post('/bookmarks', {
        target_kind: 'REEL',
        target_id: reel.id,
      });
      setSaved((prev) => new Set(prev).add(reel.id));
    }
  }

  return (
    <div className="mx-auto max-w-xl px-4 py-6">
      <header className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">คลิปสั้น</h1>
          <p className="text-sm text-muted-foreground">
            คลิปไม่เกิน 60 วินาที · ยอดผู้ชมนับตามจำนวนคน ไม่ใช่จำนวนครั้ง
          </p>
        </div>

        <ReelUploader onCreated={(reel) => setReels((prev) => [reel, ...prev])} />
      </header>

      <div className="mb-4 flex rounded-lg border border-border p-0.5">
        {(['all', 'following'] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setFeed(value)}
            className={`flex-1 rounded-md px-3 py-1 text-sm transition-colors ${
              feed === value
                ? 'bg-primary text-primary-foreground'
                : 'hover:bg-accent'
            }`}
          >
            {value === 'all' ? 'ทั้งหมด' : 'คนที่ติดตาม'}
          </button>
        ))}
      </div>

      {loading && (
        <p className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          กำลังโหลด…
        </p>
      )}

      {error && (
        <p className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {!loading && !error && reels.length === 0 && (
        <p className="py-8 text-center text-sm text-muted-foreground">
          ยังไม่มีคลิป — กดปุ่มอัปโหลดเพื่อลงคลิปแรก
        </p>
      )}

      <ul className="space-y-4">
        {reels.map((reel) => (
          <li
            key={reel.id}
            className="overflow-hidden rounded-xl border border-border bg-card"
          >
            <div className="flex items-center gap-2.5 px-3 py-2.5">
              <Avatar username={reel.author_username} size={32} />
              <div className="min-w-0 flex-1">
                <UserName username={reel.author_username} className="text-sm" />
                <p className="text-[11px] text-muted-foreground">
                  {new Date(reel.created_at).toLocaleString('th-TH')} ·{' '}
                  {Math.round(reel.duration_ms / 1000)} วินาที
                </p>
              </div>
            </div>

            <ReelPlayer reel={reel} onFirstPlay={() => void markViewed(reel)} />

            <div className="px-3 py-2.5">
              <h2 className="font-semibold leading-snug">{reel.title}</h2>
              {reel.caption && (
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {reel.caption}
                </p>
              )}

              {/* ต้อง wrap ได้ เพราะแผงคอมเมนต์เป็นลูกของแถวนี้โดยตรง
                * (ReelComments คืน fragment: ปุ่ม + แผง) ถ้าแถวไม่ wrap
                * แผงที่ขอ w-full จะถูกบีบจนเหลือเส้นเดียวที่ความกว้างมือถือ */}
              <div className="mt-2 flex flex-wrap items-center gap-4">
                <button
                  type="button"
                  onClick={() => void toggleLike(reel)}
                  className="flex items-center gap-1.5 text-sm transition-colors hover:text-primary"
                >
                  <Heart
                    className={`size-4 ${reel.liked_by_me ? 'fill-destructive text-destructive' : ''}`}
                  />
                  <span className="tabular-nums">{reel.like_count}</span>
                </button>

                <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Eye className="size-4" />
                  <span className="tabular-nums">{reel.view_count}</span>
                </span>

                <ReelComments reel={reel} />

                <button
                  type="button"
                  onClick={() => void toggleSave(reel)}
                  className="ml-auto transition-colors hover:text-primary"
                  aria-label={saved.has(reel.id) ? 'เอาออก' : 'บันทึกไว้'}
                >
                  {saved.has(reel.id) ? (
                    <BookmarkCheck className="size-4 text-primary" />
                  ) : (
                    <Bookmark className="size-4 text-muted-foreground" />
                  )}
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/// เล่นคลิปจาก signed URL ที่ขอตอนกดเล่น
///
/// ไม่ขอ URL ล่วงหน้าทุกคลิปในฟีด เพราะ URL มีอายุ 120 วินาที ถ้าขอไว้ตอน
/// โหลดหน้า คลิปที่อยู่ท้ายฟีดจะหมดอายุก่อนผู้ใช้เลื่อนไปถึง
function ReelPlayer({
  reel,
  onFirstPlay,
}: {
  reel: Reel;
  onFirstPlay: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function play() {
    setLoading(true);
    setError(null);

    try {
      // ชื่อ field คือ download_url ไม่ใช่ url — เทียบจาก openapi.json
      // (เดาชื่อเองจะได้ undefined แล้ว <video src=undefined> จะเงียบ ไม่ error)
      const result = await api.get<{
        download_url: string;
        expires_at: string;
        as_attachment: boolean;
      }>(`/assets/${reel.asset_id}/download-url`);

      setUrl(result.download_url);
      onFirstPlay();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'เปิดคลิปไม่ได้');
    } finally {
      setLoading(false);
    }
  }

  if (url) {
    return (
      <video
        src={url}
        controls
        autoPlay
        playsInline
        className="aspect-9/16 max-h-[70vh] w-full bg-black object-contain"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => void play()}
      disabled={loading}
      className="grid aspect-video w-full place-items-center bg-muted transition-colors hover:bg-accent"
    >
      <span className="flex flex-col items-center gap-2 text-sm text-muted-foreground">
        {loading ? (
          <Loader2 className="size-6 animate-spin" />
        ) : (
          <span className="grid size-12 place-items-center rounded-full bg-primary text-primary-foreground">
            ▶
          </span>
        )}
        {error ?? 'กดเพื่อเล่น'}
      </span>
    </button>
  );
}

function ReelComments({ reel }: { reel: Reel }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<ReelComment[]>([]);
  const [draft, setDraft] = useState('');
  const [count, setCount] = useState<number | null>(null);

  async function toggle() {
    const next = !open;

    setOpen(next);

    if (next) {
      const page = await api.list<ReelComment>(
        `/reels/${reel.id}/comments?per_page=50`,
      );

      setItems(page.items);
      setCount(page.meta.total_items);
    }
  }

  async function send() {
    if (!draft.trim()) return;

    const comment = await api.post<ReelComment>(`/reels/${reel.id}/comments`, {
      content: draft.trim(),
    });

    setItems((prev) => [comment, ...prev]);
    setCount((prev) => (prev ?? 0) + 1);
    setDraft('');
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void toggle()}
        // ตัวเลขยังไม่มาตอนแรก ปุ่มจึงว่างเปล่าสำหรับโปรแกรมอ่านหน้าจอ
        // ต้องมีชื่อที่ไม่ขึ้นกับข้อมูลที่โหลดทีหลัง
        aria-label={
          count === null
            ? 'ดูคอมเมนต์'
            : `ดูคอมเมนต์ (${count} รายการ)`
        }
        aria-expanded={open}
        className="flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <MessageSquare className="size-4" aria-hidden="true" />
        {count !== null && <span className="tabular-nums">{count}</span>}
      </button>

      {open && (
        <div className="mt-2 w-full basis-full space-y-2 border-t border-border pt-2">
          <div className="flex gap-2">
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void send();
              }}
              placeholder="คอมเมนต์…"
              className="min-w-0 flex-1 rounded-lg border border-input bg-background px-3 py-1.5 text-sm"
            />
            <button
              type="button"
              onClick={() => void send()}
              disabled={!draft.trim()}
              className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground disabled:opacity-40"
              aria-label="ส่ง"
            >
              <Send className="size-4" />
            </button>
          </div>

          {items.map((comment) => (
            <div key={comment.id} className="flex items-start gap-2">
              <Avatar username={comment.author_username} size={22} />
              <div className="min-w-0 flex-1">
                <UserName
                  username={comment.author_username}
                  className="text-xs"
                />
                <p className="break-words text-sm">{comment.content}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/// อัปโหลดคลิปด้วยท่อสามจังหวะของหลังบ้าน
///
///   1. ขอ intent → ได้ signed URL (ตรวจโควตาและนามสกุลที่จังหวะนี้)
///   2. PUT ไฟล์ขึ้น storage ตรง ไม่ผ่าน API ของเรา
///   3. commit → หลังบ้านตรวจ magic bytes กับขนาดจริง แล้วตัดโควตา
///
/// จังหวะที่สามคือจุดที่กันไฟล์ปลอมนามสกุล ฉะนั้นถ้าข้ามไป ไฟล์จะค้าง
/// สถานะ PENDING แล้วถูกตัวเก็บกวาดลบทิ้งภายในชั่วโมง
function ReelUploader({ onCreated }: { onCreated: (reel: Reel) => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [caption, setCaption] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const me = getIdentity();

  async function upload() {
    if (!file || !title.trim()) return;

    setError(null);

    try {
      setStep('ขอสิทธิ์อัปโหลด…');

      const intent = await api.post<{
        asset_id: string;
        upload_url: string;
        upload_method: string;
        upload_headers: Record<string, string>;
        expires_at: string;
      }>('/assets/upload-intents', {
        file_name: file.name,
        size_bytes: file.size,
        bucket: 'reels',
      });

      setStep('อัปโหลดไฟล์…');

      // ใช้ method และ header ที่หลังบ้านสั่งมา ไม่ hardcode
      // เพราะตอนย้ายไป Supabase Storage ค่าพวกนี้จะเปลี่ยน แล้วถ้า hardcode
      // ไว้ที่หน้าบ้าน การอัปโหลดจะพังทั้งระบบโดยที่หลังบ้านไม่มีอะไรผิด
      const put = await fetch(intent.upload_url, {
        method: intent.upload_method || 'PUT',
        headers: intent.upload_headers ?? {},
        body: file,
      });

      if (!put.ok) {
        throw new Error(`อัปโหลดไฟล์ไม่สำเร็จ (HTTP ${put.status})`);
      }

      setStep('ยืนยันไฟล์…');

      await api.post(`/assets/${intent.asset_id}/commit`);

      setStep('สร้างคลิป…');

      // ความยาวจริงต้องอ่านจากตัวไฟล์ ไม่ใช่ให้ผู้ใช้กรอก
      const durationMs = await readDuration(file);

      const reel = await api.post<Reel>('/reels', {
        title: title.trim(),
        ...(caption.trim() ? { caption: caption.trim() } : {}),
        asset_id: intent.asset_id,
        duration_ms: durationMs,
      });

      onCreated(reel);
      setOpen(false);
      setTitle('');
      setCaption('');
      setFile(null);
    } catch (caught) {
      // ข้อความจากหลังบ้านบอกสาเหตุจริง เช่น
      // "เนื้อไฟล์ไม่ตรงกับนามสกุล .mp4" หรือ "พื้นที่เก็บไฟล์ไม่พอ"
      setError(caught instanceof Error ? caught.message : 'อัปโหลดไม่สำเร็จ');
    } finally {
      setStep(null);
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
      >
        <Upload className="size-4" />
        ลงคลิป
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-80 space-y-2 rounded-lg border border-border bg-popover p-3 shadow-lg">
          <input
            type="file"
            accept="video/mp4,video/webm"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            className="w-full text-sm"
          />

          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="หัวข้อคลิป"
            className="w-full rounded-lg border border-input bg-background px-2 py-1.5 text-sm"
          />

          <input
            value={caption}
            onChange={(event) => setCaption(event.target.value)}
            placeholder="คำบรรยาย (ไม่ใส่ก็ได้)"
            className="w-full rounded-lg border border-input bg-background px-2 py-1.5 text-sm"
          />

          <p className="text-[11px] leading-snug text-muted-foreground">
            โควตาของ {me.username} ดูได้ที่แผงผู้ดูแล · ไฟล์ถูกตรวจ magic bytes
            ที่จังหวะยืนยัน จึงเปลี่ยนนามสกุลหลอกไม่ได้
          </p>

          {error && <p className="text-xs text-destructive">{error}</p>}

          <button
            type="button"
            disabled={!file || !title.trim() || step !== null}
            onClick={() => void upload()}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-40"
          >
            {step && <Loader2 className="size-4 animate-spin" />}
            {step ?? 'อัปโหลด'}
          </button>
        </div>
      )}
    </div>
  );
}

/// อ่านความยาวคลิปจากตัวไฟล์
///
/// หลังบ้านบังคับ duration_ms <= 60000 ถ้าให้ผู้ใช้กรอกเอง เขาจะกรอกเลขที่
/// ผ่านเงื่อนไขแล้วอัปคลิปยาวสิบนาทีก็ได้ — ค่าที่เชื่อได้ต้องมาจากไฟล์
function readDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');

    const finish = (ms: number) => {
      URL.revokeObjectURL(url);
      resolve(ms);
    };

    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      const ms = Math.round((video.duration || 0) * 1000);

      // เผื่อเบราว์เซอร์อ่าน metadata ไม่ได้ (คืน Infinity ในบางกรณี)
      finish(Number.isFinite(ms) && ms > 0 ? Math.min(ms, 60000) : 1000);
    };
    video.onerror = () => finish(1000);
    video.src = url;
  });
}
