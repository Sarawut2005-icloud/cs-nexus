'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Film, Hash, Loader2, Trash2 } from 'lucide-react';
import { UserName } from '@/components/csmju/user-name';
import { api, ApiError, qs } from '@/lib/csmju/api';
import type { Bookmark } from '@/lib/csmju/types';

/// รายการที่บันทึกไว้ดูทีหลัง — เห็นได้เฉพาะเจ้าของ
///
/// หลังบ้านผูก where กับ username ทุกคิวรี และไม่มี endpoint ให้ดูของคนอื่นเลย
/// เพราะ "สิ่งที่คนหนึ่งเก็บไว้อ่าน" เป็นข้อมูลส่วนตัวพอ ๆ กับประวัติการค้นหา
///
/// ของที่ถูกลบไปแล้วจะคืน title = null แทนที่จะหายจากรายการเงียบ ๆ
/// เพื่อให้ผู้ใช้รู้ว่าเกิดอะไรขึ้นและกดลบทิ้งเองได้

const BOOKMARKS_KEY = ['bookmarks'] as const;

export default function SavedPage() {
  const queryClient = useQueryClient();

  const {
    data: items = [],
    isPending: loading,
    error: queryError,
  } = useQuery({
    queryKey: BOOKMARKS_KEY,
    queryFn: async () => {
      const page = await api.list<Bookmark>('/bookmarks?per_page=50');

      return page.items;
    },
  });

  const removeMutation = useMutation({
    mutationFn: (item: Bookmark) =>
      api.del(
        `/bookmarks${qs({
          target_kind: item.target_kind,
          target_id: item.target_id,
        })}`,
      ),
    // ตัดออกจากแคชเองแทนการดึงใหม่ทั้งหน้า — ผู้ใช้เพิ่งสั่งลบ เรารู้ผลอยู่แล้ว
    onSuccess: (_result, item) => {
      queryClient.setQueryData<Bookmark[]>(BOOKMARKS_KEY, (current) =>
        (current ?? []).filter(
          (row) =>
            !(
              row.target_id === item.target_id &&
              row.target_kind === item.target_kind
            ),
        ),
      );
    },
  });

  const error = queryError
    ? queryError instanceof ApiError
      ? queryError.message
      : 'โหลดรายการไม่สำเร็จ'
    : removeMutation.error
      ? removeMutation.error instanceof ApiError
        ? removeMutation.error.message
        : 'ลบรายการไม่สำเร็จ'
      : null;

  function remove(item: Bookmark) {
    removeMutation.mutate(item);
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <header className="mb-4">
        <h1 className="text-xl font-semibold">ที่บันทึกไว้</h1>
        <p className="text-sm text-muted-foreground">
          เห็นได้เฉพาะคุณ · คนอื่นดูรายการนี้ไม่ได้
        </p>
      </header>

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

      {!loading && items.length === 0 && (
        <p className="py-8 text-center text-sm text-muted-foreground">
          ยังไม่มีอะไรบันทึกไว้ — กดไอคอนบุ๊กมาร์กที่กระทู้หรือคลิปได้เลย
        </p>
      )}

      <ul className="space-y-2">
        {items.map((item) => (
          <li
            key={`${item.target_kind}-${item.target_id}`}
            className="flex items-start gap-2.5 rounded-xl border border-border bg-card p-3"
          >
            {item.target_kind === 'REEL' ? (
              <Film className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            ) : (
              <Hash className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            )}

            <div className="min-w-0 flex-1">
              {item.title ? (
                <p className="truncate font-medium">{item.title}</p>
              ) : (
                <p className="truncate font-medium text-muted-foreground">
                  (รายการนี้ถูกลบไปแล้ว)
                </p>
              )}

              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {item.target_kind === 'REEL' ? 'คลิป' : 'กระทู้'}
                {item.author_username && (
                  <>
                    {' · '}
                    <UserName
                      username={item.author_username}
                      className="text-[11px]"
                    />
                  </>
                )}
                {' · บันทึกเมื่อ '}
                {new Date(item.created_at).toLocaleDateString('th-TH')}
              </p>
            </div>

            <button
              type="button"
              onClick={() => void remove(item)}
              className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
              aria-label="เอาออกจากที่บันทึก"
            >
              <Trash2 className="size-4" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
