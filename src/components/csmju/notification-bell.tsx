'use client';

import { useCallback, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, Check } from 'lucide-react';
import { api } from '@/lib/csmju/api';
import {
  bindSocket,
  connectSocket,
  onSocketReconnect,
} from '@/lib/csmju/socket';
import {
  describeNotification,
  timeAgo,
} from '@/lib/csmju/notifications';
import type { Notification } from '@/lib/csmju/types';


const NOTIFICATIONS_KEY = ['notifications', 'bell'] as const;

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: NOTIFICATIONS_KEY,
    queryFn: async () => {
      const [count, page] = await Promise.all([
        api.get<{ unread_count: number }>('/notifications/unread-count'),
        api.list<Notification>('/notifications?per_page=15'),
      ]);

      return { unread: count.unread_count, items: page.items };
    },
  });

  const unread = data?.unread ?? 0;
  const items = data?.items ?? [];

  /// เขียนทับแคชของกระดิ่งโดยตรง
  ///
  /// ใช้กับสิ่งที่เรารู้ผลอยู่แล้ว (อ่านแล้ว · มีตัวใหม่เข้ามาทาง socket)
  /// จะได้ไม่ต้องยิงถามหลังบ้านซ้ำในสิ่งที่เพิ่งทำเอง
  const patchCache = useCallback(
    (next: { unread: number; items: Notification[] }) => {
      queryClient.setQueryData(NOTIFICATIONS_KEY, next);
    },
    [queryClient],
  );

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY });
  }, [queryClient]);

  // ฟังการแจ้งเตือนสด — หลังบ้านส่งเข้าห้องส่วนตัว user:<username>
  // ซึ่ง socket เข้าให้อัตโนมัติตอนต่อ จึงไม่ต้อง subscribe อะไรเพิ่ม
  useEffect(() => {
    let cancelled = false;
    let unbind: (() => void) | null = null;

    void (async () => {
      try {
        const socket = await connectSocket();

        if (cancelled) return;

        // ต้องถอดตอน unmount ด้วย — เดิมผูกแล้วปล่อยทิ้ง ทำให้ใน StrictMode
        // (และทุกครั้งที่ component นี้ mount ใหม่) มีผู้ฟังซ้อนกันหลายตัว
        // อาการคือการแจ้งเตือนหนึ่งครั้งเด้งขึ้นมาสองสามรายการ
        unbind = bindSocket<{
          notification: Notification;
          unread_count: number;
        }>(socket, 'notification:new', (payload) => {
          const current = queryClient.getQueryData<{
            unread: number;
            items: Notification[];
          }>(NOTIFICATIONS_KEY);

          patchCache({
            unread: payload.unread_count,
            items: [payload.notification, ...(current?.items ?? [])].slice(
              0,
              15,
            ),
          });
        });

        // ผูกผ่าน bindSocket จึงถูกย้ายไปที่ socket ตัวใหม่เองหลังต่อกลับ
        // แต่ระหว่างที่หลุดอาจมีการแจ้งเตือนที่พลาดไป จึงต้องดึงมาใหม่
        const stopReconnect = onSocketReconnect(() => void refresh());
        const unbindEvent = unbind;

        unbind = () => {
          unbindEvent();
          stopReconnect();
        };
      } catch {
        // ต่อ socket ไม่ได้ = ยังใช้งานได้ แค่ต้องรีเฟรชเอง
      }
    })();

    return () => {
      cancelled = true;
      unbind?.();
    };
  }, [refresh, patchCache, queryClient]);

  async function markAll() {
    await api.patch('/notifications/read-all');
    await refresh();
  }

  async function markOne(id: string) {
    const result = await api.patch<{ unread_count: number }>(
      `/notifications/${id}/read`,
    );

    patchCache({
      unread: result.unread_count,
      items: items.map((item) =>
        item.id === id ? { ...item, read_at: new Date().toISOString() } : item,
      ),
    });
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative grid size-9 place-items-center rounded-lg border border-border bg-card transition-colors hover:bg-accent"
        aria-label={`การแจ้งเตือน${unread > 0 ? ` (${unread} ยังไม่อ่าน)` : ''}`}
      >
        <Bell className="size-4" />

        {unread > 0 && (
          <span className="absolute -right-1 -top-1 grid min-w-4.5 place-items-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-4 text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-80 overflow-hidden rounded-lg border border-border bg-popover shadow-lg">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="text-sm font-medium">การแจ้งเตือน</span>

            {unread > 0 && (
              <button
                type="button"
                onClick={markAll}
                className="flex items-center gap-1 text-xs text-primary hover:underline"
              >
                <Check className="size-3" />
                อ่านทั้งหมด
              </button>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto">
            {items.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                ยังไม่มีการแจ้งเตือน
              </p>
            ) : (
              items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => void markOne(item.id)}
                  className={`block w-full border-b border-border px-3 py-2.5 text-left last:border-0 transition-colors hover:bg-accent ${
                    item.read_at ? '' : 'bg-secondary/60'
                  }`}
                >
                  <span className="block text-sm leading-snug">
                    {describeNotification(item)}
                  </span>
                  <span className="mt-0.5 block text-[11px] text-muted-foreground">
                    {timeAgo(item.created_at)}
                    {item.read_at ? '' : ' · ยังไม่อ่าน'}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
