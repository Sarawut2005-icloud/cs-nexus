'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { UserAvatar, VerifiedBadge } from '@/components/csmju/user-badge';
import { api } from '@/lib/csmju/api';
import type { ProfileSummary } from '@/lib/csmju/types';

/// แคชชื่อที่แสดงในหน่วยความจำของแท็บ + รวบคำขอเป็นชุด
///
/// ปัญหาที่แก้: ฟีดหนึ่งหน้ามี 20 รายการจาก 5 คน ถ้าแต่ละ <UserName> ยิง
/// คำขอของตัวเอง จะได้ 20 คำขอที่ถามเรื่องเดิมซ้ำ ๆ
///
/// วิธีแก้: ทุกตัวที่ mount ในเฟรมเดียวกันจะถูกรวบเป็นคำขอเดียว
/// (`GET /profiles?usernames=a,b,c`) ด้วยการหน่วง 20 มิลลิวินาที ซึ่งสั้นพอ
/// ที่ผู้ใช้ไม่รู้สึก แต่นานพอให้ทุกตัวใน render รอบเดียวกันมารวมกันทัน
const cache = new Map<string, ProfileSummary>();
const waiting = new Set<string>();
const listeners = new Set<() => void>();

let timer: ReturnType<typeof setTimeout> | null = null;

function scheduleFlush() {
  if (timer) return;

  timer = setTimeout(() => {
    timer = null;

    const batch = [...waiting].slice(0, 100);

    if (batch.length === 0) return;

    for (const name of batch) {
      waiting.delete(name);
    }

    void api
      .get<ProfileSummary[]>(
        `/profiles?usernames=${batch.map(encodeURIComponent).join(',')}`,
      )
      .then((rows) => {
        for (const row of rows) {
          cache.set(row.username, row);
        }

        for (const notify of listeners) {
          notify();
        }
      })
      .catch(() => {
        // ถ้าดึงไม่ได้ ปล่อยให้แสดง username ไปก่อน — ดีกว่าช่องว่าง
        for (const name of batch) {
          cache.set(name, {
            username: name,
            display_name: name,
            avatar_url: null,
            synced_at: null,
            badge: null,
          });
        }

        for (const notify of listeners) {
          notify();
        }
      });
  }, 20);
}

function useProfile(username: string): ProfileSummary {
  const [, force] = useState(0);

  useEffect(() => {
    if (cache.has(username)) return;

    waiting.add(username);
    scheduleFlush();

    const notify = () => force((n) => n + 1);

    listeners.add(notify);

    return () => {
      listeners.delete(notify);
    };
  }, [username]);

  return (
    cache.get(username) ?? {
      username,
      display_name: username,
      avatar_url: null,
      synced_at: null,
      badge: null,
    }
  );
}

/// ชื่อผู้ใช้ที่กดไปหน้าโปรไฟล์ได้
export function UserName({
  username,
  className = '',
}: {
  username: string;
  className?: string;
}) {
  const profile = useProfile(username);

  return (
    <Link
      href={`/profile/${encodeURIComponent(username)}`}
      className={`inline-flex items-center gap-1 font-medium hover:underline ${className}`}
      title={username}
    >
      {profile.display_name}
      <VerifiedBadge badge={profile.badge} className="size-3.5" />
    </Link>
  );
}

/// รูปโปรไฟล์ที่ดึงชื่อและ badge มาให้เอง
///
/// ห่อ UserAvatar เพื่อให้ที่เรียกไม่ต้องส่ง displayName/badge เอง —
/// hook แคชด้านบนรู้อยู่แล้วจากการแปลงชื่อเป็นชุด
export function Avatar({
  username,
  size = 36,
  showOnline = true,
}: {
  username: string;
  size?: number;
  showOnline?: boolean;
}) {
  const profile = useProfile(username);

  return (
    <UserAvatar
      username={username}
      displayName={profile.display_name}
      avatarUrl={profile.avatar_url}
      badge={profile.badge}
      size={size}
      showOnline={showOnline}
    />
  );
}
