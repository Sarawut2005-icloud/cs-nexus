'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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

/// ขนาดของแผงเลือกอิโมจิ ใช้คำนวณตำแหน่งก่อนวาด
const PANEL_WIDTH = 224;
const PANEL_HEIGHT = 120;
const GAP = 6;

/// ตำแหน่งที่แผงจะไปโผล่ คำนวณจากตำแหน่งจริงของปุ่มบนหน้าจอ
///
/// **บั๊กที่ตัวนี้แก้: แผงอิโมจิถูกตัดขอบจนกดไม่ได้**
///
/// ของเดิมวางแผงด้วย `absolute` ซึ่งอ้างอิงกล่องแม่ แต่รายการข้อความอยู่ใน
/// กรอบที่เลื่อนได้ (`overflow-y-auto`) แผงจึงถูกกรอบนั้นตัดทิ้ง — ข้อความที่
/// อยู่ใกล้ขอบบนหรือขอบล่างจะเห็นแผงแค่ครึ่งเดียวหรือไม่เห็นเลย
///
/// และเพราะตำแหน่งตายตัวเป็น `left-0` แถวที่อยู่ชิดขอบขวาจะดันแผงออกนอกจอ
///
/// วางด้วย `fixed` ผ่าน portal ไปที่ body แทน ก็พ้นทุกกรอบที่ตัดขอบ แล้วค่อย
/// พลิกขึ้น/ลงและหนีบให้อยู่ในจอตามที่ว่างจริง
function panelPosition(button: HTMLElement) {
  const rect = button.getBoundingClientRect();
  const below = window.innerHeight - rect.bottom;
  const flipUp = below < PANEL_HEIGHT + GAP && rect.top > below;

  return {
    top: flipUp ? rect.top - PANEL_HEIGHT - GAP : rect.bottom + GAP,
    left: Math.min(
      Math.max(GAP, rect.left),
      Math.max(GAP, window.innerWidth - PANEL_WIDTH - GAP),
    ),
  };
}

export function ReactionBar({
  targetKind,
  targetId,
  summary,
  onChange,
}: {
  targetKind: ReactionTarget;
  targetId: string;
  summary: ReactionSummary | null;
  onChange: (next: ReactionSummary) => void;
  /// เดิมมี `compact` ไว้สั่งให้แผงอิโมจิพลิกขึ้นบน — ไม่ต้องแล้ว
  /// เพราะตอนนี้ดูที่ว่างจริงบนหน้าจอเอง
}) {
  const [picking, setPicking] = useState<{ top: number; left: number } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  /// ปิดแผงเมื่อกดที่อื่นหรือกด Esc และขยับตามปุ่มเมื่อหน้าจอเลื่อน
  ///
  /// ของเดิมปิดได้ทางเดียวคือกดปุ่มเดิมซ้ำ ซึ่งหาไม่เจอถ้าแผงบังปุ่มอยู่
  ///
  /// **เคยเขียนให้ "เลื่อนแล้วปิด" แล้วพบว่าแผงไม่เคยโผล่เลย** เพราะหน้าแชท
  /// เลื่อนตัวเองลงล่างสุดอยู่เรื่อย ๆ (scrollIntoView ตอนมีข้อความใหม่)
  /// ตัวดักแบบ capture จึงจับการเลื่อนนั้นแล้วปิดแผงทิ้งทันทีที่เปิด
  /// — ขยับตามจึงถูกกว่า และเป็นพฤติกรรมที่ผู้ใช้คาดหวังอยู่แล้ว
  useEffect(() => {
    if (!picking) return;

    const dismiss = (event: Event) => {
      if (event.type === 'keydown') {
        if ((event as KeyboardEvent).key === 'Escape') setPicking(null);

        return;
      }

      const target = event.target as Node | null;

      // กดในแผงเองไม่ใช่ "กดที่อื่น" — ไม่งั้นเลือกอิโมจิไม่ได้เลย
      if (target && panelRef.current?.contains(target)) return;
      if (target && triggerRef.current?.contains(target)) return;

      setPicking(null);
    };

    const follow = () => {
      const trigger = triggerRef.current;

      if (trigger) setPicking(panelPosition(trigger));
    };

    document.addEventListener('keydown', dismiss);
    document.addEventListener('pointerdown', dismiss);
    window.addEventListener('scroll', follow, true);
    window.addEventListener('resize', follow);

    return () => {
      document.removeEventListener('keydown', dismiss);
      document.removeEventListener('pointerdown', dismiss);
      window.removeEventListener('scroll', follow, true);
      window.removeEventListener('resize', follow);
    };
  }, [picking]);

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
      setPicking(null);
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
          ref={triggerRef}
          type="button"
          onClick={() => {
            // **ต้องอ่านตำแหน่งจาก ref ไม่ใช่ `event.currentTarget`**
            //
            // ฟังก์ชันอัปเดต state ของ React ทำงานทีหลัง ตอนนั้น React เคลียร์
            // `currentTarget` ของ event ไปแล้ว ค่าจึงเป็น null แล้วโยน
            // TypeError เงียบ ๆ ข้างใน — ผลคือกดปุ่มแล้วแผงไม่โผล่เลย
            const trigger = triggerRef.current;

            setPicking((current) =>
              current || !trigger ? null : panelPosition(trigger),
            );
          }}
          aria-expanded={picking !== null}
          className="grid size-6 place-items-center rounded-full border border-border text-muted-foreground transition-colors hover:bg-accent"
          aria-label="เพิ่มรีแอ็กชัน"
        >
          <SmilePlus className="size-3.5" />
        </button>

        {picking && createPortal(
          <div
            ref={panelRef}
            role="group"
            aria-label="เลือกอิโมจิ"
            style={{
              top: picking.top,
              left: picking.left,
              width: PANEL_WIDTH,
            }}
            className="fixed z-100 flex flex-wrap gap-1 rounded-lg border border-border bg-popover p-2 shadow-lg"
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
          </div>,
          document.body,
        )}
      </div>

      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}
