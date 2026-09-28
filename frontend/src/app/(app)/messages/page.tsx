'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Socket } from 'socket.io-client';
import {
  ChevronDown,
  Info,
  Loader2,
  Phone,
  Search,
  Send,
  SquarePen,
  Users,
} from 'lucide-react';
import { UserAvatar } from '@/components/csmju/user-badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useCall } from '@/components/csmju/call-provider';
import { StoryRow } from '@/components/csmju/story-row';
import { UserName } from '@/components/csmju/user-name';
import { api, ApiError, qs } from '@/lib/csmju/api';
import { useMe } from '@/lib/csmju/session';
import { AttachmentList } from '@/components/csmju/attachment-list';
import {
  AttachmentButton,
  AttachmentTray,
  useAttachments,
} from '@/components/csmju/attachment-picker';
import {
  bindSocket,
  connectSocket,
  emitWithAck,
  forgetRoom,
  onSocketReconnect,
  onSocketStatus,
  rememberRoom,
} from '@/lib/csmju/socket';
import type { Channel, Message, SearchHit } from '@/lib/csmju/types';

/// ข้อความส่วนตัวแบบ Instagram
///
/// ต่างจากหน้า "ห้องแชท" (Discord/Teams) ที่เน้นห้องกลุ่มและเธรด — หน้านี้
/// เน้นการคุยหนึ่งต่อหนึ่ง จึงกรองเฉพาะห้องชนิด DM และจัดหน้าเป็นสองคอลัมน์
/// พร้อมสถานะว่างที่บอกทางต่อ (เหมือน "ข้อความของคุณ / ส่งข้อความ" ของ IG)
///
/// ใช้ endpoint ชุดเดียวกับห้องแชททั้งหมด — DM คือ Channel ที่ kind = 'DM'
/// จึงไม่มีโค้ดฝั่งหลังบ้านเพิ่มเลยสำหรับหน้านี้

type Tab = 'primary' | 'general' | 'requests';

