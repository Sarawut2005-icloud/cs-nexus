'use client';

import { useCallback, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Plus, User } from 'lucide-react';
import { StoryViewer, type Story } from '@/components/ui/story-viewer';
import { api, ApiError } from '@/lib/csmju/api';
import { getIdentity } from '@/lib/csmju/identity';
import type { StoryTray } from '@/lib/csmju/types';

/// แถวสตอรี่บนสุดของฟีด
///
/// ต่อกับ GET /stories ซึ่งคืนสตอรี่ที่ยังไม่หมดอายุของตัวเองและของคนที่ติดตาม
/// จัดกลุ่มตามเจ้าของมาให้แล้ว พร้อม has_unseen สำหรับตัดสินสีวงแหวน
///
/// media_url ที่ได้มาเป็น signed URL อายุ 5 นาที ถ้าผู้ใช้เปิดฟีดค้างไว้นาน
/// แล้วกดดู รูปจะโหลดไม่ขึ้น — onMediaError จึงดึงแถวใหม่ให้อัตโนมัติ

export function StoryRow() {
  const me = getIdentity();
  const refreshing = useRef(false);

  const {
    data: trays = [],
    isPending: loading,
    error: queryError,
    refetch,
  } = useQuery({
    queryKey: ['stories'],
    queryFn: () => api.get<StoryTray[]>('/stories'),
  });

  const error =
    queryError instanceof ApiError ? queryError.message : null;

  /// signed URL หมดอายุ → ดึงแถวใหม่ครั้งเดียว ไม่วนซ้ำ
  const refreshUrls = useCallback(() => {
    if (refreshing.current) return;

    refreshing.current = true;

    void refetch().finally(() => {
      // ปลดล็อกหลังหนึ่งวินาที เพื่อไม่ให้ error หลายชิ้นยิงซ้อนกันเป็นสิบครั้ง
      setTimeout(() => {
        refreshing.current = false;
      }, 1000);
    });
  }, [refetch]);

  async function markViewed(storyId: string) {
    try {
      await api.post(`/stories/${storyId}/views`);
    } catch {
      // นับการดูพลาดไม่ควรขัดจังหวะการดู
    }
  }

  const mine = trays.find((tray) => tray.is_me);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        กำลังโหลดสตอรี่…
      </div>
    );
  }

  return (
    <div className="mb-4">
      {error && (
        <p className="mb-2 text-xs text-destructive">{error}</p>
      )}

      <div className="flex gap-4 overflow-x-auto py-2 [&::-webkit-scrollbar]:hidden">
        {/* ของตัวเอง: ถ้ามีสตอรี่อยู่แล้วให้กดดู ถ้ายังไม่มีให้กดโพสต์ */}
        {mine ? (
          <StoryViewer
            stories={toStories(mine)}
            username={me.username}
            timestamp={mine.stories.at(-1)?.created_at}
            hasUnseen={mine.has_unseen}
            label="สตอรี่ของคุณ"
            onStoryView={(story) => void markViewed(story.id)}
            onMediaError={refreshUrls}
            onAllStoriesViewed={() => void refetch()}
          />
        ) : (
          <AddStoryButton onPosted={() => void refetch()} />
        )}

        {trays
          .filter((tray) => !tray.is_me)
          .map((tray) => (
            <StoryViewer
              key={tray.author_username}
              stories={toStories(tray)}
              username={tray.author_username}
              timestamp={tray.stories.at(-1)?.created_at}
              hasUnseen={tray.has_unseen}
              onStoryView={(story) => void markViewed(story.id)}
              onMediaError={refreshUrls}
              onAllStoriesViewed={() => void refetch()}
            />
          ))}

        {mine && <AddStoryButton onPosted={() => void refetch()} />}
      </div>

      {trays.length === 0 && !error && (
        <p className="text-xs text-muted-foreground">
          ยังไม่มีสตอรี่ — โพสต์ของคุณเอง หรือไปติดตามคนอื่นเพื่อเห็นของเขา
        </p>
      )}
    </div>
  );
}

function toStories(tray: StoryTray): Story[] {
  return tray.stories.map((item) => ({
    id: item.id,
    type: item.kind === 'VIDEO' ? 'video' : 'image',
    src: item.media_url,
  }));
}

/// โพสต์สตอรี่ผ่านท่ออัปโหลดสามจังหวะเดียวกับคลิปและไฟล์แนบ
function AddStoryButton({ onPosted }: { onPosted: () => void }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setError(null);

    try {
      setStep('ขอสิทธิ์…');

      const intent = await api.post<{
        asset_id: string;
        upload_url: string;
        upload_method: string;
        upload_headers: Record<string, string>;
      }>('/assets/upload-intents', {
        file_name: file.name,
        size_bytes: file.size,
        bucket: 'attachments',
      });

      setStep('อัปโหลด…');

      const put = await fetch(intent.upload_url, {
        method: intent.upload_method || 'PUT',
        headers: intent.upload_headers ?? {},
        body: file,
      });

      if (!put.ok) {
        throw new Error(`อัปโหลดไฟล์ไม่สำเร็จ (HTTP ${put.status})`);
      }

      setStep('ยืนยัน…');
      await api.post(`/assets/${intent.asset_id}/commit`);

      setStep('โพสต์…');
      await api.post('/stories', { asset_id: intent.asset_id });

      onPosted();
    } catch (caught) {
      // ข้อความจากหลังบ้านบอกสาเหตุจริง เช่น "สตอรี่รับเฉพาะรูปภาพและวิดีโอ"
      setError(caught instanceof Error ? caught.message : 'โพสต์ไม่สำเร็จ');
    } finally {
      setStep(null);

      if (inputRef.current) {
        inputRef.current.value = '';
      }
    }
  }

  return (
    <div className="flex shrink-0 flex-col items-center gap-2">
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];

          if (file) void upload(file);
        }}
      />

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={step !== null}
        className="group relative cursor-pointer disabled:cursor-default"
        aria-label="โพสต์สตอรี่"
      >
        <span className="grid size-[72px] place-items-center rounded-full border-2 border-dashed border-muted-foreground/40 bg-muted/30 transition-colors group-hover:border-muted-foreground/60 group-hover:bg-muted/50">
          {step ? (
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          ) : (
            <User className="size-7 text-muted-foreground/50" />
          )}
        </span>

        <span className="absolute bottom-0 right-0 grid size-6 place-items-center rounded-full bg-primary shadow-sm transition-transform group-hover:scale-110">
          <Plus className="size-4 text-primary-foreground" strokeWidth={2.5} />
        </span>
      </button>

      <span className="max-w-[80px] truncate text-xs text-muted-foreground">
        {step ?? 'เพิ่มสตอรี่'}
      </span>

      {error && (
        <span className="max-w-[140px] text-center text-[10px] leading-tight text-destructive">
          {error}
        </span>
      )}
    </div>
  );
}
