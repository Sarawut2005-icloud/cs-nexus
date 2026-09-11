'use client';

import { useState } from 'react';
import { SmilePlus } from 'lucide-react';
import { api, qs } from '@/lib/csmju/api';
import {
  ALLOWED_EMOJI,
  type ReactionSummary,
  type ReactionTarget,
} from '@/lib/csmju/types';

/// แถบอิโมจิ — ใช้ได้ทั้งกระทู้ คลิป และข้อความแชท
///
/// รายการอิโมจิมาจาก ALLOWED_EMOJI ที่ต้องตรงกับหลังบ้าน ถ้าไม่ตรงผู้ใช้จะกด
/// แล้วได้ 400 ทั้งที่ปุ่มโผล่อยู่ — จึงประกาศไว้ที่เดียวใน types.ts
///
/// อัปเดตแบบ optimistic ไม่ทำ เพราะยอดที่หลังบ้านคืนมาเป็นชุดสมบูรณ์อยู่แล้ว
/// (รวมทั้งของคนอื่นที่กดพร้อมกัน) การเดาเองแล้วค่อยแก้จะทำให้เลขกระพริบ
/// ชื่อของแต่ละอิโมจิสำหรับโปรแกรมอ่านหน้าจอ
///
/// ปุ่มที่มีแต่ `<span aria-hidden>{emoji}</span>` ข้างใน = ปุ่มที่ไม่มีชื่อเลย
/// โปรแกรมอ่านหน้าจอจะอ่านว่า "ปุ่ม" เฉย ๆ ทั้งแถว ผู้ใช้จึงเลือกไม่ถูกว่า
/// อันไหนคืออันไหน
const EMOJI_LABEL: Record<string, string> = {
  '👍': 'ถูกใจ',
  '❤️': 'หัวใจ',
  '😂': 'ขำ',
  '😮': 'ประหลาดใจ',
  '😢': 'เศร้า',
  '😠': 'ไม่พอใจ',
  '🎉': 'ยินดี',
  '🔥': 'เจ๋ง',
  '🙏': 'ขอบคุณ',
  '✅': 'เรียบร้อย',
  '❓': 'สงสัย',
  '💡': 'ไอเดีย',
};

function emojiLabel(emoji: string): string {
  return EMOJI_LABEL[emoji] ?? emoji;
}

export function ReactionBar({
  targetKind,
  targetId,
  summary,
  onChange,
  compact = false,
}: {
  targetKind: ReactionTarget;
  targetId: string;
  summary: ReactionSummary | null;
  onChange: (next: ReactionSummary) => void;
  compact?: boolean;
}) {
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle(emoji: string, mine: boolean) {
    setBusy(true);
    setError(null);

    try {
      const query = qs({
        target_kind: targetKind,
        target_id: targetId,
        emoji,
      });

      const next = mine
        ? await api.del<ReactionSummary>(`/reactions${query}`)
        : await api.post<ReactionSummary>('/reactions', {
            target_kind: targetKind,
            target_id: targetId,
            emoji,
          });

      onChange(next);
      setPicking(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'กดไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  const totals = summary?.totals ?? [];

  return (
    <div className="flex flex-wrap items-center gap-1">
      {totals.map((row) => (
        <button
          key={row.emoji}
          type="button"
          disabled={busy}
          onClick={() => void toggle(row.emoji, row.reacted_by_me)}
          title={row.reacted_by_me ? 'กดอีกครั้งเพื่อถอน' : 'กดเพื่อรีแอ็กชัน'}
          className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors disabled:opacity-50 ${
            row.reacted_by_me
              ? 'border-primary bg-secondary text-secondary-foreground'
              : 'border-border hover:bg-accent'
          }`}
        >
          <span aria-hidden>{row.emoji}</span>
          <span className="font-medium tabular-nums">{row.count}</span>
          <span className="sr-only">
            {emojiLabel(row.emoji)} {row.count} คน
            {row.reacted_by_me ? ' · คุณกดแล้ว' : ''}
          </span>
        </button>
      ))}

      <div className="relative">
        <button
          type="button"
          onClick={() => setPicking((v) => !v)}
          className="grid size-6 place-items-center rounded-full border border-border text-muted-foreground transition-colors hover:bg-accent"
          aria-label="เพิ่มรีแอ็กชัน"
        >
          <SmilePlus className="size-3.5" />
        </button>

        {picking && (
          <div
            className={`absolute z-40 flex w-56 flex-wrap gap-1 rounded-lg border border-border bg-popover p-2 shadow-lg ${
              compact ? 'bottom-full mb-1 left-0' : 'top-full mt-1 left-0'
            }`}
          >
            {ALLOWED_EMOJI.map((emoji) => {
              const mine =
                totals.find((t) => t.emoji === emoji)?.reacted_by_me ?? false;

              return (
                <button
                  key={emoji}
                  type="button"
                  disabled={busy}
                  onClick={() => void toggle(emoji, mine)}
                  aria-label={emojiLabel(emoji)}
                  aria-pressed={mine}
                  className={`grid size-8 place-items-center rounded transition-colors hover:bg-accent disabled:opacity-50 ${
                    mine ? 'bg-secondary' : ''
                  }`}
                >
                  <span aria-hidden>{emoji}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}
