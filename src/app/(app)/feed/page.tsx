'use client';

import { useCallback, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bookmark,
  BookmarkCheck,
  Loader2,
  MessageSquare,
  Send,
  Trash2,
} from 'lucide-react';
import { ReactionBar } from '@/components/csmju/reaction-bar';
import { StoryRow } from '@/components/csmju/story-row';
import { Avatar, UserName } from '@/components/csmju/user-name';
import { api, ApiError, qs } from '@/lib/csmju/api';
import { getIdentity } from '@/lib/csmju/identity';
import type {
  Bookmark as BookmarkRow,
  Post,
  PostComment,
  ReactionSummary,
} from '@/lib/csmju/types';

/// กระดานชุมชน — ตั้งกระทู้ กดอิโมจิ ตอบ และบันทึกไว้อ่านทีหลัง
///
/// เป็น Client Component ทั้งหน้าเพราะเนื้อหาขึ้นกับว่าใครเป็นผู้เรียก
/// (`reacted_by_me`, สิทธิ์ลบ, รายการที่บันทึกไว้) จึง prerender ล่วงหน้าไม่ได้

type Feed = 'all' | 'following';

export default function FeedPage() {
  const [feed, setFeed] = useState<Feed>('all');
  const [courseTag, setCourseTag] = useState('');
  const me = getIdentity();
  const queryClient = useQueryClient();

  // แท็บและแท็กวิชาเป็นส่วนหนึ่งของคีย์ — สลับกลับมาแท็บเดิมจึงเห็นของเดิม
  // ทันทีจากแคช แล้วค่อยอัปเดตเบื้องหลัง แทนที่จะจอขาวใหม่ทุกครั้ง
  const feedKey = ['feed', feed, courseTag.trim()] as const;

  const {
    data,
    isPending: loading,
    error: queryError,
  } = useQuery({
    queryKey: feedKey,
    queryFn: async () => {
      const [page, bookmarks] = await Promise.all([
        api.list<Post>(
          `/posts${qs({
            per_page: 20,
            feed: feed === 'following' ? 'following' : undefined,
            course_tag: courseTag.trim() || undefined,
          })}`,
        ),
        api.list<BookmarkRow>('/bookmarks?target_kind=POST&per_page=100'),
      ]);

      return {
        posts: page.items,
        saved: new Set(bookmarks.items.map((row) => row.target_id)),
      };
    },
  });

  const posts = data?.posts ?? [];
  const saved = data?.saved ?? new Set<string>();

  const error = queryError
    ? queryError instanceof ApiError
      ? queryError.message
      : 'โหลดกระดานไม่สำเร็จ — หลังบ้านรันอยู่ไหม (npm run start:dev ใน backend/)'
    : null;

  /// แก้ข้อมูลในแคชโดยตรง แทนการเก็บสำเนาไว้ใน state ของหน้าอีกชุด
  type FeedData = { posts: Post[]; saved: Set<string> };

  const patchFeed = useCallback(
    (update: (current: FeedData) => FeedData) => {
      queryClient.setQueryData<FeedData>(feedKey, (current) =>
        update(current ?? { posts: [], saved: new Set<string>() }),
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queryClient, feed, courseTag],
  );

  function setPosts(update: (prev: Post[]) => Post[]) {
    patchFeed((current) => ({ ...current, posts: update(current.posts) }));
  }

  function setSaved(update: (prev: Set<string>) => Set<string>) {
    patchFeed((current) => ({ ...current, saved: update(current.saved) }));
  }

  function patch(id: string, next: Partial<Post>) {
    setPosts((prev) =>
      prev.map((post) => (post.id === id ? { ...post, ...next } : post)),
    );
  }

  async function toggleSave(post: Post) {
    const isSaved = saved.has(post.id);

    if (isSaved) {
      await api.del(
        `/bookmarks${qs({ target_kind: 'POST', target_id: post.id })}`,
      );
      setSaved((prev) => {
        const next = new Set(prev);
        next.delete(post.id);
        return next;
      });
    } else {
      await api.post('/bookmarks', {
        target_kind: 'POST',
        target_id: post.id,
      });
      setSaved((prev) => new Set(prev).add(post.id));
    }
  }

  async function remove(post: Post) {
    await api.del(`/posts/${post.id}`);
    setPosts((prev) => prev.filter((row) => row.id !== post.id));
  }

  const canModerate = me.layer1Role === 'staff' || me.layer1Role === 'admin';

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <header className="mb-4">
        <h1 className="text-xl font-semibold">ฟีดชุมชน</h1>
        <p className="text-sm text-muted-foreground">
          กระดานถามตอบและประกาศของสาขา · แท็กตามรายวิชาได้
        </p>
      </header>

      <StoryRow />

      <Composer onCreated={(post) => setPosts((prev) => [post, ...prev])} />

      <div className="my-4 flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-border p-0.5">
          {(['all', 'following'] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setFeed(value)}
              className={`rounded-md px-3 py-1 text-sm transition-colors ${
                feed === value
                  ? 'bg-primary text-primary-foreground'
                  : 'hover:bg-accent'
              }`}
            >
              {value === 'all' ? 'ทั้งหมด' : 'คนที่ติดตาม'}
            </button>
          ))}
        </div>

        <input
          value={courseTag}
          onChange={(event) => setCourseTag(event.target.value.toUpperCase())}
          placeholder="กรองด้วยแท็กวิชา เช่น CS201"
          className="min-w-0 flex-1 rounded-lg border border-input bg-card px-3 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
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

      {!loading && !error && posts.length === 0 && (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {feed === 'following'
            ? 'ยังไม่มีกระทู้จากคนที่คุณติดตาม — ลองสลับไปแท็บ "ทั้งหมด"'
            : 'ยังไม่มีกระทู้ ตั้งกระทู้แรกได้เลย'}
        </p>
      )}

      <ul className="space-y-3">
        {posts.map((post) => (
          <li
            key={post.id}
            className="rounded-xl border border-border bg-card p-4"
          >
            <div className="flex items-start gap-3">
              <Avatar username={post.author_username} />

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <UserName username={post.author_username} />
                  <span className="text-xs text-muted-foreground">
                    {new Date(post.created_at).toLocaleString('th-TH')}
                  </span>
                  {post.course_tag && (
                    <span className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[11px] text-secondary-foreground">
                      {post.course_tag}
                    </span>
                  )}
                </div>

                <h2 className="mt-1 font-semibold leading-snug">
                  {post.title}
                </h2>
                <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">
                  {post.content}
                </p>
              </div>

              <div className="flex shrink-0 gap-1">
                <button
                  type="button"
                  onClick={() => void toggleSave(post)}
                  className="grid size-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent"
                  aria-label={saved.has(post.id) ? 'เอาออกจากที่บันทึก' : 'บันทึกไว้'}
                >
                  {saved.has(post.id) ? (
                    <BookmarkCheck className="size-4 text-primary" />
                  ) : (
                    <Bookmark className="size-4" />
                  )}
                </button>

                {(post.author_username === me.username || canModerate) && (
                  <button
                    type="button"
                    onClick={() => void remove(post)}
                    className="grid size-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                    aria-label="ลบกระทู้"
                  >
                    <Trash2 className="size-4" />
                  </button>
                )}
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-border pt-3">
              <ReactionBar
                targetKind="POST"
                targetId={post.id}
                summary={post.reactions}
                onChange={(next: ReactionSummary) =>
                  patch(post.id, { reactions: next })
                }
              />

              <Comments
                post={post}
                onCountChange={(count) => patch(post.id, { comment_count: count })}
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Composer({ onCreated }: { onCreated: (post: Post) => void }) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [tag, setTag] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);

    try {
      const post = await api.post<Post>('/posts', {
        title: title.trim(),
        content: content.trim(),
        // ส่งเฉพาะเมื่อกรอก — ValidationPipe ปฏิเสธ field ที่เป็นค่าว่าง
        ...(tag.trim() ? { course_tag: tag.trim().toUpperCase() } : {}),
      });

      onCreated(post);
      setTitle('');
      setContent('');
      setTag('');
    } catch (caught) {
      // ข้อความจากหลังบ้านอ่านรู้เรื่องแล้ว เช่น "แท็กวิชาต้องอยู่ในรูปแบบเช่น CS201"
      setError(caught instanceof Error ? caught.message : 'ตั้งกระทู้ไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <input
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="หัวข้อ เช่น ถามเรื่อง pointer ใน C ครับ"
        className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />

      <textarea
        value={content}
        onChange={(event) => setContent(event.target.value)}
        placeholder="เล่ารายละเอียด… พิมพ์ @ชื่อผู้ใช้ เพื่อเรียกถึงใครได้"
        rows={3}
        className="mt-2 w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          value={tag}
          onChange={(event) => setTag(event.target.value.toUpperCase())}
          placeholder="CS201"
          className="w-28 rounded-lg border border-input bg-background px-3 py-1.5 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />

        <button
          type="button"
          disabled={busy || !title.trim() || !content.trim()}
          onClick={() => void submit()}
          className="ml-auto flex items-center gap-1.5 rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {busy ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Send className="size-4" />
          )}
          ตั้งกระทู้
        </button>
      </div>

      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </div>
  );
}

