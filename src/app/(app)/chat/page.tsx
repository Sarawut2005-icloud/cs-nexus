'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Socket } from 'socket.io-client';
import {
  ChevronLeft,
  Hash,
  Loader2,
  MessagesSquare,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Send,
  Trash2,
  Users,
  Volume2,
} from 'lucide-react';
import { AnimatedTooltip } from '@/components/ui/animated-tooltip';
import { ReactionBar } from '@/components/csmju/reaction-bar';
import { Avatar, UserName } from '@/components/csmju/user-name';
import { api, ApiError, qs } from '@/lib/csmju/api';
import { getIdentity } from '@/lib/csmju/identity';
import {
  bindSocket,
  connectSocket,
  emitWithAck,
  forgetRoom,
  onSocketReconnect,
  onSocketStatus,
  rememberRoom,
} from '@/lib/csmju/socket';
import type {
  Channel,
  ChannelKind,
  Message,
  ReactionSummary,
} from '@/lib/csmju/types';

const KIND_ICON: Record<ChannelKind, typeof Hash> = {
  DM: MessagesSquare,
  GROUP: Users,
  COURSE: Hash,
  VOICE: Volume2,
};

/// สร้าง nonce ของฝั่ง client — ใช้กันส่งซ้ำตอนเน็ตกระตุก
///
/// หลังบ้านมี unique(channelId, author, clientNonce) ถ้าเน็ตหลุดแล้ว client
/// เอาข้อความจริงจากเซิร์ฟเวอร์ไปแทนที่ตัวชั่วคราวที่ nonce ตรงกัน
///
/// ต้องจับคู่ด้วย `client_nonce` ไม่ใช่ `id` เพราะตัวชั่วคราวยังไม่มี id จริง
/// ถ้าไม่จับคู่ ข้อความจะขึ้นสองอัน: ตัวที่เราวาดเองกับตัวที่เซิร์ฟเวอร์ส่งมา
///
/// กันซ้ำด้วย id ต่อท้ายอีกชั้น เพราะคนส่งเองจะได้ทั้ง ack และ broadcast
export function replacePending(current: Message[], incoming: Message): Message[] {
  const byNonce = current.findIndex(
    (row) => row.client_nonce === incoming.client_nonce,
  );

  if (byNonce !== -1) {
    const next = [...current];

    next[byNonce] = incoming;

    return next;
  }

  return current.some((row) => row.id === incoming.id)
    ? current
    : [...current, incoming];
}

