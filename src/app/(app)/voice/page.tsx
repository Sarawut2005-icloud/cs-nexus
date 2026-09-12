'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import {
  AlertTriangle,
  Loader2,
  Mic,
  MicOff,
  MonitorUp,
  MonitorX,
  PhoneOff,
  Volume2,
} from 'lucide-react';
import { AnimatedTooltip } from '@/components/ui/animated-tooltip';
import { Avatar, UserName } from '@/components/csmju/user-name';
import { ConnectivityCheck } from '@/components/csmju/connectivity-check';
import { api, ApiError } from '@/lib/csmju/api';
import { getIdentity } from '@/lib/csmju/identity';
import {
  bindSocket,
  connectSocket,
  emitWithAck,
} from '@/lib/csmju/socket';
import type { Channel, JoinVoiceResponse, VoiceSession } from '@/lib/csmju/types';

/// ห้องเสียงแบบ mesh P2P — เสียงวิ่งตรงระหว่างเบราว์เซอร์ ไม่ผ่านเซิร์ฟเวอร์
///
/// เซิร์ฟเวอร์ทำหน้าที่แค่สองอย่าง: คุมที่นั่ง และส่งต่อสัญญาณ (SDP/ICE)
/// นี่คือเหตุผลที่ระบบนี้อยู่บนงบ 0 บาทได้ — ไม่มีค่าประมวลผลเสียงเลย
///
/// ต้นทุนคือแบนด์วิดท์ของผู้ใช้: ห้อง 8 คน แต่ละคนต้องส่งเสียงให้อีก 7 คน
/// จึงจำกัดที่ 8 ที่นั่ง และแชร์หน้าจอได้ทีละคน (ดู README ของหลังบ้าน)
///
/// **ต้องเปิดสองแท็บ (หรือสองเครื่อง) แล้วสลับตัวตนเป็นคนละคน** จึงจะเห็น
/// การต่อสายจริง — แท็บเดียวจะเห็นแค่ตัวเองในห้อง

interface PeerState {
  username: string;
  connection: RTCPeerConnection;
  stream: MediaStream | null;
  /// เราเป็นฝ่ายยื่นข้อเสนอของสายนี้ไหม (ตัดสินด้วยการเทียบชื่อตอนเปิดสาย)
  ///
  /// ต้องจำไว้ เพราะตอนเพิ่มแทร็กหน้าจอต้องรู้ว่าจะยื่น offer เองได้ไหม
  /// หรือต้องขอให้อีกฝั่งยื่นให้ — ถ้าทั้งคู่ยื่นพร้อมกัน สายจะพังเงียบ ๆ
  isOfferer: boolean;
}