function Comments({
  post,
  onCountChange,
}: {
  post: Post;
  onCountChange: (count: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<PostComment[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const me = getIdentity();

  async function toggle() {
    const next = !open;

    setOpen(next);

    if (next && items.length === 0) {
      const page = await api.list<PostComment>(
        `/posts/${post.id}/comments?per_page=50`,
      );

      setItems(page.items);
    }
  }

  async function send() {
    if (!draft.trim()) return;

    setBusy(true);

    try {
      const comment = await api.post<PostComment>(
        `/posts/${post.id}/comments`,
        { content: draft.trim() },
      );

      setItems((prev) => [...prev, comment]);
      onCountChange(post.comment_count + 1);
      setDraft('');
    } finally {
      setBusy(false);
    }
  }

  async function remove(comment: PostComment) {
    await api.del(`/posts/${post.id}/comments/${comment.id}`);
    setItems((prev) => prev.filter((row) => row.id !== comment.id));
    onCountChange(Math.max(0, post.comment_count - 1));
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void toggle()}
        className="flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <MessageSquare className="size-4" />
        <span className="tabular-nums">{post.comment_count}</span>
        ตอบกลับ
      </button>

      {open && (
        <div className="w-full space-y-2">
          {items.map((comment) => (
            <div
              key={comment.id}
              className="flex items-start gap-2 rounded-lg bg-muted/50 px-3 py-2"
            >
              <Avatar username={comment.author_username} size={24} />

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <UserName
                    username={comment.author_username}
                    className="text-sm"
                  />
                  <span className="text-[11px] text-muted-foreground">
                    {new Date(comment.created_at).toLocaleString('th-TH')}
                  </span>
                </div>
                <p className="whitespace-pre-wrap text-sm">{comment.content}</p>
              </div>

              {comment.author_username === me.username && (
                <button
                  type="button"
                  onClick={() => void remove(comment)}
                  className="text-muted-foreground transition-colors hover:text-destructive"
                  aria-label="ลบความคิดเห็น"
                >
                  <Trash2 className="size-3.5" />
                </button>
              )}
            </div>
          ))}

          <div className="flex gap-2">
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void send();
                }
              }}
              placeholder="ตอบกลับ…"
              className="min-w-0 flex-1 rounded-lg border border-input bg-background px-3 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />

            <button
              type="button"
              disabled={busy || !draft.trim()}
              onClick={() => void send()}
              className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
              aria-label="ส่ง"
            >
              <Send className="size-4" />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
