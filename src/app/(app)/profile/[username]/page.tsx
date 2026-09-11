'use client';

import { use, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, UserMinus, UserPlus } from 'lucide-react';
import { EditProfileDialog } from '@/components/csmju/edit-profile-dialog';
import { Avatar, UserName } from '@/components/csmju/user-name';
import { api, ApiError, qs } from '@/lib/csmju/api';
import { getIdentity } from '@/lib/csmju/identity';
import type {
  FollowEdge,
  MyProfile,
  Post,
  ProfileDetail,
  Reel,
  Relation,
} from '@/lib/csmju/types';

/// หน้าโปรไฟล์ — สถิติ ปุ่มติดตาม และผลงานของคนนั้น
///
/// `params` เป็น Promise ใน Next 16 จึงต้องแกะด้วย React `use()`
/// (เขียนแบบเดิม `params.username` จะได้ Promise ไม่ใช่ string)
///
/// ติดตามเป็นทิศทางเดียวแบบ Instagram ไม่ใช่ขอเป็นเพื่อนแบบ Facebook
/// ความเป็นเพื่อนสองทาง (`mutual`) คำนวณจากการมีทั้งสองด้าน จึงไม่มี
/// ขั้นตอน "กดตอบรับ" ให้ผู้ใช้ทำ