export default function VoicePage() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [session, setSession] = useState<JoinVoiceResponse | null>(null);
  const [peers, setPeers] = useState<Record<string, PeerState>>({});
  const [muted, setMuted] = useState(false);
  const [presenter, setPresenter] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const socketRef = useRef<Socket | null>(null);
  const localStream = useRef<MediaStream | null>(null);
  const screenStream = useRef<MediaStream | null>(null);
  const peersRef = useRef<Record<string, PeerState>>({});
  const iceServers = useRef<RTCIceServer[]>([]);
  const unbindRef = useRef<(() => void)[]>([]);

  /// สำเนาของห้องและผู้แชร์ปัจจุบัน สำหรับ cleanup ตอน unmount
  ///
  /// cleanup ผูกครั้งเดียวจึงมองเห็นแต่ค่าตอน mount — ต้องอ่านผ่าน ref
  const sessionRef = useRef<JoinVoiceResponse | null>(null);
  const presenterRef = useRef<string | null>(null);
  const me = getIdentity();

  useEffect(() => {
    void api
      .list<Channel>('/channels?per_page=50')
      .then((page) => setChannels(page.items))
      .catch(() =>
        setError('โหลดรายการห้องไม่สำเร็จ — หลังบ้านรันอยู่ไหม'),
      );
  }, []);

  /// สร้างการเชื่อมต่อไปยังเพื่อนหนึ่งคน
  ///
  /// `polite` ตัดสินว่าใครเป็นฝ่ายยื่น offer เพื่อไม่ให้ทั้งสองฝ่ายยื่นพร้อมกัน
  /// (glare) — ใช้การเทียบชื่อผู้ใช้เป็นเกณฑ์ตายตัว ทำให้ทั้งสองฝั่งได้ผลเหมือนกัน
  /// โดยไม่ต้องคุยกันก่อน
  /// เปิดรอบเจรจาใหม่กับสายหนึ่งเส้น
  ///
  /// **บั๊กที่ตัวนี้แก้: แชร์หน้าจอแล้วอีกฝั่งไม่เห็นอะไรเลย**
  ///
  /// การ addTrack เข้า RTCPeerConnection ที่ต่ออยู่แล้ว ไม่ทำให้ภาพวิ่งไปเอง
  /// ต้องมีรอบ offer/answer ใหม่เสมอ ของเดิมเพิ่มแทร็กแล้วจบ ผู้แชร์จึงเห็น
  /// แถบ "คุณกำลังแชร์หน้าจอ" ของเบราว์เซอร์และ UI ขึ้นว่าแชร์อยู่ แต่ปลายทาง
  /// ไม่เคยได้รับอะไร — ไม่มี error ให้เห็นสักตัว
  ///
  /// ฝ่ายยื่นถูกตัดสินด้วยการเทียบชื่อตอนเปิดสาย ถ้าเราไม่ใช่ฝ่ายยื่น
  /// ต้องขอให้อีกฝั่งเปิดรอบให้ ไม่ใช่ยื่นเองซ้อนกัน
  const renegotiate = useCallback(async (peer: PeerState) => {
    const socket = socketRef.current;

    if (!socket) return;

    if (!peer.isOfferer) {
      socket.emit('rtc:signal', {
        to_username: peer.username,
        kind: 'renegotiate',
        data: null,
      });

      return;
    }

    try {
      const offer = await peer.connection.createOffer();

      await peer.connection.setLocalDescription(offer);

      socket.emit('rtc:signal', {
        to_username: peer.username,
        kind: 'offer',
        data: offer,
      });
    } catch {
      setError('เปิดรอบเชื่อมต่อใหม่ไม่สำเร็จ — ลองหยุดแล้วแชร์ใหม่');
    }
  }, []);

  /// หยุดแชร์: ถอนแทร็กออกจากทุกสายแล้วเจรจาใหม่
  ///
  /// แค่ `track.stop()` ไม่พอ — ฝั่งผู้ชมจะเห็นภาพค้างที่เฟรมสุดท้าย
  /// เพราะ sender ยังอยู่ในสายและ SDP ยังบอกว่ามีช่องวิดีโออยู่
  /// ต้อง removeTrack แล้วเปิดรอบเจรจาใหม่ ถึงจะหายไปจริง
  const stopSharing = useCallback(async () => {
    const tracks = screenStream.current?.getTracks() ?? [];
    const trackIds = new Set(tracks.map((track) => track.id));

    // ถอนก่อนหยุด — หยุดก่อนแล้วค่อยถอนก็ได้ แต่ลำดับนี้อ่านแล้วตรงกับที่ตั้งใจ
    for (const peer of Object.values(peersRef.current)) {
      for (const sender of peer.connection.getSenders()) {
        if (sender.track && trackIds.has(sender.track.id)) {
          peer.connection.removeTrack(sender);
        }
      }
    }

    for (const track of tracks) {
      track.stop();
    }

    screenStream.current = null;

    for (const peer of Object.values(peersRef.current)) {
      await renegotiate(peer);
    }
  }, [renegotiate]);

  const createPeer = useCallback(
    (username: string, shouldOffer: boolean) => {
      const existing = peersRef.current[username];

      if (existing) {
        return existing;
      }

      const connection = new RTCPeerConnection({
        iceServers: iceServers.current,
      });

      const state: PeerState = {
        username,
        connection,
        stream: null,
        isOfferer: shouldOffer,
      };

      peersRef.current = { ...peersRef.current, [username]: state };
      setPeers({ ...peersRef.current });

      for (const track of localStream.current?.getTracks() ?? []) {
        connection.addTrack(track, localStream.current!);
      }

      connection.onicecandidate = (event) => {
        if (!event.candidate) return;

        socketRef.current?.emit('rtc:signal', {
          to_username: username,
          kind: 'ice',
          data: event.candidate.toJSON(),
        });
      };

      connection.ontrack = (event) => {
        const [stream] = event.streams;

        state.stream = stream ?? null;
        peersRef.current = { ...peersRef.current, [username]: { ...state } };
        setPeers({ ...peersRef.current });
      };

      connection.onconnectionstatechange = () => {
        if (
          connection.connectionState === 'failed' &&
          !iceServers.current.some((server) =>
            (Array.isArray(server.urls) ? server.urls : [server.urls]).some(
              (url) => url.startsWith('turn:'),
            ),
          )
        ) {
          // อาการนี้คือสิ่งที่ TURN แก้ — บอกตรง ๆ ดีกว่าให้ผู้ใช้เดา
          setNotice(
            `ต่อเสียงกับ ${username} ไม่ติด — เครือข่ายนี้ต้องมี TURN server (ยังไม่ได้ตั้ง)`,
          );
        }
      };

      if (shouldOffer) {
        void (async () => {
          const offer = await connection.createOffer();

          await connection.setLocalDescription(offer);

          socketRef.current?.emit('rtc:signal', {
            to_username: username,
            kind: 'offer',
            data: offer,
          });
        })();
      }

      return state;
    },
    [],
  );

  /// ต้อง memoize เพราะ cleanup ตอน unmount พึ่งมัน
  ///
  /// ถ้าเป็นฟังก์ชันใหม่ทุก render effect จะ re-run ทุก render แล้ว cleanup
  /// ก็จะทำงานทุก render ด้วย — เท่ากับถอด handler และ **ออกจากห้องเสียง**
  /// ทุกครั้งที่หน้าวาดใหม่
  const teardown = useCallback(() => {
    for (const peer of Object.values(peersRef.current)) {
      peer.connection.close();
    }

    peersRef.current = {};
    setPeers({});

    for (const track of localStream.current?.getTracks() ?? []) {
      track.stop();
    }

    for (const track of screenStream.current?.getTracks() ?? []) {
      track.stop();
    }

    localStream.current = null;
    screenStream.current = null;
  }, []);

  async function join(channel: Channel) {
    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      // ขอไมค์ก่อนเข้าห้อง — ถ้าผู้ใช้ปฏิเสธ จะได้ไม่จองที่นั่งทิ้งไว้
      localStream.current = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: false,
      });

      const joined = await api.post<JoinVoiceResponse>('/voice-sessions', {
        channel_id: channel.id,
      });

      iceServers.current = joined.ice_servers.map((server) => ({
        urls: server.urls,
        username: server.username,
        credential: server.credential,
      }));

      setSession(joined);

      if (!joined.turn_available) {
        setNotice(
          'ยังไม่ได้ตั้ง TURN server — ผู้ใช้ที่อยู่หลัง NAT แบบเจาะไม่ได้ ' +
            '(พบบ่อยในเน็ตมหาลัยและเน็ตมือถือ) จะเชื่อมเสียงไม่ติด',
        );
      }

      const socket = await connectSocket();

      socketRef.current = socket;

      // bindSocket คืนตัวถอดที่ถอด **เฉพาะ handler ตัวนี้**
      //
      // เดิมใช้ socket.off('rtc:signal') ตอนออกจากหน้า ซึ่งลบ handler ของ
      // CallProvider ที่ฟัง event เดียวกันบน socket ที่แชร์กันไปด้วย —
      // ผลคือเข้าหน้าห้องเสียงหนึ่งครั้งแล้วสายเรียกเข้าพังทั้งแอป
      unbindRef.current.push(
        bindSocket<{
          from_username: string;
          kind: 'offer' | 'answer' | 'ice' | 'renegotiate';
          data: unknown;
        }>(socket, 'rtc:signal', async (payload) => {
          // ฝั่งที่ได้ offer ไม่ต้องยื่น offer กลับ
          const peer = createPeer(payload.from_username, false);

          if (payload.kind === 'offer') {
            await peer.connection.setRemoteDescription(
              payload.data as RTCSessionDescriptionInit,
            );

            const answer = await peer.connection.createAnswer();

            await peer.connection.setLocalDescription(answer);

            socket.emit('rtc:signal', {
              to_username: payload.from_username,
              kind: 'answer',
              data: answer,
            });

            return;
          }

          if (payload.kind === 'answer') {
            await peer.connection.setRemoteDescription(
              payload.data as RTCSessionDescriptionInit,
            );

            return;
          }

          if (payload.kind === 'renegotiate') {
            // อีกฝั่งเพิ่มแทร็กแต่ยื่นข้อเสนอเองไม่ได้ — เราเปิดรอบให้
            await renegotiate(peer);

            return;
          }

          try {
            await peer.connection.addIceCandidate(
              payload.data as RTCIceCandidateInit,
            );
          } catch {
            // candidate ที่มาก่อน remote description จะถูกปฏิเสธ
            // ซึ่งไม่เป็นไรเพราะเบราว์เซอร์จะส่งชุดใหม่มาอีก
          }
        }),
      );

      unbindRef.current.push(
        bindSocket<{ session_id: string; presenter_username: string | null }>(
          socket,
          'screen:changed',
          (payload) => {
            if (payload.session_id !== joined.id) return;

            setPresenter(payload.presenter_username);
          },
        ),
      );

      // ยื่น offer ไปหาคนที่อยู่ในห้องก่อนเราเข้ามา
      // เกณฑ์: ใครชื่อ "น้อยกว่า" เป็นฝ่ายยื่น เพื่อไม่ให้ทั้งคู่ยื่นพร้อมกัน
      for (const participant of joined.participants) {
        if (participant.username === me.username) continue;

        createPeer(participant.username, me.username < participant.username);
      }
    } catch (caught) {
      teardown();

      if (caught instanceof ApiError) {
        // เช่น "ห้องเต็มแล้ว (8/8 คน)" หรือ "ไม่พบห้องนี้ หรือคุณไม่ได้เป็นสมาชิก"
        setError(caught.message);
      } else if (caught instanceof DOMException) {
        setError(
          'เข้าถึงไมโครโฟนไม่ได้ — อนุญาตในเบราว์เซอร์แล้วลองอีกครั้ง',
        );
      } else {
        setError(caught instanceof Error ? caught.message : 'เข้าห้องไม่สำเร็จ');
      }
    } finally {
      setBusy(false);
    }
  }

  async function leave() {
    if (!session) return;

    for (const off of unbindRef.current) {
      off();
    }

    unbindRef.current = [];

    try {
      await api.del(`/voice-sessions/${session.id}/participants/me`);
    } catch {
      // ออกไม่สำเร็จก็ไม่เป็นไร — หลังบ้านคืนที่นั่งเองเมื่อ socket หลุด
    }

    teardown();
    setSession(null);
    setPresenter(null);
  }

  function toggleMute() {
    const next = !muted;

    for (const track of localStream.current?.getAudioTracks() ?? []) {
      track.enabled = !next;
    }

    setMuted(next);
  }

  async function toggleScreen() {
    if (!session) return;

    const socket = socketRef.current;

    if (!socket) return;

    if (presenter === me.username) {
      await stopSharing();
      socket.emit('screen:release', { session_id: session.id });
      setPresenter(null);

      return;
    }

    try {
      const result = await emitWithAck<{
        ok: boolean;
        presenter_username?: string;
        max_viewers?: number;
        error?: string;
      }>(socket, 'screen:claim', { session_id: session.id });

      if (!result.ok) {
        // หลังบ้านบอกว่าใครกำลังแชร์อยู่ จึงบอกผู้ใช้ได้ตรง ๆ
        setError(result.error ?? 'จับจองสิทธิ์แชร์หน้าจอไม่สำเร็จ');

        return;
      }

      screenStream.current = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      });

      // ส่งภาพเข้าไปในทุกสายที่เปิดอยู่ แล้ว **เปิดรอบเจรจาใหม่ทุกสาย**
      //
      // ถ้าไม่เจรจา ภาพจะไม่วิ่งไปไหนเลย แม้แทร็กจะถูกเพิ่มเข้า connection แล้ว
      for (const peer of Object.values(peersRef.current)) {
        for (const track of screenStream.current.getVideoTracks()) {
          peer.connection.addTrack(track, screenStream.current);
        }

        await renegotiate(peer);
      }

      // ผู้ใช้กดหยุดแชร์จากแถบของเบราว์เซอร์เองได้ ต้องปล่อยสิทธิ์ตามด้วย
      const [video] = screenStream.current.getVideoTracks();

      video.onended = () => {
        // ต้องเก็บให้เหมือนกดหยุดในแอปทุกประการ ไม่งั้นผู้ชมจะเห็นภาพค้าง
        // เฉพาะตอนที่ผู้แชร์กดหยุดจากแถบของเบราว์เซอร์ ซึ่งหาสาเหตุยากมาก
        void stopSharing();
        socket.emit('screen:release', { session_id: session.id });
        setPresenter(null);
      };

      setPresenter(me.username);
    } catch (caught) {
      if (caught instanceof DOMException) {
        // ผู้ใช้กดยกเลิกหน้าต่างเลือกจอ — ต้องคืนสิทธิ์ ไม่งั้นห้องจะล็อกไว้
        socket.emit('screen:release', { session_id: session.id });
        setPresenter(null);
      } else {
        setError(
          caught instanceof Error ? caught.message : 'แชร์หน้าจอไม่สำเร็จ',
        );
      }
    }
  }

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    presenterRef.current = presenter;
  }, [presenter]);

  // ออกจากหน้านี้ = ต้องเก็บกวาดให้ครบ ไม่ใช่แค่ปิดไมค์
  //
  // เดิม cleanup เรียกแต่ teardown() ซึ่งปิดสายและปล่อยไมค์เท่านั้น
  // ส่วนการถอด handler กับการคืนที่นั่งอยู่ใน leave() ที่จะทำงานก็ต่อเมื่อ
  // ผู้ใช้ **กดปุ่มออกจากห้อง** — เปลี่ยนหน้าด้วยเมนูแทนการกดปุ่ม จึงเหลือ
  // handler ค้างบน socket ที่แชร์กันทั้งแอป (ทับถมขึ้นทุกครั้งที่เข้าหน้านี้)
  // และที่นั่งในห้องก็ไม่ถูกคืนจนกว่า socket จะหลุด
  useEffect(
    () => () => {
      for (const off of unbindRef.current) {
        off();
      }

      unbindRef.current = [];

      const current = sessionRef.current;

      if (current) {
        // คืนสิทธิ์แชร์หน้าจอก่อน ไม่งั้นห้องจะล็อกไว้ให้คนที่ออกไปแล้ว
        if (presenterRef.current === me.username) {
          socketRef.current?.emit('screen:release', {
            session_id: current.id,
          });
        }

        void api
          .del(`/voice-sessions/${current.id}/participants/me`)
          .catch(() => undefined);
      }

      teardown();
    },
    [teardown, me.username],
  );

  const voiceChannels = channels.filter(
    (channel) => channel.kind === 'VOICE' || channel.kind === 'GROUP',
  );

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <header className="mb-4">
        <h1 className="text-xl font-semibold">ห้องเสียง</h1>
        <p className="text-sm text-muted-foreground">
          เสียงวิ่งตรงระหว่างเบราว์เซอร์ (mesh P2P) เซิร์ฟเวอร์ไม่แตะเสียงเลย ·
          รับได้ห้องละ 8 คน
        </p>
      </header>

      {/* ตรวจก่อนโทร — WebRTC ล้มแบบเงียบที่สุด ถ้าไม่มีตัวนี้ผู้ใช้จะนั่งมอง
        * คำว่า "กำลังเชื่อมต่อ" ค้างอยู่โดยไม่รู้ว่าเพราะอะไร */}
      <ConnectivityCheck />

      {error && (
        <p className="mb-3 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {notice && (
        <p className="mb-3 flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/5 px-3 py-2 text-sm text-warning">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          {notice}
        </p>
      )}

      {!session ? (
        <>
          <p className="mb-2 text-sm font-medium">เลือกห้องที่จะเข้า</p>

          {voiceChannels.length === 0 ? (
            <p className="rounded-lg border border-border bg-card px-3 py-6 text-center text-sm text-muted-foreground">
              ยังไม่มีห้องที่เข้าได้ — ไปสร้างห้องกลุ่มหรือห้องเสียงที่หน้า
              &quot;ห้องแชท&quot; ก่อน
            </p>
          ) : (
            <ul className="space-y-2">
              {voiceChannels.map((channel) => (
                <li
                  key={channel.id}
                  className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5"
                >
                  <Volume2 className="size-4 shrink-0 text-muted-foreground" />

                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {channel.name ?? 'ห้องไม่มีชื่อ'}
                    </span>
                    <span className="block text-[11px] text-muted-foreground">
                      {channel.member_count} สมาชิก · เพดาน {channel.max_seats}{' '}
                      ที่นั่ง
                    </span>
                  </span>

                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void join(channel)}
                    className="flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-40"
                  >
                    {busy ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Mic className="size-4" />
                    )}
                    เข้าห้อง
                  </button>
                </li>
              ))}
            </ul>
          )}

          <p className="mt-4 rounded-lg bg-muted px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
            <strong className="text-foreground">วิธีทดสอบให้เห็นเสียงจริง:</strong>{' '}
            เปิดแท็บที่สอง สลับตัวตนเป็นคนละคน (มุมซ้ายล่าง) แล้วเข้าห้องเดียวกัน
            — แท็บเดียวจะเห็นแค่ตัวเองเพราะไม่มีใครให้ต่อสายด้วย
          </p>
        </>
      ) : (
        <ActiveSession
          session={session}
          peers={Object.values(peers)}
          presenter={presenter}
          muted={muted}
          onToggleMute={toggleMute}
          onToggleScreen={() => void toggleScreen()}
          onLeave={() => void leave()}
        />
      )}
    </div>
  );
}