/// ส่งซ้ำด้วย nonce เดิม จะได้ข้อความเดิมกลับมา ไม่ใช่ข้อความใหม่สองอัน
const newNonce = () =>
  `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export default function ChatPage() {
  // เปิดห้องที่ระบุมาทาง URL ได้ — การแจ้งเตือนพามาที่ห้องที่ถูกต้องเลย
  // ไม่ใช่พามาหน้ารวมแล้วปล่อยให้ผู้ใช้ไปหาเอง
  const requestedChannel = useSearchParams().get('channel');
  const [pickedId, setPickedId] = useState<string | null>(requestedChannel);
  const queryClient = useQueryClient();

  const channelsKey = ['channels', 'mine'] as const;

  const {
    data: channels = [],
    isPending: loading,
    error: queryError,
  } = useQuery({
    queryKey: channelsKey,
    queryFn: async () => {
      const page = await api.list<Channel>('/channels?per_page=50');

      return page.items;
    },
  });

  const error = queryError
    ? queryError instanceof ApiError
      ? queryError.message
      : 'โหลดรายการห้องไม่สำเร็จ — หลังบ้านรันอยู่ไหม'
    : null;

  // ห้องที่เปิดอยู่ = ที่ผู้ใช้เลือก ถ้ายังไม่เลือกก็ห้องแรกในรายการ
  //
  // คิดตอน render แทนการ setState ในเอฟเฟกต์หลังโหลดเสร็จ — แบบเดิมวาด
  // หนึ่งรอบโดยยังไม่มีห้องไหนเปิด แล้วค่อยวาดซ้ำเพื่อเลือกห้องแรกให้
  const activeId = pickedId ?? channels[0]?.id ?? null;

  function setActiveId(id: string) {
    setPickedId(id);
  }

  function setChannels(update: (prev: Channel[]) => Channel[]) {
    queryClient.setQueryData<Channel[]>(channelsKey, (current) =>
      update(current ?? []),
    );
  }

  /// มือถือแสดงทีละแผง — จอกว้างไม่ใช้ค่านี้เลย
  const [mobilePane, setMobilePane] = useState<'list' | 'room'>('list');

  const active = channels.find((channel) => channel.id === activeId) ?? null;

  return (
    <div className="flex h-[calc(100dvh-3.25rem)]">
      {/* จอกว้างเห็นสองคอลัมน์พร้อมกัน · จอแคบเห็นทีละอัน
        *
        * เดิมรายการห้องเป็น `max-md:hidden` เฉย ๆ โดยไม่มีอะไรมาแทน
        * บนมือถือจึงเปิดมาติดอยู่ห้องแรกที่ระบบเลือกให้ แล้วสลับห้องไม่ได้เลย
        * ทั้งที่เป็นสมาชิกอยู่หลายห้อง */}
      <div
        className={`flex w-64 shrink-0 flex-col border-r border-border bg-card max-md:w-full max-md:border-r-0 ${
          mobilePane === 'room' ? 'max-md:hidden' : ''
        }`}
      >
        <div className="flex items-center justify-between px-3 py-3">
          <h2 className="text-sm font-semibold">ห้องของฉัน</h2>
          <CreateChannel
            onCreated={(channel) => {
              setChannels((prev) => [channel, ...prev]);
              setActiveId(channel.id);
              setMobilePane('room');
            }}
          />
        </div>

        <div className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
          {loading && (
            <p className="px-2 py-4 text-sm text-muted-foreground">
              กำลังโหลด…
            </p>
          )}

          {error && (
            <p className="px-2 py-4 text-sm text-destructive">{error}</p>
          )}

          {!loading && channels.length === 0 && (
            <p className="px-2 py-4 text-sm leading-relaxed text-muted-foreground">
              ยังไม่ได้อยู่ห้องไหน — กดปุ่ม + เพื่อสร้างห้องกลุ่ม
            </p>
          )}

          {channels.map((channel) => {
            const Icon = KIND_ICON[channel.kind];

            return (
              <button
                key={channel.id}
                type="button"
                onClick={() => {
                  setActiveId(channel.id);
                  setMobilePane('room');
                }}
                className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors ${
                  channel.id === activeId
                    ? 'bg-secondary text-secondary-foreground'
                    : 'hover:bg-accent'
                }`}
              >
                <Icon className="size-4 shrink-0 text-muted-foreground" />

                <span className="min-w-0 flex-1 truncate">
                  {channel.name ?? 'แชทส่วนตัว'}
                </span>

                {channel.unread_count > 0 && (
                  <span className="shrink-0 rounded-full bg-destructive px-1.5 text-[10px] font-semibold leading-4 text-white tabular-nums">
                    {channel.unread_count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {active ? (
        <ChannelView
          key={active.id}
          channel={active}
          hiddenOnMobile={mobilePane === 'list'}
          onBack={() => setMobilePane('list')}
          onRead={() =>
            setChannels((prev) =>
              prev.map((row) =>
                row.id === active.id ? { ...row, unread_count: 0 } : row,
              ),
            )
          }
        />
      ) : (
        <div className="grid flex-1 place-items-center px-6 text-center text-sm text-muted-foreground max-md:hidden">
          เลือกห้องจากรายการด้านซ้าย หรือสร้างห้องใหม่
        </div>
      )}
    </div>
  );
}

function CreateChannel({
  onCreated,
}: {
  onCreated: (channel: Channel) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<ChannelKind>('GROUP');
  const [courseTag, setCourseTag] = useState('');
  const [error, setError] = useState<string | null>(null);
  const me = getIdentity();

  async function submit() {
    setError(null);

    try {
      const channel = await api.post<Channel>('/channels', {
        kind,
        name: name.trim(),
        ...(kind === 'COURSE' && courseTag.trim()
          ? { course_tag: courseTag.trim().toUpperCase() }
          : {}),
      });

      onCreated(channel);
      setOpen(false);
      setName('');
      setCourseTag('');
    } catch (caught) {
      // เช่น "ห้องประจำวิชาสร้างได้เฉพาะอาจารย์และบุคลากร"
      setError(caught instanceof Error ? caught.message : 'สร้างห้องไม่สำเร็จ');
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="grid size-7 place-items-center rounded-lg border border-border transition-colors hover:bg-accent"
        aria-label="สร้างห้องใหม่"
      >
        <Plus className="size-4" />
      </button>

      {open && (
        <div className="absolute left-0 z-50 mt-2 w-64 space-y-2 rounded-lg border border-border bg-popover p-3 shadow-lg">
          <select
            value={kind}
            onChange={(event) => setKind(event.target.value as ChannelKind)}
            className="w-full rounded-lg border border-input bg-background px-2 py-1.5 text-sm"
          >
            <option value="GROUP">ห้องกลุ่ม</option>
            <option value="COURSE">
              ห้องประจำวิชา {me.layer1Role === 'student' ? '(ต้องเป็นอาจารย์)' : ''}
            </option>
            <option value="VOICE">ห้องเสียง</option>
          </select>

          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="ชื่อห้อง"
            className="w-full rounded-lg border border-input bg-background px-2 py-1.5 text-sm"
          />

          {kind === 'COURSE' && (
            <input
              value={courseTag}
              onChange={(event) => setCourseTag(event.target.value.toUpperCase())}
              placeholder="CS201"
              className="w-full rounded-lg border border-input bg-background px-2 py-1.5 font-mono text-sm"
            />
          )}

          {error && <p className="text-xs text-destructive">{error}</p>}

          <button
            type="button"
            disabled={!name.trim()}
            onClick={() => void submit()}
            className="w-full rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-40"
          >
            สร้าง
          </button>
        </div>
      )}
    </div>
  );
}

function ChannelView({
  channel,
  onRead,
  hiddenOnMobile = false,
  onBack,
}: {
  channel: Channel;
  onRead: () => void;
  /// จอแคบกำลังดูรายการห้องอยู่ จึงต้องซ่อนแผงนี้
  hiddenOnMobile?: boolean;
  onBack?: () => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [pinned, setPinned] = useState<Message[]>([]);
  const [online, setOnline] = useState<string[]>([]);
  const [typing, setTyping] = useState<string[]>([]);
  const [reactions, setReactions] = useState<
    Record<string, ReactionSummary | null>
  >({});
  const [threadOf, setThreadOf] = useState<Message | null>(null);
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState<'connecting' | 'live' | 'offline'>(
    'connecting',
  );
  const [error, setError] = useState<string | null>(null);

  const socketRef = useRef<Socket | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const me = getIdentity();

  // โหลดประวัติ + รายการปักหมุด
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const [history, pins] = await Promise.all([
          api.list<Message>(`/channels/${channel.id}/messages?per_page=50`),
          api.list<Message>(`/channels/${channel.id}/messages/pinned`),
        ]);

        if (cancelled) return;

        // หลังบ้านคืนใหม่ไปเก่าเพื่อให้โหลดหน้าล่าสุดก่อน — กลับด้านให้อ่านตามเวลา
        setMessages([...history.items].reverse());
        setPinned(pins.items);
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
  }, [channel.id]);

  // ต่อ socket และเข้าห้อง
  useEffect(() => {
    let cancelled = false;
    const unbind: (() => void)[] = [];

    void (async () => {
      try {
        const socket = await connectSocket();

        if (cancelled) return;

        socketRef.current = socket;

        const result = await emitWithAck<{ ok: boolean; error?: string }>(
          socket,
          'channel:join',
          { channel_id: channel.id },
        );

        if (!result.ok) {
          setStatus('offline');
          setError(result.error ?? 'เข้าห้องไม่สำเร็จ');

          return;
        }

        setStatus('live');

        rememberRoom(channel.id);

        unbind.push(
          bindSocket<Message>(socket, 'message:new', (message) => {
            if (message.channel_id !== channel.id) return;

            // แทนที่ตัวชั่วคราวของเราถ้ามี ไม่งั้นต่อท้ายตามปกติ
            setMessages((prev) => replacePending(prev, message));
          }),
        );

        unbind.push(
          bindSocket<{ channel_id: string; message_id: string }>(
            socket,
            'message:deleted',
            (payload) => {
              if (payload.channel_id !== channel.id) return;

              setMessages((prev) =>
                prev.filter((row) => row.id !== payload.message_id),
              );
            },
          ),
        );

        unbind.push(
          bindSocket<Message>(socket, 'message:edited', (message) => {
            if (message.channel_id !== channel.id) return;

            setMessages((prev) =>
              prev.map((row) => (row.id === message.id ? message : row)),
            );
          }),
        );

        unbind.push(
          bindSocket<Message>(socket, 'message:pinned', (message) => {
            if (message.channel_id !== channel.id) return;

            setMessages((prev) =>
              prev.map((row) => (row.id === message.id ? message : row)),
            );
            setPinned((prev) =>
              message.pinned_at
                ? [message, ...prev.filter((row) => row.id !== message.id)]
                : prev.filter((row) => row.id !== message.id),
            );
          }),
        );

        unbind.push(
          bindSocket<ReactionSummary & { channel_id: string }>(
            socket,
            'reaction:changed',
            (payload) => {
              if (payload.channel_id !== channel.id) return;

              setReactions((prev) => ({
                ...prev,
                [payload.target_id]: payload,
              }));
            },
          ),
        );

        unbind.push(
          bindSocket<{ channel_id: string; online_usernames: string[] }>(
            socket,
            'presence:sync',
            (payload) => {
              if (payload.channel_id !== channel.id) return;

              setOnline(payload.online_usernames);
            },
          ),
        );

        unbind.push(
          bindSocket<{ channel_id: string; username: string }>(
            socket,
            'typing:sync',
            (payload) => {
              if (payload.channel_id !== channel.id) return;

              setTyping((prev) =>
                prev.includes(payload.username)
                  ? prev
                  : [...prev, payload.username],
              );

              setTimeout(
                () =>
                  setTyping((prev) =>
                    prev.filter((name) => name !== payload.username),
                  ),
                2500,
              );
            },
          ),
        );

        // สถานะการเชื่อมต่อมาจากชั้น socket กลาง ซึ่งรู้เรื่องการต่อใหม่ด้วย
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

        // ต่อกลับมาได้แล้วให้ดึงข้อความที่พลาดไประหว่างหลุด
        unbind.push(
          onSocketReconnect(() => {
            void api
              .list<Message>(`/channels/${channel.id}/messages?per_page=50`)
              .then((history) => setMessages([...history.items].reverse()))
              .catch(() => undefined);
          }),
        );
      } catch {
        if (!cancelled) {
          setStatus('offline');
        }
      }
    })();

    return () => {
      cancelled = true;
      forgetRoom(channel.id);
      socketRef.current?.emit('channel:leave', { channel_id: channel.id });

      // ถอดเฉพาะ handler ของหน้าจอนี้
      //
      // เดิมเรียก socket.off(event) ซึ่งลบ handler ของ **ทุกคน** ที่ฟัง
      // event เดียวกันบน socket ที่แชร์กันทั้งแอป — ออกจากหน้านี้แล้ว
      // CallProvider จะหยุดรับสายเรียกเข้าโดยไม่มี error ให้เห็น
      for (const off of unbind) {
        off();
      }
    };
  }, [channel.id]);

  // เลื่อนลงล่างเมื่อมีข้อความใหม่ และรายงานว่าอ่านถึงไหนแล้ว
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });

    const latest = messages.at(-1);

    if (!latest) return;

    // เส้นทางคือ POST /channels/{id}/read-markers ไม่ใช่ PATCH /read
    // (มาตรฐานหน้า 7 บังคับให้ URL เป็นคำนามพหูพจน์ จึงเป็น "read-markers")
    void api
      .post(`/channels/${channel.id}/read-markers`, { seq: latest.seq })
      .then(onRead)
      .catch(() => {
        // อัปเดตตัวชี้การอ่านพลาดไม่ใช่เรื่องใหญ่ — badge จะถูกต้องรอบหน้า
      });
  }, [messages, channel.id, onRead]);

  // โหลดยอดรีแอ็กชันของข้อความที่แสดงอยู่ ครั้งเดียวต่อชุด
  useEffect(() => {
    const missing = messages
      .filter((message) => reactions[message.id] === undefined)
      .slice(-30);

    if (missing.length === 0) return;

    // คำขอเดียวสำหรับทุกข้อความในหน้าจอ — เดิมยิงทีละข้อความ
    // สามสิบข้อความ = สามสิบ round trip ซึ่งบนเน็ตจริงคือการรอที่รู้สึกได้
    void api
      .get<ReactionSummary[]>(
        `/reactions/summaries${qs({
          target_kind: 'MESSAGE',
          target_ids: missing.map((message) => message.id).join(','),
        })}`,
      )
      .then((summaries) => {
        setReactions((prev) => {
          const next = { ...prev };

          // เขียนทุก id ที่ขอไป ไม่ใช่แค่ที่มีผลลัพธ์ ไม่งั้น id ที่ยังไม่มี
          // ใครกดจะค้างเป็น undefined แล้ว effect จะขอซ้ำทุกครั้งที่ render
          for (const message of missing) {
            next[message.id] =
              summaries.find((row) => row.target_id === message.id) ?? null;
          }

          return next;
        });
      })
      .catch(() => {
        setReactions((prev) => {
          const next = { ...prev };

          for (const message of missing) {
            next[message.id] = null;
          }

          return next;
        });
      });
  }, [messages, reactions]);

  /// ส่งข้อความแบบให้เห็นทันที ไม่ต้องรอเซิร์ฟเวอร์
  ///
  /// เดิมข้อความจะโผล่ก็ต่อเมื่อเซิร์ฟเวอร์ broadcast กลับมา ผู้ใช้จึงพิมพ์เสร็จ
  /// กด Enter แล้วเห็นช่องว่างเปล่า ๆ จนกว่าจะวิ่งไปกลับเสร็จ บนเน็ตช้าหรือ
  /// ตอนเซิร์ฟเวอร์เพิ่งตื่นจากการหลับ (ชั้นใช้ฟรี) อาจนานหลายวินาที —
  /// ซึ่งผู้ใช้ตีความว่า "แอปค้าง" แล้วกดส่งซ้ำ
  ///
  /// วิธีจับคู่: `client_nonce` ที่เราสร้างเองเป็นกุญแจที่เดินทางไปกับข้อความ
  /// และกลับมากับ broadcast ด้วย (หลังบ้านใช้มันกันส่งซ้ำอยู่แล้ว) พอของจริง
  /// กลับมาก็เอาไปแทนที่ตัวชั่วคราวที่ nonce ตรงกัน จึงไม่มีทางขึ้นซ้ำสองอัน
  async function send() {
    const content = draft.trim();

    if (!content) return;

    const socket = socketRef.current;
    const nonce = newNonce();
    const payload = {
      channel_id: channel.id,
      content,
      client_nonce: nonce,
      ...(threadOf ? { parent_id: threadOf.id } : {}),
    };

    // ใส่ลงไทม์ไลน์ก่อนเลย แล้วค่อยส่งจริง
    const pending: Message = {
      id: `pending-${nonce}`,
      seq: Number.MAX_SAFE_INTEGER, // ให้อยู่ท้ายสุดเสมอจนกว่าของจริงจะมา
      client_nonce: nonce,
      content,
      channel_id: channel.id,
      author_username: me.username,
      parent_id: threadOf?.id ?? null,
      reply_count: 0,
      pinned_at: null,
      pinned_by_username: null,
      edited_at: null,
      attachments: [],
      embed: null,
      created_at: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, pending]);
    setDraft('');
    setError(null);

    const dropPending = () =>
      setMessages((prev) => prev.filter((row) => row.id !== pending.id));

    try {
      if (socket?.connected) {
        const result = await emitWithAck<{ ok: boolean; error?: string }>(
          socket,
          'message:send',
          payload,
        );

        if (!result.ok) {
          setError(result.error ?? 'ส่งไม่สำเร็จ');
          setDraft(content);
          dropPending();
        }

        return;
      }

      // socket ต่อไม่ได้ก็ยังส่งได้ทาง REST — หลังบ้านเปิดไว้ให้เป็นทางสำรอง
      const message = await api.post<Message>(
        `/channels/${channel.id}/messages`,
        payload,
      );

      setMessages((prev) => replacePending(prev, message));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'ส่งไม่สำเร็จ');
      setDraft(content);
      dropPending();
    }
  }

  function notifyTyping() {
    socketRef.current?.emit('typing:start', { channel_id: channel.id });
  }

  const timeline = useMemo(
    () => messages.filter((message) => message.parent_id === null),
    [messages],
  );

  const canPin =
    channel.my_role === 'MODERATOR' ||
    me.layer1Role === 'staff' ||
    me.layer1Role === 'admin';

  return (
    <div
      className={`flex min-w-0 flex-1 ${hiddenOnMobile ? 'max-md:hidden' : ''}`}
    >
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-border bg-card px-4 py-2.5">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="-ml-1 shrink-0 rounded-lg p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground md:hidden"
              aria-label="กลับไปที่รายการห้อง"
            >
              <ChevronLeft className="size-5" />
            </button>
          )}

          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-semibold">
              {channel.name ?? 'แชทส่วนตัว'}
            </h2>
            <p className="truncate text-[11px] text-muted-foreground">
              {channel.member_count} สมาชิก · ออนไลน์ {online.length} คน
              {channel.course_tag ? ` · ${channel.course_tag}` : ''}
            </p>
          </div>

          {/* กองรูปคนที่ออนไลน์ในห้อง — ชี้แล้วขึ้นชื่อ
              ประหยัดพื้นที่กว่ารายชื่อ ซึ่งบนหัวห้องมีที่ไม่พอ */}
          {online.length > 0 && (
            <span className="mr-1 shrink-0 max-sm:hidden">
              <AnimatedTooltip
                size={28}
                max={5}
                items={online.map((username) => ({
                  id: username,
                  name: username,
                  designation: 'อยู่ในห้องนี้',
                  online: true,
                }))}
              />
            </span>
          )}

          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
              status === 'live'
                ? 'bg-secondary text-secondary-foreground'
                : status === 'connecting'
                  ? 'bg-muted text-muted-foreground'
                  : 'bg-destructive/10 text-destructive'
            }`}
          >
            {status === 'live'
              ? 'เชื่อมต่อสด'
              : status === 'connecting'
                ? 'กำลังเชื่อมต่อ…'
                : 'ออฟไลน์ (ส่งผ่าน REST)'}
          </span>
        </header>

        {pinned.length > 0 && (
          <div className="flex items-start gap-2 border-b border-border bg-secondary/40 px-4 py-2">
            <Pin className="mt-0.5 size-3.5 shrink-0 text-primary" />
            <div className="min-w-0 flex-1 space-y-0.5">
              {pinned.slice(0, 3).map((message) => (
                <p key={message.id} className="truncate text-xs">
                  <span className="text-muted-foreground">
                    {message.author_username}:
                  </span>{' '}
                  {message.content}
                </p>
              ))}
              {pinned.length > 3 && (
                <p className="text-[11px] text-muted-foreground">
                  และอีก {pinned.length - 3} ข้อความที่ปักหมุด
                </p>
              )}
            </div>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {timeline.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              ยังไม่มีข้อความในห้องนี้
            </p>
          )}

          <ul className="space-y-3">
            {timeline.map((message) => {
              // ตัวชั่วคราวที่ยังไม่ได้รับการยืนยันจากเซิร์ฟเวอร์
              const pending = message.id.startsWith('pending-');

              return (
              <li
                key={message.id}
                className={`group flex items-start gap-2.5 ${
                  pending ? 'opacity-60' : ''
                }`}
              >
                <Avatar username={message.author_username} size={32} />

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <UserName
                      username={message.author_username}
                      className="text-sm"
                    />
                    <span className="text-[11px] text-muted-foreground">
                      {new Date(message.created_at).toLocaleTimeString('th-TH', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                    {pending && (
                      // บอกตรง ๆ ว่ายังไม่ถึงเซิร์ฟเวอร์ ไม่ใช่ปล่อยให้เดา
                      <span className="text-[11px] text-muted-foreground">
                        กำลังส่ง…
                      </span>
                    )}
                    {message.edited_at && (
                      <span className="text-[11px] text-muted-foreground">
                        (แก้ไขแล้ว)
                      </span>
                    )}
                    {message.pinned_at && (
                      <Pin className="size-3 text-primary" aria-label="ปักหมุด" />
                    )}
                  </div>

                  <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                    {message.content}
                  </p>

                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <ReactionBar
                      targetKind="MESSAGE"
                      targetId={message.id}
                      summary={reactions[message.id] ?? null}
                      compact
                      onChange={(next) =>
                        setReactions((prev) => ({ ...prev, [message.id]: next }))
                      }
                    />

                    <button
                      type="button"
                      onClick={() => setThreadOf(message)}
                      className="text-xs text-muted-foreground transition-colors hover:text-primary"
                    >
                      {message.reply_count > 0
                        ? `${message.reply_count} คำตอบ`
                        : 'ตอบในเธรด'}
                    </button>

                    <MessageActions
                      channelId={channel.id}
                      message={message}
                      canPin={canPin}
                      isMine={message.author_username === me.username}
                      canDelete={
                        message.author_username === me.username ||
                        channel.my_role === 'MODERATOR' ||
                        me.layer1Role === 'admin'
                      }
                    />
                  </div>
                </div>
              </li>
              );
            })}
          </ul>

          <div ref={bottomRef} />
        </div>

        <div className="border-t border-border bg-card px-4 py-2.5">
          {typing.length > 0 && (
            <p className="mb-1 text-[11px] text-muted-foreground">
              {typing.join(', ')} กำลังพิมพ์…
            </p>
          )}

          {threadOf && (
            <div className="mb-2 flex items-center gap-2 rounded-lg bg-secondary/50 px-2.5 py-1.5 text-xs">
              <MessagesSquare className="size-3.5 shrink-0 text-primary" />
              <span className="min-w-0 flex-1 truncate">
                ตอบในเธรดของ {threadOf.author_username}: {threadOf.content}
              </span>
              <button
                type="button"
                onClick={() => setThreadOf(null)}
                className="shrink-0 text-muted-foreground hover:text-foreground"
              >
                ยกเลิก
              </button>
            </div>
          )}

          {error && <p className="mb-1 text-xs text-destructive">{error}</p>}

          <div className="flex gap-2">
            <input
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
                notifyTyping();
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void send();
                }
              }}
              placeholder={
                threadOf
                  ? 'ตอบในเธรด…'
                  : 'พิมพ์ข้อความ… ใช้ @ชื่อผู้ใช้ เพื่อเรียกถึงใคร'
              }
              className="min-w-0 flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />

            <button
              type="button"
              disabled={!draft.trim()}
              onClick={() => void send()}
              className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
              aria-label="ส่งข้อความ"
            >
              <Send className="size-4" />
            </button>
          </div>
        </div>
      </div>

      {threadOf && (
        <ThreadPanel
          channelId={channel.id}
          parent={threadOf}
          onClose={() => setThreadOf(null)}
        />
      )}
    </div>
  );
}

function MessageActions({
  channelId,
  message,
  canPin,
  canDelete,
  isMine,
}: {
  channelId: string;
  message: Message;
  canPin: boolean;
  canDelete: boolean;
  isMine: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content ?? '');
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);

    try {
      await api.patch(`/channels/${channelId}/messages/${message.id}`, {
        content: draft.trim(),
      });

      setEditing(false);
    } catch (caught) {
      // เช่น "แก้ข้อความได้ภายใน 15 นาทีหลังส่ง"
      setError(caught instanceof Error ? caught.message : 'แก้ไม่สำเร็จ');
    }
  }

  async function togglePin() {
    setError(null);

    try {
      if (message.pinned_at) {
        await api.del(`/channels/${channelId}/messages/${message.id}/pin`);
      } else {
        await api.put(`/channels/${channelId}/messages/${message.id}/pin`);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'ปักหมุดไม่สำเร็จ');
    }
  }

  async function remove() {
    setError(null);

    try {
      await api.del(`/channels/${channelId}/messages/${message.id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'ลบไม่สำเร็จ');
    }
  }

  if (editing) {
    return (
      <span className="flex w-full items-center gap-2">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void save();
            if (event.key === 'Escape') setEditing(false);
          }}
          className="min-w-0 flex-1 rounded border border-input bg-background px-2 py-1 text-sm"
        />
        <button
          type="button"
          onClick={() => void save()}
          className="text-xs text-primary"
        >
          บันทึก
        </button>
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="text-xs text-muted-foreground"
        >
          ยกเลิก
        </button>
        {error && <span className="text-xs text-destructive">{error}</span>}
      </span>
    );
  }

  return (
    <span className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
      {isMine && (
        <button
          type="button"
          onClick={() => {
            setDraft(message.content ?? '');
            setEditing(true);
          }}
          className="grid size-6 place-items-center rounded text-muted-foreground hover:bg-accent"
          aria-label="แก้ข้อความ"
        >
          <Pencil className="size-3.5" />
        </button>
      )}

      {canPin && (
        <button
          type="button"
          onClick={() => void togglePin()}
          className="grid size-6 place-items-center rounded text-muted-foreground hover:bg-accent"
          aria-label={message.pinned_at ? 'ถอนหมุด' : 'ปักหมุด'}
        >
          {message.pinned_at ? (
            <PinOff className="size-3.5" />
          ) : (
            <Pin className="size-3.5" />
          )}
        </button>
      )}

      {canDelete && (
        <button
          type="button"
          onClick={() => void remove()}
          className="grid size-6 place-items-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          aria-label="ลบข้อความ"
        >
          <Trash2 className="size-3.5" />
        </button>
      )}

      {error && <span className="text-xs text-destructive">{error}</span>}
    </span>
  );
}