export default function ProfilePage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = use(params);
  const target = decodeURIComponent(username);

  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const me = getIdentity();
  const isMe = target === me.username;
  const queryClient = useQueryClient();

  const profileKey = ['profile', target] as const;

  /// แยก `mine` ออกจาก `profile` แทนการยัดเป็นยูเนียนแล้วแคบด้วย `in`
  ///
  /// `MyProfile` สืบทอดจาก `ProfileDetail` TypeScript จึงยุบยูเนียน
  /// `ProfileDetail | MyProfile` เหลือ `ProfileDetail` ตัวเดียว แล้วการแคบชนิด
  /// ด้วย `'cover_url' in profile` ก็ได้ `unknown` กลับมาแทนค่าจริง
  ///
  /// `isMe` บอกอยู่แล้วว่าเป็นโปรไฟล์ของใคร จึงตรงกว่าที่จะแยกฟิลด์ไปเลย
  type ProfileData = {
    profile: ProfileDetail;
    mine: MyProfile | null;
    posts: Post[];
    reels: Reel[];
    followers: FollowEdge[];
  };

  const { data, error: queryError } = useQuery({
    queryKey: profileKey,
    queryFn: async (): Promise<ProfileData> => {
      const [detail, postPage, reelPage, followerPage] = await Promise.all([
        // /profiles/me คืน MyProfile ที่มี bio, cover_url และ managed_by_core
        // เพิ่มมา — ของคนอื่นคืน ProfileDetail เฉย ๆ
        isMe
          ? api.get<MyProfile>('/profiles/me')
          : api.get<ProfileDetail>(`/profiles/${encodeURIComponent(target)}`),
        api.list<Post>(`/posts${qs({ author_username: target, per_page: 10 })}`),
        api.list<Reel>(`/reels${qs({ author_username: target, per_page: 10 })}`),
        api.list<FollowEdge>(
          `/profiles/${encodeURIComponent(target)}/followers?per_page=12`,
        ),
      ]);

      return {
        profile: detail,
        mine: isMe ? (detail as MyProfile) : null,
        posts: postPage.items,
        reels: reelPage.items,
        followers: followerPage.items,
      };
    },
  });

  const profile = data?.profile ?? null;
  const mine = data?.mine ?? null;
  const posts = data?.posts ?? [];
  const reels = data?.reels ?? [];
  const followers = data?.followers ?? [];

  const error =
    actionError ??
    (queryError
      ? queryError instanceof ApiError
        ? queryError.message
        : 'โหลดโปรไฟล์ไม่สำเร็จ'
      : null);

  /// เขียนโปรไฟล์ลงแคชโดยตรง — ใช้ตอนกดติดตามและตอนแก้โปรไฟล์เสร็จ
  function setProfile(next: ProfileDetail | MyProfile) {
    queryClient.setQueryData<ProfileData>(profileKey, (current) =>
      current
        ? {
            ...current,
            profile: next,
            mine: current.mine ? (next as MyProfile) : null,
          }
        : current,
    );
  }

  async function toggleFollow() {
    if (!profile) return;

    setBusy(true);
    setActionError(null);

    try {
      const relation = profile.relation.following
        ? await api.del<Relation>(`/follows/${encodeURIComponent(target)}`)
        : await api.post<Relation>('/follows', { username: target });

      setProfile({
        ...profile,
        relation,
        stats: {
          ...profile.stats,
          follower_count:
            profile.stats.follower_count +
            (relation.following ? 1 : -1) *
              (relation.following === profile.relation.following ? 0 : 1),
        },
      });
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : 'ทำรายการไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-6">
        <p className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-6">
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          กำลังโหลด…
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      {mine?.cover_url && (
        <div className="mb-3 h-32 overflow-hidden rounded-xl border border-border">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={mine.cover_url}
            alt="รูปปกโปรไฟล์"
            className="size-full object-cover"
          />
        </div>
      )}

      <header className="flex flex-wrap items-start gap-4 rounded-xl border border-border bg-card p-4">
        <Avatar username={profile.username} size={64} />

        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold">
            {profile.display_name}
          </h1>
          <p className="truncate font-mono text-xs text-muted-foreground">
            {profile.username}
          </p>

          {profile.synced_at === null && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              ยังไม่เคยซิงก์ชื่อจริงจาก Core — แสดง username ไปก่อน
            </p>
          )}

          {isMe && profile.layer2_role && (
            <p className="mt-1 text-xs">
              สิทธิ์ในระบบนี้:{' '}
              <span className="rounded bg-secondary px-1.5 py-0.5 font-mono text-secondary-foreground">
                {profile.layer2_role}
              </span>
            </p>
          )}

          {mine?.bio && (
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">
              {mine.bio}
            </p>
          )}
        </div>

        {isMe && mine && (
          <EditProfileDialog
            profile={mine}
            onSaved={(next) => setProfile(next)}
          />
        )}

        {!isMe && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void toggleFollow()}
            className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-40 ${
              profile.relation.following
                ? 'border border-border hover:bg-accent'
                : 'bg-primary text-primary-foreground'
            }`}
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : profile.relation.following ? (
              <UserMinus className="size-4" />
            ) : (
              <UserPlus className="size-4" />
            )}
            {profile.relation.mutual
              ? 'ติดตามกันอยู่'
              : profile.relation.following
                ? 'เลิกติดตาม'
                : profile.relation.followed_by
                  ? 'ติดตามกลับ'
                  : 'ติดตาม'}
          </button>
        )}
      </header>

      <dl className="mt-3 grid grid-cols-4 gap-2">
        {[
          { label: 'กระทู้', value: profile.stats.post_count },
          { label: 'คลิป', value: profile.stats.reel_count },
          { label: 'ผู้ติดตาม', value: profile.stats.follower_count },
          { label: 'กำลังติดตาม', value: profile.stats.following_count },
        ].map((stat) => (
          <div
            key={stat.label}
            className="rounded-xl border border-border bg-card px-3 py-2 text-center"
          >
            <dd className="text-lg font-semibold tabular-nums">{stat.value}</dd>
            <dt className="text-[11px] text-muted-foreground">{stat.label}</dt>
          </div>
        ))}
      </dl>

      {followers.length > 0 && (
        <section className="mt-4">
          <h2 className="mb-2 text-sm font-semibold">ผู้ติดตาม</h2>
          <ul className="flex flex-wrap gap-2">
            {followers.map((edge) => (
              <li
                key={edge.username}
                className="flex items-center gap-1.5 rounded-full border border-border bg-card px-2 py-1"
              >
                <Avatar username={edge.username} size={20} />
                <UserName username={edge.username} className="text-xs" />
              </li>
            ))}
          </ul>
        </section>
      )}

      {reels.length > 0 && (
        <section className="mt-4">
          <h2 className="mb-2 text-sm font-semibold">คลิป</h2>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {reels.map((reel) => (
              <li
                key={reel.id}
                className="rounded-xl border border-border bg-card p-3"
              >
                <p className="truncate text-sm font-medium">{reel.title}</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  ❤ {reel.like_count} · 👁 {reel.view_count}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {posts.length > 0 && (
        <section className="mt-4">
          <h2 className="mb-2 text-sm font-semibold">กระทู้</h2>
          <ul className="space-y-2">
            {posts.map((post) => (
              <li
                key={post.id}
                className="rounded-xl border border-border bg-card p-3"
              >
                <p className="font-medium leading-snug">{post.title}</p>
                <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">
                  {post.content}
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {post.course_tag ? `${post.course_tag} · ` : ''}
                  {post.comment_count} ความคิดเห็น
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {posts.length === 0 && reels.length === 0 && (
        <p className="py-8 text-center text-sm text-muted-foreground">
          ยังไม่มีผลงานในระบบนี้
        </p>
      )}
    </div>
  );
}