function ActiveSession({
  session,
  peers,
  presenter,
  muted,
  onToggleMute,
  onToggleScreen,
  onLeave,
}: {
  session: JoinVoiceResponse;
  peers: PeerState[];
  presenter: string | null;
  muted: boolean;
  onToggleMute: () => void;
  onToggleScreen: () => void;
  onLeave: () => void;
}) {
  const [live, setLive] = useState<VoiceSession | null>(null);
  const me = getIdentity();

  // ดึงรายชื่อผู้เข้าร่วมซ้ำเป็นระยะ เพราะการเข้า/ออกห้องเป็น REST
  // ไม่มี event บอก — TODO(PL): เสนอหลังบ้านเพิ่ม voice:participants
  useEffect(() => {
    const tick = () =>
      void api
        .list<VoiceSession>(`/voice-sessions?channel_id=${session.channel_id}`)
        .then((page) => setLive(page.items[0] ?? null))
        .catch(() => undefined);

    tick();

    const timer = setInterval(tick, 5000);

    return () => clearInterval(timer);
  }, [session.channel_id]);

  const participants = live?.participants ?? session.participants;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-medium">
            อยู่ในห้องเสียง · {participants.length}/{session.max_seats} ที่นั่ง
          </span>

          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            TURN: {session.turn_available ? 'มี' : 'ไม่มี'} · ผู้ชมการแชร์จอสูงสุด{' '}
            {session.max_screen_viewers}
          </span>
        </div>

        {/* ภาพรวมว่าใครอยู่ในห้อง — เห็นครบในบรรทัดเดียวก่อนอ่านรายละเอียด */}
        <div className="mb-3">
          <AnimatedTooltip
            size={40}
            items={participants.map((participant) => ({
              id: participant.username,
              name: participant.username,
              designation:
                participant.username === presenter
                  ? 'กำลังแชร์หน้าจอ'
                  : 'อยู่ในสาย',
              online: true,
            }))}
          />
        </div>

        <ul className="grid gap-2 sm:grid-cols-2">
          {participants.map((participant) => {
            const peer = peers.find(
              (row) => row.username === participant.username,
            );
            const isMe = participant.username === me.username;

            return (
              <li
                key={participant.username}
                className="flex items-center gap-2.5 rounded-lg bg-muted/60 px-3 py-2"
              >
                <Avatar username={participant.username} size={32} />

                <span className="min-w-0 flex-1">
                  <UserName
                    username={participant.username}
                    className="block truncate text-sm"
                  />
                  <span className="block text-[11px] text-muted-foreground">
                    {isMe
                      ? muted
                        ? 'คุณ · ปิดไมค์'
                        : 'คุณ'
                      : peer?.stream
                        ? 'ต่อเสียงแล้ว'
                        : peer
                          ? 'กำลังต่อสาย…'
                          : 'รอสัญญาณ'}
                  </span>
                </span>

                {participant.username === presenter && (
                  <MonitorUp className="size-4 shrink-0 text-primary" />
                )}
              </li>
            );
          })}
        </ul>
      </div>

      {/* เสียงของแต่ละคน — ซ่อนไว้ ไม่ต้องให้ผู้ใช้เห็นตัวเล่น */}
      {peers.map((peer) =>
        peer.stream ? (
          <RemoteAudio
            key={peer.username}
            stream={peer.stream}
            username={peer.username}
          />
        ) : null,
      )}

      {presenter && presenter !== me.username && (
        <ScreenView
          stream={
            peers.find((peer) => peer.username === presenter)?.stream ?? null
          }
          presenter={presenter}
        />
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onToggleMute}
          className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
            muted
              ? 'border-destructive bg-destructive/10 text-destructive'
              : 'border-border hover:bg-accent'
          }`}
        >
          {muted ? <MicOff className="size-4" /> : <Mic className="size-4" />}
          {muted ? 'เปิดไมค์' : 'ปิดไมค์'}
        </button>

        <button
          type="button"
          onClick={onToggleScreen}
          disabled={presenter !== null && presenter !== me.username}
          className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-40"
          title={
            presenter !== null && presenter !== me.username
              ? `${presenter} กำลังแชร์อยู่ — หนึ่งห้องแชร์ได้ทีละคน`
              : undefined
          }
        >
          {presenter === me.username ? (
            <MonitorX className="size-4" />
          ) : (
            <MonitorUp className="size-4" />
          )}
          {presenter === me.username ? 'หยุดแชร์หน้าจอ' : 'แชร์หน้าจอ'}
        </button>

        <button
          type="button"
          onClick={onLeave}
          className="ml-auto flex items-center gap-1.5 rounded-lg bg-destructive px-3 py-2 text-sm font-medium text-white"
        >
          <PhoneOff className="size-4" />
          ออกจากห้อง
        </button>
      </div>
    </div>
  );
}

function RemoteAudio({
  stream,
  username,
}: {
  stream: MediaStream;
  username: string;
}) {
  const ref = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.srcObject = stream;
    }
  }, [stream]);

  return (
    <audio ref={ref} autoPlay playsInline className="hidden">
      <track kind="captions" label={`เสียงของ ${username}`} />
    </audio>
  );
}

function ScreenView({
  stream,
  presenter,
}: {
  stream: MediaStream | null;
  presenter: string;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (ref.current && stream) {
      ref.current.srcObject = stream;
    }
  }, [stream]);

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-black">
      <p className="bg-card px-3 py-1.5 text-xs text-muted-foreground">
        {presenter} กำลังแชร์หน้าจอ
      </p>
      <video ref={ref} autoPlay playsInline className="w-full">
        <track kind="captions" label={`หน้าจอของ ${presenter}`} />
      </video>
    </div>
  );
}