function ThreadPanel({
  channelId,
  parent,
  onClose,
}: {
  channelId: string;
  parent: Message;
  onClose: () => void;
}) {
  const [replies, setReplies] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const page = await api.list<Message>(
          `/channels/${channelId}/messages/${parent.id}/thread?per_page=50`,
        );

        if (!cancelled) {
          setReplies(page.items);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [channelId, parent.id]);

  return (
    // จอต่ำกว่า xl ไม่มีที่ให้คอลัมน์ที่สาม — เดิมจึงซ่อนทิ้งเฉย ๆ
    // ผลคือปุ่ม "ตอบในเธรด" และ "N คำตอบ" กดแล้วไม่มีอะไรเกิดขึ้นเลย
    // บนมือถือและแท็บเล็ต ตอนนี้กลายเป็นแผ่นเต็มจอแทนการหายไป
    <aside className="flex w-80 shrink-0 flex-col border-l border-border bg-card max-xl:fixed max-xl:inset-0 max-xl:z-50 max-xl:w-full max-xl:border-l-0">
      <header className="flex items-center justify-between border-b border-border px-3 py-2.5">
        <h3 className="text-sm font-semibold">เธรด</h3>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          ปิด
        </button>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
        <div className="rounded-lg bg-secondary/40 p-2.5">
          <UserName username={parent.author_username} className="text-sm" />
          <p className="whitespace-pre-wrap text-sm">{parent.content}</p>
        </div>

        {loading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            กำลังโหลด…
          </p>
        ) : replies.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            ยังไม่มีคำตอบ — พิมพ์ในช่องด้านล่างเพื่อเริ่ม
          </p>
        ) : (
          replies.map((reply) => (
            <div key={reply.id} className="flex items-start gap-2">
              <Avatar username={reply.author_username} size={24} />
              <div className="min-w-0 flex-1">
                <UserName
                  username={reply.author_username}
                  className="text-xs"
                />
                <p className="whitespace-pre-wrap break-words text-sm">
                  {reply.content}
                </p>
              </div>
            </div>
          ))
        )}
      </div>

      <p className="border-t border-border px-3 py-2 text-[11px] leading-snug text-muted-foreground">
        คำตอบในเธรดไม่ขึ้นไทม์ไลน์หลัก และเธรดซ้อนเธรดไม่ได้ —
        เหมือน Discord และ Teams
      </p>
    </aside>
  );
}