const newNonce = () =>
  `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export default function MessagesPage() {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('primary');
  const [query, setQuery] = useState('');
  const me = useMe();
  const queryClient = useQueryClient();

  const threadsKey = ['channels', 'dm'] as const;

  const {
    data: threads = [],
    isPending: loading,
    error: queryError,
  } = useQuery({
    queryKey: threadsKey,
    queryFn: async () => {
      const page = await api.list<Channel>('/channels?limit=50');

      return page.items.filter((row) => row.kind === 'DM');
    },
  });

  const error = queryError
    ? queryError instanceof ApiError
      ? queryError.message
      : 'โหลดรายการข้อความไม่สำเร็จ — หลังบ้านรันอยู่ไหม'
    : null;

  function setThreads(update: (prev: Channel[]) => Channel[]) {
    queryClient.setQueryData<Channel[]>(threadsKey, (current) =>
      update(current ?? []),
    );
  }

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();

    // แท็บ "คำขอ" = คนที่เขาเริ่มคุยกับเราแต่เรายังไม่เคยตอบ
    // ตัดสินจาก unread_count > 0 และเรายังไม่เคยส่งอะไรในห้องนั้น —
    // ข้อมูลข้อนี้หลังบ้านยังไม่ได้ส่งมา จึงใช้ unread เป็นตัวแทนไปก่อน
    // TODO(PL): เสนอเพิ่ม `i_have_replied` ใน ChannelResponseDto
    const byTab = threads.filter((thread) => {
      if (tab === 'requests') return thread.unread_count > 0;
      if (tab === 'general') return thread.unread_count === 0;

      return true;
    });

    if (!term) return byTab;

    return byTab.filter((thread) =>
      (peerOf(thread, me.id) ?? 'แชทส่วนตัว').toLowerCase().includes(term),
    );
  }, [threads, tab, query, me.id]);

  const active = threads.find((thread) => thread.id === activeId) ?? null;

  return (
    <div className="flex h-[calc(100dvh-3.25rem)]">
      {/* คอลัมน์ซ้าย — รายการสนทนา */}
      <div
        className={`flex w-full shrink-0 flex-col border-r border-border bg-card md:w-[380px] ${
          active ? 'max-md:hidden' : ''
        }`}
      >
        <div className="flex items-center justify-between px-4 py-4">
          <button
            type="button"
            className="flex items-center gap-1.5 text-base font-semibold"
          >
            {me.id}
            <ChevronDown className="size-4 text-muted-foreground" />
          </button>

          <NewMessage
            onStarted={(channel) => {
              setThreads((prev) =>
                prev.some((row) => row.id === channel.id)
                  ? prev
                  : [channel, ...prev],
              );
              setActiveId(channel.id);
            }}
          />
        </div>

        <div className="flex gap-1 border-b border-border px-2">
          {(
            [
              ['primary', 'Primary'],
              ['general', 'General'],
              ['requests', 'คำขอ'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setTab(value)}
              className={`flex-1 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${
                tab === value
                  ? 'border-foreground text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="relative px-3 py-3">
          <Search className="pointer-events-none absolute left-6 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="ค้นหา"
            className="w-full rounded-lg border border-input bg-muted/50 py-2 pl-10 pr-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>

        {/* แถวสตอรี่ — เหมือน IG ที่มีสตอรี่อยู่บนรายการแชท */}
        <div className="border-b border-border px-3">
          <StoryRow />
        </div>

        <ScrollArea className="min-h-0 flex-1">
          {loading && (
            <p className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              กำลังโหลด…
            </p>
          )}

          {error && (
            <p className="px-4 py-6 text-sm text-destructive">{error}</p>
          )}

          {!loading && !error && filtered.length === 0 && (
            <p className="px-4 py-8 text-center text-sm leading-relaxed text-muted-foreground">
              {tab === 'requests'
                ? 'ไม่มีคำขอข้อความ'
                : 'ยังไม่มีบทสนทนา — กดไอคอนเขียนข้อความมุมขวาบนเพื่อเริ่ม'}
            </p>
          )}

          {filtered.map((thread) => {
            const peer = peerOf(thread, me.id) ?? 'แชทส่วนตัว';

            return (
              <button
                key={thread.id}
                type="button"
                onClick={() => setActiveId(thread.id)}
                className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-accent ${
                  thread.id === activeId ? 'bg-secondary/60' : ''
                }`}
              >
                <UserAvatar coreUserId={peer} size={56} />

                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {peer}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {thread.unread_count > 0
                      ? `${thread.unread_count} ข้อความใหม่`
                      : 'แตะเพื่อเปิดบทสนทนา'}
                  </span>
                </span>

                {thread.unread_count > 0 && (
                  <span className="size-2.5 shrink-0 rounded-full bg-primary" />
                )}
              </button>
            );
          })}
        </ScrollArea>
      </div>

      {/* คอลัมน์ขวา — บทสนทนา หรือสถานะว่าง */}
      {active ? (
        <Thread
          key={active.id}
          thread={active}
          onBack={() => setActiveId(null)}
          onRead={() =>
            setThreads((prev) =>
              prev.map((row) =>
                row.id === active.id ? { ...row, unread_count: 0 } : row,
              ),
            )
          }
        />
      ) : (
        <EmptyState />
      )}
    </div>
  );
}

/// คู่สนทนาของห้อง DM
///
/// **บั๊กที่ตัวนี้แก้: ปุ่มโทรในแชทส่วนตัวกดไม่ได้เลยสักห้อง**
///
/// ของเดิมเดาคู่สนทนาจาก `name` ของห้อง แต่ห้อง DM ถูกสร้างด้วย `name: null`
/// เสมอ ค่าจึงตกไปที่คำว่า "แชทส่วนตัว" ทุกครั้ง แล้วปุ่มโทรก็ถูกปิดใช้งาน
/// ด้วยเงื่อนไข `peer === 'แชทส่วนตัว'` — ผลคือฟีเจอร์โทรทั้งฟีเจอร์เข้าถึง
/// ไม่ได้จาก UI เลย ทั้งที่หลังบ้านกับ WebRTC ทำงานได้ปกติ
///
/// ตอนนี้หลังบ้านส่ง `peer_core_user_id` มาให้ตรง ๆ สำหรับห้อง DM
function peerOf(thread: Channel, myCoreUserId: string): string | null {
  if (thread.peer_core_user_id) {
    return thread.peer_core_user_id;
  }

  // ห้องรุ่นเก่าที่เคยตั้งชื่อไว้ยังอ่านได้ ไม่ถึงกับต้องทิ้ง
  if (thread.name && thread.name !== myCoreUserId) {
    return thread.name;
  }

  return null;
}

function EmptyState() {
  return (
    <div className="grid flex-1 place-items-center px-6 max-md:hidden">
      <div className="flex flex-col items-center text-center">
        <span className="grid size-24 place-items-center rounded-full border-2 border-foreground">
          <Send className="size-10 -rotate-12" strokeWidth={1.5} />
        </span>

        <h2 className="mt-5 text-xl font-light">ข้อความของคุณ</h2>
        <p className="mt-1.5 text-sm text-muted-foreground">
          ส่งรูปภาพและข้อความส่วนตัวให้กับเพื่อนหรือกลุ่ม
        </p>
      </div>
    </div>
  );
}

function NewMessage({
  onStarted,
}: {
  onStarted: (channel: Channel) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');

  /// ผลค้นหา **พร้อมคำค้นที่ใช้หามัน**
  ///
  /// เก็บคำค้นไว้ด้วยเพื่อให้รู้ว่าผลชุดนี้ตรงกับที่พิมพ์อยู่ตอนนี้หรือยัง —
  /// ทำให้คำนวณ "กำลังค้นหา" ได้จาก state ที่มีอยู่ ไม่ต้องมี useState แยก
  /// แล้วไปสั่ง setLoading ในตัว effect ซึ่งกฎ react-hooks ของ React Compiler
  /// ห้ามไว้ (setState ระหว่าง effect ทำให้เกิดการวาดซ้ำรอบพิเศษทุกครั้ง)
  const [results, setResults] = useState<{
    term: string;
    items: SearchHit[];
  } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const me = useMe();

  // ค้นคนจริงจาก `GET /search?kind=people`
  //
  // เดิมตรงนี้อ่านรายชื่อผู้ใช้สมมติที่ฮาร์ดโค้ดไว้ในโค้ดหน้าบ้าน ซึ่งแปลว่า
  // เริ่มแชทได้เฉพาะกับคนห้าคนที่เขียนไว้ และคนจริงที่ล็อกอินเข้ามาจะไม่โผล่
  // ในรายการเลย
  //
  // ค้นได้เฉพาะคนที่เคยปรากฏในระบบนี้ (ตาราง profile_cache) ไม่ใช่ทุกคนใน
  // มหาวิทยาลัย — Core Hub ยังไม่เปิด endpoint ค้นคนให้ระบบย่อยเรียก
  // (data-dictionary.md ข้อ 1.2: GET /api/v1/users/:id ต้องมี permission)
  const term = q.trim();
  const longEnough = term.length >= 2;

  useEffect(() => {
    if (!open || !longEnough) return;

    // หน่วงก่อนยิง ไม่งั้นพิมพ์ชื่อหนึ่งชื่อ = ยิงหลังบ้านทุกตัวอักษร
    //
    // ทุก setState อยู่ใน callback ของ timer ไม่ใช่ในตัว effect ตรง ๆ
    const timer = setTimeout(() => {
      void api
        .list<SearchHit>(`/search${qs({ q: term, kind: 'people', limit: 10 })}`)
        .then((page) => {
          setError(null);
          setResults({
            term,
            // ตัดตัวเองออก — เริ่มแชทกับตัวเองไม่ได้ และหลังบ้านก็ปฏิเสธอยู่แล้ว
            items: page.items.filter((hit) => hit.id !== me.id),
          });
        })
        .catch(() => {
          setError('ค้นหาไม่สำเร็จ');
          setResults({ term, items: [] });
        });
    }, 300);

    return () => clearTimeout(timer);
  }, [open, longEnough, term, me.id]);

  // คำนวณจาก state ที่มี ไม่เก็บซ้ำ — ผลที่ยังไม่ตรงกับคำที่พิมพ์อยู่
  // แปลว่ายังค้นไม่เสร็จ
  const fresh = results?.term === term;
  const loading = longEnough && !fresh;
  const people = fresh ? results.items : [];

  async function start(coreUserId: string) {
    setBusy(coreUserId);
    setError(null);

    try {
      // หลังบ้านหาห้องเดิมก่อนสร้างใหม่ จึงกดซ้ำไม่ได้ห้องซ้ำ
      const channel = await api.post<Channel>('/direct-channels', {
        peer_core_user_id: coreUserId,
      });

      onStarted(channel);
      setOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'เริ่มแชทไม่สำเร็จ');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="grid size-8 place-items-center rounded-lg transition-colors hover:bg-accent"
        aria-label="เขียนข้อความใหม่"
      >
        <SquarePen className="size-5" />
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-72 overflow-hidden rounded-lg border border-border bg-popover shadow-lg">
          <p className="border-b border-border px-3 py-2 text-sm font-medium">
            ข้อความใหม่
          </p>

          <div className="border-b border-border p-2">
            <label htmlFor="new-message-search" className="sr-only">
              ค้นหาคน
            </label>
            <input
              id="new-message-search"
              type="search"
              value={q}
              onChange={(event) => setQ(event.target.value)}
              placeholder="พิมพ์ชื่อเพื่อค้นหา"
              autoComplete="off"
              className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          {error && (
            <p className="px-3 py-2 text-xs text-destructive">{error}</p>
          )}

          {!error && loading && (
            <p className="px-3 py-4 text-sm text-muted-foreground">
              กำลังค้นหา…
            </p>
          )}

          {!error && !longEnough && (
            <p className="px-3 py-4 text-sm text-muted-foreground">
              พิมพ์อย่างน้อย 2 ตัวอักษร
            </p>
          )}

          {!error && !loading && longEnough && people.length === 0 && (
            <p className="px-3 py-4 text-sm leading-6 text-muted-foreground">
              ไม่พบใคร — ค้นได้เฉพาะคนที่เคยใช้งานระบบนี้แล้ว
            </p>
          )}

          {people.map((person) => (
            <button
              key={person.id}
              type="button"
              disabled={busy !== null}
              onClick={() => void start(person.id)}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-accent disabled:opacity-50"
            >
              <UserAvatar
                coreUserId={person.id}
                displayName={person.title}
                avatarUrl={null}
                badge={null}
                size={36}
              />

              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{person.title}</span>
                <span className="block truncate font-mono text-[11px] text-muted-foreground">
                  {person.id}
                </span>
              </span>

              {busy === person.id && (
                <Loader2 className="size-4 shrink-0 animate-spin" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Thread({
  thread,
  onBack,
  onRead,
}: {
  thread: Channel;
  onBack: () => void;
  onRead: () => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const attachments = useAttachments();
  const [typing, setTyping] = useState<string[]>([]);
  const [status, setStatus] = useState<'connecting' | 'live' | 'offline'>(
    'connecting',
  );
  const [error, setError] = useState<string | null>(null);

  const socketRef = useRef<Socket | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const me = useMe();
  const { startCall, inCall } = useCall();

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const history = await api.list<Message>(
          `/channels/${thread.id}/messages?limit=50`,
        );

        if (!cancelled) {
          setMessages([...history.items].reverse());
        }
      } catch (caught) {
        if (!cancelled) {
          setError(
            caught instanceof ApiError ? caught.message : 'โหลดข้อความไม่สำเร็จ',
          );
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [thread.id]);

  useEffect(() => {
    let cancelled = false;
    const unbind: (() => void)[] = [];
    const typingTimers = new Set<ReturnType<typeof setTimeout>>();

    void (async () => {
      try {
        const socket = await connectSocket();

        if (cancelled) return;

        socketRef.current = socket;

        const joined = await emitWithAck<{ ok: boolean; error?: string }>(
          socket,
          'channel:join',
          { channel_id: thread.id },
        );

        if (!joined.ok) {
          setStatus('offline');

          return;
        }

        setStatus('live');

        // จำห้องไว้ ไม่งั้นหลังเน็ตกระตุกจะ "ต่อแล้ว" แต่ไม่ได้อยู่ในห้อง
        // ของบทสนทนานี้ แล้วข้อความใหม่จะไม่เข้ามาอีกเลย
        rememberRoom(thread.id);

        unbind.push(
          bindSocket<Message>(socket, 'message:new', (message) => {
            if (message.channel_id !== thread.id) return;

            setMessages((prev) =>
              prev.some((row) => row.id === message.id)
                ? prev
                : [...prev, message],
            );
          }),
        );

        unbind.push(
          bindSocket<{ channel_id: string; coreUserId: string }>(
            socket,
            'typing:sync',
            (payload) => {
              if (payload.channel_id !== thread.id) return;

              setTyping((prev) =>
                prev.includes(payload.coreUserId)
                  ? prev
                  : [...prev, payload.coreUserId],
              );

              // เก็บตัวจับเวลาไว้ล้างตอนออกจากหน้า ไม่งั้นมันจะยิง setState
              // ของหน้าที่ปิดไปแล้ว
              const timer = setTimeout(() => {
                typingTimers.delete(timer);

                setTyping((prev) =>
                  prev.filter((name) => name !== payload.coreUserId),
                );
              }, 2500);

              typingTimers.add(timer);
            },
          ),
        );

        // สถานะมาจากชั้น socket กลาง ซึ่งรู้เรื่องการต่อใหม่ด้วย —
        // การฟัง 'disconnect' ดิบ ๆ บอกได้แค่ว่าหลุด ไม่รู้ว่ากลับมาแล้ว
        unbind.push(
          onSocketStatus((next) =>
            setStatus(
              next === 'connected'
                ? 'live'
                : next === 'offline'
                  ? 'offline'
                  : 'connecting',
            ),
          ),
        );

        // ต่อกลับมาแล้วดึงข้อความที่พลาดไประหว่างหลุด
        unbind.push(
          onSocketReconnect(() => {
            void api
              .list<Message>(`/channels/${thread.id}/messages?limit=50`)
              .then((history) => setMessages([...history.items].reverse()))
              .catch(() => undefined);
          }),
        );
      } catch {
        if (!cancelled) setStatus('offline');
      }
    })();

    return () => {
      cancelled = true;
      forgetRoom(thread.id);
      socketRef.current?.emit('channel:leave', { channel_id: thread.id });

      for (const timer of typingTimers) {
        clearTimeout(timer);
      }

      // ถอดเฉพาะ handler ของหน้าจอนี้
      //
      // เดิมเรียก socket.off('message:new') ซึ่งลบ handler ของ **ทุกคน**
      // ที่ฟัง event เดียวกันบน socket ที่แชร์กันทั้งแอป — ออกจากหน้านี้แล้ว
      // หน้าห้องแชทและสายเรียกเข้าจะเงียบไปด้วยโดยไม่มี error ให้เห็น
      for (const off of unbind) {
        off();
      }
    };
  }, [thread.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });

    const latest = messages.at(-1);

    if (!latest) return;

    void api
      .post(`/channels/${thread.id}/read-markers`, { seq: latest.seq })
      .then(onRead)
      .catch(() => undefined);
  }, [messages, thread.id, onRead]);

  async function send() {
    const content = draft.trim();
    const assetIds = attachments.assets.map((asset) => asset.asset_id);

    // ส่งไฟล์เปล่า ๆ โดยไม่มีข้อความได้ — คนส่งรูปอย่างเดียวบ่อยกว่าส่งรูป
    // พร้อมคำบรรยาย
    if (!content && assetIds.length === 0) return;

    // กันกดส่งระหว่างไฟล์ยังอัปไม่เสร็จ ไม่งั้นไฟล์นั้นจะหลุดไปเงียบ ๆ
    if (attachments.uploading) {
      setError('ยังอัปโหลดไฟล์ไม่เสร็จ — รอสักครู่');

      return;
    }

    const payload = {
      channel_id: thread.id,
      ...(content ? { content } : {}),
      ...(assetIds.length ? { asset_ids: assetIds } : {}),
      client_nonce: newNonce(),
    };

    setDraft('');
    attachments.clear();
    setError(null);

    try {
      const socket = socketRef.current;

      if (socket?.connected) {
        const result = await emitWithAck<{ ok: boolean; error?: string }>(
          socket,
          'message:send',
          payload,
        );

        if (!result.ok) {
          setError(result.error ?? 'ส่งไม่สำเร็จ');
          setDraft(content);
        }

        return;
      }

      const message = await api.post<Message>(
        `/channels/${thread.id}/messages`,
        payload,
      );

      setMessages((prev) =>
        prev.some((row) => row.id === message.id) ? prev : [...prev, message],
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'ส่งไม่สำเร็จ');
      setDraft(content);
    }
  }

  const peer = peerOf(thread, me.id);
  const peerLabel = peer ?? 'แชทส่วนตัว';

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="flex items-center gap-3 border-b border-border bg-card px-4 py-2.5">
        <button
          type="button"
          onClick={onBack}
          className="text-sm text-muted-foreground md:hidden"
        >
          ← กลับ
        </button>

        <UserAvatar coreUserId={peerLabel} size={36} />

        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">
            {peerLabel}
          </span>
          <span className="block text-[11px] text-muted-foreground">
            {status === 'live'
              ? 'เชื่อมต่อสด'
              : status === 'connecting'
                ? 'กำลังเชื่อมต่อ…'
                : 'ออฟไลน์ (ส่งผ่าน REST)'}
          </span>
        </span>

        <button
          type="button"
          onClick={() => peer && void startCall(thread.id, peer)}
          disabled={inCall || !peer}
          title={
            inCall
              ? 'อยู่ในสายอื่นอยู่'
              : peer
                ? `โทรหา ${peer}`
                : 'ห้องนี้ไม่มีคู่สนทนาให้โทรหา'
          }
          className="grid size-9 shrink-0 place-items-center rounded-lg border border-border transition-colors hover:bg-accent disabled:opacity-40"
          aria-label="โทรด้วยเสียง"
        >
          <Phone className="size-4" />
        </button>

        <span className="flex shrink-0 items-center gap-1 text-muted-foreground">
          <Users className="size-4" />
          <span className="text-xs tabular-nums">{thread.member_count}</span>
          <Info className="ml-1 size-4" />
        </span>
      </header>

      <ScrollArea className="min-h-0 flex-1 px-4 py-4">
        {messages.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            ยังไม่มีข้อความ — ส่งข้อความแรกได้เลย
          </p>
        )}

        <ul className="space-y-2">
          {messages.map((message) => {
            const mine = message.author_core_user_id === me.id;

            return (
              <li
                key={message.id}
                className={`flex ${mine ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  // เป็นคอลัมน์ ไม่ใช่ span ไหลตามบรรทัด — ในฟองหนึ่งฟองมีได้
                  // ทั้งชื่อผู้ส่ง ข้อความ ไฟล์แนบ และเวลา ซึ่งต้องเรียงลงมา
                  className={`flex max-w-[75%] flex-col rounded-3xl px-3.5 py-2 text-sm leading-relaxed ${
                    mine
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-foreground'
                  }`}
                >
                  {!mine && (
                    // ต้องห่อด้วยบล็อกจริง ไม่ใช่ส่ง class `block` เข้าไป —
                    // UserName ตั้ง `inline-flex` ไว้ในตัว แล้วลำดับของ
                    // Tailwind ทำให้ `inline-flex` ชนะ ชื่อกับข้อความจึงติดกัน
                    // เป็นบรรทัดเดียว ("user-002ข้อความ…")
                    <span className="mb-0.5 block">
                      <UserName
                        coreUserId={message.author_core_user_id}
                        className="text-[11px] opacity-70"
                      />
                    </span>
                  )}

                  {message.content && (
                    <span className="whitespace-pre-wrap break-words">
                      {message.content}
                    </span>
                  )}

                  <AttachmentList attachments={message.attachments} />

                  <span
                    className={`mt-0.5 block text-[10px] ${mine ? 'text-primary-foreground/60' : 'text-muted-foreground'}`}
                  >
                    {new Date(message.created_at).toLocaleTimeString('th-TH', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                    {message.edited_at ? ' · แก้ไขแล้ว' : ''}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>

        <div ref={bottomRef} />
      </ScrollArea>

      <div className="border-t border-border bg-card px-4 py-3">
        {typing.length > 0 && (
          <p className="mb-1 text-[11px] text-muted-foreground">
            {typing.join(', ')} กำลังพิมพ์…
          </p>
        )}

        {error && <p className="mb-1 text-xs text-destructive">{error}</p>}

        <AttachmentTray attachments={attachments} />

        <div className="flex items-center gap-1 rounded-full border border-input px-2 py-1.5">
          <AttachmentButton attachments={attachments} />

          <input
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              socketRef.current?.emit('typing:start', {
                channel_id: thread.id,
              });
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
            placeholder="ส่งข้อความ…"
            className="min-w-0 flex-1 bg-transparent py-1 text-sm outline-none"
          />

          <button
            type="button"
            disabled={
              (!draft.trim() && attachments.assets.length === 0) ||
              attachments.uploading
            }
            onClick={() => void send()}
            className="shrink-0 pr-2 text-sm font-semibold text-primary transition-opacity disabled:opacity-40"
          >
            ส่ง
          </button>
        </div>
      </div>
    </div>
  );
}
