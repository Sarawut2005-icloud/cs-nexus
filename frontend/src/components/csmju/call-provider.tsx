'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { Socket } from 'socket.io-client';
import { Phone, PhoneOff } from 'lucide-react';
import { VoiceChat, type VoiceParticipant } from '@/components/ui/audio-chat';
import { useModalFocus } from '@/components/ui/use-modal-focus';
import { api, ApiError } from '@/lib/csmju/api';
import { useMe } from '@/lib/csmju/session';
import { isPolite, shouldIgnoreOffer } from '@/lib/csmju/negotiation';
import { ScreenStage } from '@/components/csmju/screen-stage';
import {
  bindSocket,
  connectSocket,
  emitWithAck,
} from '@/lib/csmju/socket';
import type { JoinVoiceResponse } from '@/lib/csmju/types';

/// ตัวจัดการสายที่อยู่เหนือทุกหน้าจอ
///
/// อยู่ใน layout ไม่ใช่ในหน้าใดหน้าหนึ่ง เพราะ **เสียงกริ่งต้องดังแม้ผู้ใช้
/// กำลังอ่านฟีดอยู่** ถ้าผูกกับหน้า DM สายจะเข้าเฉพาะตอนเปิดหน้านั้นค้างไว้
/// ซึ่งเท่ากับไม่มีระบบโทรเลย
///
/// สาย 1:1 ใช้ห้องเสียงของ DM (maxSeats = 2) จึงไม่ต้องมีโค้ดหลังบ้านแยก
/// สำหรับการโทร — ต่างกันแค่ชั้นเสียงกริ่งที่เพิ่มเข้ามา

interface IncomingCall {
  sessionId: string;
  channelId: string;
  fromCoreUserId: string;
}

interface ActiveCall {
  sessionId: string;
  channelId: string;
  peerCoreUserId: string;
  session: JoinVoiceResponse;
  /// true = เราเป็นฝ่ายโทรออก และยังรออีกฝ่ายรับ
  ringing: boolean;
}

interface CallContextValue {
  startCall: (channelId: string, peerCoreUserId: string) => Promise<void>;
  inCall: boolean;
  error: string | null;
}

const CallContext = createContext<CallContextValue>({
  startCall: async () => {},
  inCall: false,
  error: null,
});

export function useCall(): CallContextValue {
  return useContext(CallContext);
}

export function CallProvider({ children }: { children: React.ReactNode }) {
  const [incoming, setIncoming] = useState<IncomingCall | null>(null);
  const [active, setActive] = useState<ActiveCall | null>(null);
  const [muted, setMuted] = useState(false);
  const [deafened, setDeafened] = useState(false);
  const [presenting, setPresenting] = useState(false);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);

  /// จอที่ **เรา** กำลังแชร์ และจอที่ **อีกฝ่าย** กำลังแชร์
  ///
  /// ของเดิมไม่มีทั้งคู่: `remoteStream` ถูกยัดเข้า <audio> อย่างเดียว ภาพ
  /// หน้าจอที่เจรจามาได้จึงไม่ถูกเรนเดอร์ที่ไหนเลย — ทั้งผู้แชร์และผู้ชม
  /// เห็นแค่ปุ่มเปลี่ยนสถานะ แต่ไม่มีใครเห็นภาพสักคน
  const [screenPreview, setScreenPreview] = useState<MediaStream | null>(null);
  const [remoteVideo, setRemoteVideo] = useState<MediaStream | null>(null);

  /// สตรีมไมค์ของเราเอง เก็บเป็น state ไม่ใช่อ่านจาก ref ตอน render
  ///
  /// ref ไม่ทำให้ React วาดใหม่ ตัววัดระดับเสียงใน VoiceChat จึงอาจผูกกับ
  /// ค่า null ที่อ่านไว้ตอนวาดรอบก่อน แล้วแถบ "กำลังพูด" ก็ไม่ขยับเลย
  /// (ที่ผ่านมามันรอดมาได้เพราะบังเอิญมี setActive ตามมาติด ๆ เท่านั้น)
  const [micStream, setMicStream] = useState<MediaStream | null>(null);
  const [connection, setConnection] = useState<
    'connecting' | 'connected' | 'failed'
  >('connecting');
  const [error, setError] = useState<string | null>(null);

  const socketRef = useRef<Socket | null>(null);

  /// สำเนาของสายปัจจุบันสำหรับ handler ของ socket
  ///
  /// handler ถูกผูกครั้งเดียวตอน mount จึงมองเห็นแต่ค่า `active` ตอนนั้น
  /// (คือ null ตลอด) — ต้องอ่านผ่าน ref ถึงจะรู้ว่าตอนนี้กำลังคุยกับใครอยู่
  const activeRef = useRef<ActiveCall | null>(null);
  const localStream = useRef<MediaStream | null>(null);
  const screenStream = useRef<MediaStream | null>(null);
  const peer = useRef<RTCPeerConnection | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  /// เจรจา SDP ได้หรือยัง — จริงก็ต่อเมื่อ **ทั้งสองฝ่ายอยู่ในห้องเสียงแล้ว**
  ///
  /// หลังบ้านส่งต่อ rtc:signal ให้เฉพาะคู่ที่มีแถวผู้เข้าร่วมที่ยังไม่ออก
  /// ทั้งคู่ (voice.service.ts `sharesVoiceSession`) ผู้ที่ถูกโทรหายังไม่มีแถว
  /// นั้นจนกว่าจะกดรับ
  const negotiationReady = useRef(false);

  /// ปลายทางของสายนี้ — ตั้งตอนเปิดสาย ไม่ใช่รออ่านจาก state
  ///
  /// `activeRef` ถูกอัปเดตใน effect ซึ่งทำงาน **หลัง** render จบ ส่วนการยื่น
  /// ข้อเสนอเกิดทันทีที่รับสาย ถ้าอ่านจาก `activeRef` จะเจอ null แล้วเงียบไป
  /// เฉย ๆ — สายไม่ติดโดยไม่มีอะไรบอก และกลายเป็นบั๊กที่ขึ้นกับจังหวะ
  const peerIdRef = useRef<string | null>(null);

  /// เราเป็นฝ่ายที่ "ยอมถอย" ของสายนี้ไหม เมื่อยื่นข้อเสนอชนกัน
  ///
  /// ดู `lib/csmju/negotiation.ts` ว่าทำไมต้องมี และเทียบอย่างไร
  const polite = useRef(false);

  /// กำลังยื่นข้อเสนอของเราเองอยู่ — ใช้ตรวจจับการยื่นชนกัน
  const makingOffer = useRef(false);

  /// เพิ่งเมินข้อเสนอที่ชนไป — ICE ของรอบนั้นที่ตามมาต้องเมินด้วย
  const ignoredOffer = useRef(false);
  const unbindRef = useRef<(() => void)[]>([]);
  const me = useMe();

  const teardown = useCallback(() => {
    peer.current?.close();
    peer.current = null;

    for (const track of localStream.current?.getTracks() ?? []) {
      track.stop();
    }

    for (const track of screenStream.current?.getTracks() ?? []) {
      track.stop();
    }

    localStream.current = null;
    screenStream.current = null;
    setScreenPreview(null);
    setRemoteVideo(null);
    negotiationReady.current = false;
    peerIdRef.current = null;
    polite.current = false;
    makingOffer.current = false;
    ignoredOffer.current = false;

    setRemoteStream(null);
    setMicStream(null);
    setPresenting(false);
    setMuted(false);

    // เดิมลืมคืนค่านี้ — ผู้ใช้ที่เคยกด "ปิดเสียงเข้า" ในสายก่อนหน้า
    // จะไม่ได้ยินใครเลยในสายถัดไป โดยไม่มีอะไรบอกว่าเพราะอะไร
    setDeafened(false);
    setConnection('connecting');
  }, []);

  /// ออกจากห้องเสียงที่เข้าไปแล้ว
  ///
  /// **ต้องเรียกทุกเส้นทางที่ทิ้งสายหลังจาก enterSession สำเร็จไปแล้ว**
  /// เดิมมีแต่ hangUp ที่เรียก ส่วนทางที่ผิดพลาด (อีกฝ่ายปฏิเสธ · กริ่งไม่ผ่าน ·
  /// เกิด error หลังเข้าห้อง) แค่ teardown ฝั่งตัวเองแล้วจบ — แถวผู้เข้าร่วม
  /// ยังค้างอยู่ ที่นั่งไม่ถูกคืน และห้อง DM ที่มีแค่ 2 ที่นั่งจะเต็มถาวร
  /// จนกว่า socket จะหลุด แปลว่าโทรซ้ำไม่ได้อีกเลยทั้งที่ไม่มีใครอยู่ในสาย
  const leaveSession = useCallback(async (sessionId: string) => {
    try {
      await api.del(`/voice-sessions/${sessionId}/participants/me`);
    } catch {
      // ออกไม่สำเร็จก็ไม่เป็นไร — หลังบ้านคืนที่นั่งเองเมื่อ socket หลุด
    }
  }, []);

  /// เปิดรอบเจรจา SDP หนึ่งรอบ
  ///
  /// **บั๊กที่ตัวนี้แก้ — สายไม่เคยติดเลยสักสาย**
  ///
  /// เดิม openPeer สร้าง offer ทันทีที่เปิดสาย ซึ่งคือ "ตอนเริ่มส่งเสียงกริ่ง"
  /// อีกฝ่ายยังไม่กดรับ จึงยังไม่มีแถวผู้เข้าร่วม หลังบ้านตอบ
  /// `ปลายทางไม่ได้อยู่ในห้องเสียงเดียวกับคุณ` แล้วทิ้ง offer นั้นไป
  ///
  /// พอเขากดรับ ฝั่งเขาคำนวณ `shouldOffer` จากการเทียบชื่อได้ false
  /// (เพราะผู้โทรชื่อน้อยกว่า) จึงไม่มีใครยื่นข้อเสนออีกเลย — ทั้งสองฝ่าย
  /// ค้างที่ "กำลังเชื่อมต่อ" ตลอดไป โดยไม่มี error ขึ้นให้เห็นสักตัว
  ///
  /// การเลื่อนมาเจรจาตอนนี้ยังแก้ลำดับ ICE ไปด้วย: เบราว์เซอร์เริ่มเก็บ
  /// candidate หลัง setLocalDescription ซึ่งตอนนี้เกิดหลังอีกฝ่ายเข้าห้องแล้ว
  ///
  /// **บั๊กที่ตัวนี้แก้เพิ่ม: ผู้รับสายแชร์หน้าจอแล้วผู้โทรไม่เห็นอะไรเลย**
  ///
  /// ของเดิมแบ่งหน้าที่ตายตัวว่าใครเป็นฝ่ายยื่น ฝ่ายที่ไม่ได้ยื่นจะส่งสัญญาณ
  /// `renegotiate` ไปขอให้อีกฝั่งยื่นให้แทน — ซึ่งใช้ไม่ได้ตามสเปก WebRTC
  /// เพราะ **ฝ่ายที่ตอบเพิ่มช่องสื่อใหม่ในคำตอบไม่ได้** (JSEP บังคับว่าคำตอบ
  /// ต้องมีจำนวน m-section เท่าข้อเสนอ) ข้อเสนอที่อีกฝั่งสร้างให้จึงไม่มีช่อง
  /// วิดีโอมารองรับ ภาพหน้าจอไม่มีทางวิ่งไปถึง และไม่มี error ให้เห็นสักตัว
  ///
  /// ตอนนี้ยื่นได้ทั้งสองฝั่ง ใครเพิ่มแทร็กก็ยื่นเอง ถ้าชนกันฝ่าย polite ถอย
  const makeOffer = useCallback(async () => {
    const connectionInstance = peer.current;
    const socket = socketRef.current;
    const peerCoreUserId = peerIdRef.current;

    if (!connectionInstance || !socket || !peerCoreUserId) return;
    if (!negotiationReady.current) return;

    // **ยื่นได้ทีละรอบเท่านั้น**
    //
    // ทั้ง `negotiationneeded` ที่เบราว์เซอร์ยิงเองตอน addTrack และการ
    // เรียกตรง ๆ ของโค้ดเรา ต่างก็พาเข้ามาที่นี่ ถ้าไม่กันไว้จะยื่นสองรอบ
    // ติดกัน อีกฝ่ายตอบกลับมาสองใบ ใบแรกพาสายกลับสู่ stable ใบที่สองจึงชน
    // InvalidStateError ("Called in wrong state: stable") — ซึ่งเป็น error
    // ที่โผล่ในคอนโซลผู้ใช้จริงโดยที่ภาพยังวิ่งปกติ จึงหาต้นตอยาก
    //
    // ข้ามไปเฉย ๆ ได้ เพราะเบราว์เซอร์จะยิง `negotiationneeded` ซ้ำให้เอง
    // เมื่อสายกลับสู่ stable แล้วยังมีอะไรค้างต้องเจรจา
    if (connectionInstance.signalingState !== 'stable') return;

    try {
      makingOffer.current = true;

      // เรียกแบบไม่ใส่อาร์กิวเมนต์ = ให้เบราว์เซอร์สร้างข้อเสนอที่ถูกต้อง
      // ตามสถานะปัจจุบันเอง ปลอดภัยกว่า createOffer แล้วค่อยเซ็ตทีหลัง
      await connectionInstance.setLocalDescription();

      // ต้องรอ ack — หลังบ้านปฏิเสธการส่งต่อได้ (เช่นอีกฝ่ายออกจากห้องไปแล้ว)
      // แล้วเดิมเราทิ้งคำตอบนั้น ผู้ใช้จึงเห็นแต่ "กำลังเชื่อมต่อ" ค้างไว้
      // โดยไม่มีอะไรบอกว่าเกิดอะไรขึ้น
      const relayed = await emitWithAck<{ ok: boolean; error?: string }>(
        socket,
        'rtc:signal',
        {
          to_core_user_id: peerCoreUserId,
          kind: 'offer',
          data: connectionInstance.localDescription,
        },
      );

      if (!relayed.ok) {
        setError(relayed.error ?? 'ส่งสัญญาณเสียงไม่ถึงอีกฝ่าย');
      }
    } catch {
      setError('เปิดการเชื่อมต่อเสียงไม่สำเร็จ — ลองวางแล้วโทรใหม่');
    } finally {
      makingOffer.current = false;
    }
  }, []);

  /// สร้างสาย P2P หนึ่งเส้น
  ///
  /// ไม่ต้องตัดสินว่าใครเป็นฝ่ายยื่นอีกแล้ว — ยื่นได้ทั้งคู่ เทียบชื่อไว้แค่
  /// เพื่อรู้ว่าใครถอยถ้าบังเอิญยื่นชนกัน
  const openPeer = useCallback(
    (
      socket: Socket,
      session: JoinVoiceResponse,
      peerCoreUserId: string,
    ) => {
      const connectionInstance = new RTCPeerConnection({
        // `username` เป็นชื่อฟิลด์ของมาตรฐาน WebRTC ไม่ใช่ตัวตนผู้ใช้
        iceServers: session.ice_servers.map((server) => ({
          urls: server.urls,
          username: server.username,
          credential: server.credential,
        })),
      });

      peer.current = connectionInstance;
      peerIdRef.current = peerCoreUserId;
      polite.current = isPolite(me.id, peerCoreUserId);
      ignoredOffer.current = false;

      for (const track of localStream.current?.getTracks() ?? []) {
        connectionInstance.addTrack(track, localStream.current!);
      }

      connectionInstance.onicecandidate = (event) => {
        if (!event.candidate) return;

        socket.emit('rtc:signal', {
          to_core_user_id: peerCoreUserId,
          kind: 'ice',
          data: event.candidate.toJSON(),
        });
      };

      connectionInstance.ontrack = (event) => {
        const [stream] = event.streams;

        setRemoteStream(stream ?? null);

        // เสียงไปเข้า <audio> ส่วนภาพต้องมีที่ให้เรนเดอร์ของมันเอง
        if (event.track.kind !== 'video') return;

        setRemoteVideo(stream ?? null);

        // อีกฝ่ายหยุดแชร์ = แทร็กถูกถอดออกแล้วเจรจาใหม่ ปลายทางจะได้ `mute`
        // ก่อน แล้วค่อยได้ `removetrack` — ดักทั้งคู่เพราะเบราว์เซอร์แต่ละตัว
        // ยิงไม่เหมือนกัน ถ้าพลาดจะค้างเป็นภาพนิ่งเฟรมสุดท้ายแทนที่จะหายไป
        const clear = () => setRemoteVideo(null);

        event.track.addEventListener('mute', clear);
        event.track.addEventListener('ended', clear);
        stream?.addEventListener('removetrack', clear);
      };

      connectionInstance.onconnectionstatechange = () => {
        const state = connectionInstance.connectionState;

        if (state === 'connected') setConnection('connected');
        if (state === 'failed') {
          setConnection('failed');

          if (!session.turn_available) {
            setError(
              'ต่อสายไม่ติด — เครือข่ายนี้ต้องมี TURN server ซึ่งยังไม่ได้ตั้ง',
            );
          }
        }
      };

      // เบราว์เซอร์บอกเองว่าต้องเจรจาใหม่ (เช่นตอนเพิ่มแทร็กแชร์หน้าจอ)
      // negotiate() จะเงียบไว้จนกว่าทั้งสองฝ่ายจะอยู่ในห้องเสียงจริง
      connectionInstance.onnegotiationneeded = () => void makeOffer();

      return connectionInstance;
    },
    [makeOffer, me.id],
  );

  /// เข้าห้องเสียงของ DM แล้วเตรียมไมค์
  const enterSession = useCallback(
    async (channelId: string) => {
      if (!localStream.current) {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
          video: false,
        });

        localStream.current = stream;
        setMicStream(stream);
      }

      return api.post<JoinVoiceResponse>('/voice-sessions', {
        channel_id: channelId,
      });
    },
    [],
  );

  const startCall = useCallback(
    async (channelId: string, peerCoreUserId: string) => {
      // กันโทรซ้อนสายที่คุยอยู่ — ไม่งั้น peer connection ตัวเก่าถูกทับทิ้ง
      // โดยไม่ถูกปิด และห้องเสียงเดิมก็ไม่ถูกออก
      if (activeRef.current) {
        setError('กำลังอยู่ในสายอยู่แล้ว — วางสายก่อนถึงจะโทรใหม่ได้');

        return;
      }

      setError(null);

      // จำไว้ว่าเข้าห้องไปแล้วหรือยัง เพื่อออกให้ถูกต้องถ้าพลาดทีหลัง
      let joinedSessionId: string | null = null;

      try {
        const session = await enterSession(channelId);

        joinedSessionId = session.id;

        const socket = await connectSocket();

        socketRef.current = socket;

        setActive({
          sessionId: session.id,
          channelId,
          peerCoreUserId,
          session,
          ringing: true,
        });

        openPeer(socket, session, peerCoreUserId);

        const ring = await emitWithAck<{ ok: boolean; error?: string }>(
          socket,
          'call:ring',
          { session_id: session.id, to_core_user_id: peerCoreUserId },
        );

        if (!ring.ok) {
          setError(ring.error ?? 'ส่งเสียงกริ่งไม่สำเร็จ');
          teardown();
          setActive(null);
          await leaveSession(session.id);
        }
      } catch (caught) {
        teardown();
        setActive(null);

        if (joinedSessionId) {
          await leaveSession(joinedSessionId);
        }

        if (caught instanceof DOMException) {
          setError('เข้าถึงไมโครโฟนไม่ได้ — อนุญาตในเบราว์เซอร์แล้วลองอีกครั้ง');
        } else {
          setError(
            caught instanceof ApiError ? caught.message : 'โทรไม่สำเร็จ',
          );
        }
      }
    },
    [enterSession, openPeer, teardown, leaveSession],
  );

  const hangUp = useCallback(async () => {
    const current = active;

    if (!current) return;

    const socket = socketRef.current;

    if (socket) {
      // ยังไม่มีใครรับ = ยกเลิก · รับแล้ว = วางสาย — คนละ event กัน
      //
      // เดิมส่งเฉพาะกรณีแรก สายที่รับแล้วจึงวางแบบเงียบ ๆ ปล่อยให้อีกฝั่ง
      // นั่งมองแผงสายที่ตายไปแล้ว
      socket.emit(current.ringing ? 'call:cancel' : 'call:end', {
        session_id: current.sessionId,
        to_core_user_id: current.peerCoreUserId,
      });

      // แชร์หน้าจออยู่ต้องคืนสิทธิ์ด้วย ไม่งั้นห้องจะล็อกไว้ให้คนที่ออกไปแล้ว
      if (presenting) {
        socket.emit('screen:release', { session_id: current.sessionId });
      }
    }

    await leaveSession(current.sessionId);

    teardown();
    setActive(null);
  }, [active, presenting, teardown, leaveSession]);

  const accept = useCallback(async () => {
    const call = incoming;

    if (!call) return;

    setIncoming(null);
    setError(null);

    // อยู่ในสายอื่นอยู่ = ต้องเก็บสายเดิมให้เรียบร้อยก่อน
    //
    // เดิม setActive ทับของเก่าดื้อ ๆ แล้ว openPeer ก็เขียนทับ peer.current
    // โดยไม่ปิดตัวเดิม — สายแรกยังเปิดอยู่ในเบราว์เซอร์ กินไมค์และที่นั่ง
    // ต่อไปเรื่อย ๆ โดยไม่มี UI ให้วางอีกแล้ว
    const previous = activeRef.current;

    if (previous) {
      socketRef.current?.emit(
        previous.ringing ? 'call:cancel' : 'call:end',
        {
          session_id: previous.sessionId,
          to_core_user_id: previous.peerCoreUserId,
        },
      );

      teardown();
      setActive(null);
      await leaveSession(previous.sessionId);
    }

    let joinedSessionId: string | null = null;

    try {
      const session = await enterSession(call.channelId);

      joinedSessionId = session.id;

      const socket = await connectSocket();

      socketRef.current = socket;

      setActive({
        sessionId: session.id,
        channelId: call.channelId,
        peerCoreUserId: call.fromCoreUserId,
        session,
        ringing: false,
      });

      openPeer(socket, session, call.fromCoreUserId);

      // ผู้โทรอยู่ในห้องมาตั้งแต่ก่อนส่งกริ่ง และเราเพิ่งเข้ามา = ครบสองฝ่าย
      negotiationReady.current = true;

      // ยื่นข้อเสนอเลย ไม่ต้องรอฝั่งโน้น — ถ้าเขายื่นมาพร้อมกัน กฎ polite
      // จะตัดสินให้เองว่าใครถอย
      void makeOffer();

      socket.emit('call:answer', {
        session_id: call.sessionId,
        to_core_user_id: call.fromCoreUserId,
        accepted: true,
      });
    } catch (caught) {
      teardown();
      setActive(null);

      if (joinedSessionId) {
        await leaveSession(joinedSessionId);
      }

      setError(
        caught instanceof DOMException
          ? 'เข้าถึงไมโครโฟนไม่ได้'
          : caught instanceof ApiError
            ? caught.message
            : 'รับสายไม่สำเร็จ',
      );
    }
  }, [incoming, enterSession, openPeer, teardown, leaveSession, makeOffer]);

  const decline = useCallback(() => {
    const call = incoming;

    if (!call) return;

    socketRef.current?.emit('call:answer', {
      session_id: call.sessionId,
      to_core_user_id: call.fromCoreUserId,
      accepted: false,
    });

    setIncoming(null);
  }, [incoming]);

  // ฟังสายเข้าและผลของสายที่โทรออก
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const socket = await connectSocket();

        if (cancelled) return;

        socketRef.current = socket;

        unbindRef.current.push(
          bindSocket<{
            session_id: string;
            channel_id: string;
            from_core_user_id: string;
          }>(socket, 'call:incoming', (payload) => {
            setIncoming({
              sessionId: payload.session_id,
              channelId: payload.channel_id,
              fromCoreUserId: payload.from_core_user_id,
            });
          }),
        );

        unbindRef.current.push(
          bindSocket<{
            accepted: boolean;
            from_core_user_id: string;
            session_id?: string;
          }>(
            socket,
            'call:answered',
            (payload) => {
              // ต้องเป็นคำตอบของสายที่เรากำลังโทรอยู่จริง
              //
              // ด่านฝั่งเซิร์ฟเวอร์เป็นตัวหลัก แต่ฝั่งนี้ก็ต้องไม่เชื่อทุกอย่าง
              // ที่ลอยเข้ามา — คำตอบของสายเก่าที่มาช้า หรือของคนที่เราไม่ได้
              // โทรหา ต้องไม่ทำให้สายปัจจุบันถูกวาง
              if (!activeRef.current) return;

              if (payload.from_core_user_id !== activeRef.current.peerCoreUserId) {
                return;
              }

              if (
                payload.session_id &&
                payload.session_id !== activeRef.current.sessionId
              ) {
                return;
              }

              if (!payload.accepted) {
                const sessionId = activeRef.current?.sessionId;

                setError(`${payload.from_core_user_id} ปฏิเสธสาย`);
                teardown();
                setActive(null);

                // ถูกปฏิเสธก็ต้องออกจากห้องเสียงที่เข้าไปรอไว้แล้ว
                if (sessionId) {
                  void leaveSession(sessionId);
                }

                return;
              }

              setActive((current) =>
                current ? { ...current, ringing: false } : current,
              );

              // ตอนนี้เขามีแถวผู้เข้าร่วมแล้ว หลังบ้านจึงยอมส่งต่อ SDP
              negotiationReady.current = true;
              void makeOffer();
            },
          ),
        );

        unbindRef.current.push(
          bindSocket<{ session_id?: string; from_core_user_id?: string }>(
            socket,
            'call:cancelled',
            (payload) =>
              // เฉพาะสายที่กำลังดังอยู่จริงเท่านั้น ไม่ใช่ทุกอย่างที่ลอยเข้ามา
              setIncoming((current) => {
                if (!current) return current;

                if (
                  payload.from_core_user_id &&
                  payload.from_core_user_id !== current.fromCoreUserId
                ) {
                  return current;
                }

                if (
                  payload.session_id &&
                  payload.session_id !== current.sessionId
                ) {
                  return current;
                }

                return null;
              }),
          ),
        );

        unbindRef.current.push(
          bindSocket<{ session_id?: string; from_core_user_id?: string }>(
            socket,
            'call:ended',
            (payload) => {
              const current = activeRef.current;

              if (!current) return;

              if (
                payload.from_core_user_id &&
                payload.from_core_user_id !== current.peerCoreUserId
              ) {
                return;
              }

              if (
                payload.session_id &&
                payload.session_id !== current.sessionId
              ) {
                return;
              }

              teardown();
              setActive(null);
              void leaveSession(current.sessionId);
            },
          ),
        );

        unbindRef.current.push(
          bindSocket<{
            from_core_user_id: string;
            kind: 'offer' | 'answer' | 'ice' | 'renegotiate';
            data: unknown;
          }>(socket, 'rtc:signal', async (payload) => {
            const connectionInstance = peer.current;

            if (!connectionInstance) return;

            if (payload.kind === 'renegotiate') {
              // ไม่มีใครส่งมาแล้ว (ยื่นเองได้ทั้งคู่) แต่ยังรับไว้เพราะสัญญา
              // ของหลังบ้านยังประกาศชนิดนี้อยู่ — ถือเป็น "ช่วยยื่นที"
              await makeOffer();

              return;
            }

            if (payload.kind === 'offer' || payload.kind === 'answer') {
              const description = payload.data as RTCSessionDescriptionInit;

              // ทั้งสองฝั่งยื่นเองได้ จึงมีจังหวะที่ยื่นชนกัน ฝ่ายที่ไม่ยอม
              // ถอยจะเมินของอีกฝ่าย ส่วนฝ่ายที่ยอมถอยจะทิ้งของตัวเองแล้วรับ
              // ของเขา (setRemoteDescription ม้วนกลับให้เอง)
              ignoredOffer.current =
                description.type === 'offer' &&
                shouldIgnoreOffer({
                  polite: polite.current,
                  makingOffer: makingOffer.current,
                  signalingState: connectionInstance.signalingState,
                });

              if (ignoredOffer.current) return;

              await connectionInstance.setRemoteDescription(description);

              if (description.type === 'offer') {
                await connectionInstance.setLocalDescription();

                socket.emit('rtc:signal', {
                  to_core_user_id: payload.from_core_user_id,
                  kind: 'answer',
                  data: connectionInstance.localDescription,
                });
              }

              return;
            }

            try {
              await connectionInstance.addIceCandidate(
                payload.data as RTCIceCandidateInit,
              );
            } catch {
              // candidate ที่มาก่อน remote description หรือของรอบที่เราเมินไป
              // ถูกปฏิเสธ ซึ่งไม่เป็นไร เบราว์เซอร์ส่งชุดใหม่มาอีก
            }
          }),
        );
      } catch {
        // ต่อ socket ไม่ได้ = ยังใช้แอปได้ แค่ไม่มีสายเข้า
      }
    })();

    return () => {
      cancelled = true;

      // ถอดเฉพาะ handler ของตัวเอง — หน้าจออื่นฟัง event เดียวกันบน
      // socket ตัวเดียวกันอยู่ ถ้า off ทั้ง event จะลบของเขาไปด้วย
      for (const off of unbindRef.current) {
        off();
      }

      unbindRef.current = [];
    };
  }, [teardown, leaveSession, makeOffer]);

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  // ปิดแท็บ = ปล่อยไมค์ ไม่งั้นไฟไมค์ยังติดค้าง
  useEffect(() => teardown, [teardown]);

  // ต่อเสียงของอีกฝ่ายเข้ากับ <audio> · deafen = ปิดเสียงขาเข้าทั้งหมด
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.srcObject = remoteStream;
      audioRef.current.muted = deafened;
    }
  }, [remoteStream, deafened]);

  function toggleMute() {
    const next = !muted;

    for (const track of localStream.current?.getAudioTracks() ?? []) {
      track.enabled = !next;
    }

    setMuted(next);
  }

  /// เลิกแชร์ให้เรียบร้อยทุกทาง
  ///
  /// **บั๊กที่ตัวนี้แก้: หยุดแชร์จากแถบของเบราว์เซอร์แล้วอีกฝ่ายเห็นภาพค้าง**
  ///
  /// ของเดิมทางนี้ (`track.onended`) แค่คืนสิทธิ์กับปรับ state ไม่ได้ถอน
  /// แทร็กออกจากสายและไม่เจรจาใหม่ — sender ยังอยู่และ SDP ยังบอกว่ามีช่อง
  /// วิดีโอ ฝั่งผู้ชมจึงค้างที่เฟรมสุดท้ายแทนที่จะหายไป ซึ่งอันตรายกว่าที่คิด
  /// เพราะผู้แชร์เชื่อว่าหยุดแล้ว แต่ปลายทางยังเห็นจอค้างอยู่
  const stopPresenting = useCallback(async (sessionId: string) => {
    const tracks = screenStream.current?.getTracks() ?? [];
    const trackIds = new Set(tracks.map((track) => track.id));

    for (const sender of peer.current?.getSenders() ?? []) {
      if (sender.track && trackIds.has(sender.track.id)) {
        peer.current?.removeTrack(sender);
      }
    }

    for (const track of tracks) {
      track.stop();
    }

    screenStream.current = null;
    socketRef.current?.emit('screen:release', { session_id: sessionId });
    setScreenPreview(null);
    setPresenting(false);

    await makeOffer();
  }, [makeOffer]);

  async function toggleScreen() {
    const socket = socketRef.current;

    if (!active || !socket) return;

    if (presenting) {
      await stopPresenting(active.sessionId);

      return;
    }

    try {
      const claim = await emitWithAck<{ ok: boolean; error?: string }>(
        socket,
        'screen:claim',
        { session_id: active.sessionId },
      );

      if (!claim.ok) {
        setError(claim.error ?? 'แชร์หน้าจอไม่สำเร็จ');

        return;
      }

      screenStream.current = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      });

      for (const track of screenStream.current.getVideoTracks()) {
        peer.current?.addTrack(track, screenStream.current);

        // ผู้ใช้กดหยุดแชร์จากแถบของเบราว์เซอร์เองได้ — ต้องเก็บให้เหมือน
        // กดหยุดในแอปทุกประการ ไม่ใช่แค่คืนสิทธิ์
        track.onended = () => void stopPresenting(active.sessionId);
      }

      // ให้ผู้แชร์เห็นทันทีว่าเลือกจอไหนไป — ก่อนหน้านี้ต้องเชื่อใจว่าเลือกถูก
      setScreenPreview(screenStream.current);
      setPresenting(true);

      // เพิ่มแทร็กแล้วต้องเจรจาใหม่ ไม่งั้นอีกฝ่ายไม่ได้รับภาพเลย
      // (เรียกตรง ๆ ไม่พึ่ง onnegotiationneeded อย่างเดียว เพราะลำดับการยิง
      //  ของมันต่างกันในแต่ละเบราว์เซอร์)
      await makeOffer();
    } catch {
      // ผู้ใช้กดยกเลิกหน้าต่างเลือกจอ — ต้องคืนสิทธิ์ ไม่งั้นห้องจะล็อกไว้
      socket.emit('screen:release', { session_id: active.sessionId });
      setPresenting(false);
    }
  }

  const participants: VoiceParticipant[] = active
    ? [
        {
          coreUserId: me.id,
          isMe: true,
          isMuted: muted,
          isPresenting: presenting,
          connection: 'connected',
        },
        {
          coreUserId: active.peerCoreUserId,
          stream: remoteStream,
          connection: active.ringing ? 'connecting' : connection,
        },
      ]
    : [];

  const value = useMemo(
    () => ({ startCall, inCall: active !== null, error }),
    [startCall, active, error],
  );

  return (
    <CallContext.Provider value={value}>
      {children}

      {/* เสียงของอีกฝ่าย — ซ่อนไว้ ผู้ใช้ไม่ต้องเห็นตัวเล่น */}
      <audio ref={audioRef} autoPlay playsInline className="hidden">
        <track kind="captions" label="เสียงในสาย" />
      </audio>

      {incoming && (
        <IncomingCallSheet
          from={incoming.fromCoreUserId}
          onAccept={() => void accept()}
          onDecline={decline}
        />
      )}

      {active && (
        <div className="fixed bottom-4 right-4 z-90 w-[min(24rem,calc(100vw-2rem))]">
          {/* จอที่แชร์กันในสาย — วางเหนือแผงควบคุมในคอลัมน์เดียวกัน
            * ไม่ปล่อยให้มันลอยเองที่มุมจอ ไม่งั้นจะทับแผงควบคุมพอดี
            * แชร์ได้ทีละคนอยู่แล้ว (หลังบ้านคุมสิทธิ์) จึงไม่มีทางซ้อนกันสองจอ */}
          {screenPreview ? (
            <ScreenStage
              inline
              stream={screenPreview}
              presenterCoreUserId={null}
              onStopSharing={() => void toggleScreen()}
            />
          ) : remoteVideo ? (
            <ScreenStage
              inline
              stream={remoteVideo}
              presenterCoreUserId={active.peerCoreUserId}
            />
          ) : null}

          {active.ringing && (
            <p className="mb-2 rounded-lg bg-card px-3 py-2 text-center text-sm text-muted-foreground shadow-sm">
              กำลังโทรหา {active.peerCoreUserId}…
            </p>
          )}

          {/* ปัญหาที่เกิด **ระหว่างอยู่ในสาย** ต้องเห็นตอนอยู่ในสาย */}
          {error && <ErrorNotice message={error} onDismiss={() => setError(null)} />}

          <VoiceChat
            participants={participants}
            localStream={micStream}
            muted={muted}
            deafened={deafened}
            presenting={presenting}
            startedAt={active.session.started_at}
            turnAvailable={active.session.turn_available}
            onToggleMute={toggleMute}
            onToggleDeafen={() => setDeafened((value) => !value)}
            onToggleScreen={() => void toggleScreen()}
            onLeave={() => void hangUp()}
          />
        </div>
      )}

      {error && !active && (
        <div className="fixed bottom-4 right-4 z-90 w-[min(24rem,calc(100vw-2rem))]">
          <ErrorNotice message={error} onDismiss={() => setError(null)} />
        </div>
      )}
    </CallContext.Provider>
  );
}

/// ข้อความผิดพลาดของสาย
///
/// บั๊กที่ตัวนี้แก้: เดิมการแสดงผลถูกครอบด้วย `error && !active`
/// แปลว่า **ทุก error ที่เกิดระหว่างอยู่ในสายถูกทิ้งเงียบ ๆ**
/// — ซึ่งเป็นช่วงที่ต้องบอกมากที่สุด: ต่อสายไม่ติดเพราะไม่มี TURN
/// หรือแชร์หน้าจอไม่ได้เพราะมีคนแชร์ครบแล้ว — ผู้ใช้จึงนั่งมองหน้าจอ
/// "กำลังเชื่อมต่อ" ไปเรื่อย ๆ โดยไม่มีอะไรบอกเลย
function ErrorNotice({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onDismiss}
      // role=alert ทำให้โปรแกรมอ่านหน้าจออ่านขึ้นทันที — คนที่อยู่ในสายอาจไม่ได้มองจอ
      role="alert"
      className="mb-2 block w-full rounded-lg border border-destructive/40 bg-card px-3 py-2 text-left text-sm text-destructive shadow-lg"
    >
      {message}
      <span className="ml-2 text-xs text-muted-foreground">(แตะเพื่อปิด)</span>
    </button>
  );
}

function IncomingCallSheet({
  from,
  onAccept,
  onDecline,
}: {
  from: string;
  onAccept: () => void;
  onDecline: () => void;
}) {
  // สายเข้าเด้งขึ้นมาเองโดยที่ผู้ใช้ไม่ได้สั่ง และแผ่นนี้ถูกวาดไว้ท้าย DOM
  // คนที่ใช้คีย์บอร์ดจึงต้อง Tab ผ่านทั้งหน้ากว่าจะถึงปุ่มรับสาย —
  // กว่าจะถึงสายก็วางไปแล้ว ต้องย้ายโฟกัสมาให้ และ Escape = ปฏิเสธ
  const sheetRef = useModalFocus<HTMLDivElement>(true, onDecline);

  return (
    <div
      ref={sheetRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label={`สายเรียกเข้าจาก ${from}`}
      className="fixed inset-x-0 bottom-4 z-100 mx-auto w-[min(24rem,calc(100vw-2rem))] csmju-surface p-4 shadow-xl outline-none"
    >
      <div className="flex items-center gap-3">
        <span className="grid size-12 shrink-0 animate-pulse place-items-center rounded-full bg-primary text-lg font-semibold text-primary-foreground">
          {from.charAt(0).toUpperCase()}
        </span>

        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{from}</span>
          <span className="block text-sm text-muted-foreground">
            สายเรียกเข้า…
          </span>
        </span>
      </div>

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={onDecline}
          className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-border px-3 py-2.5 text-sm font-medium transition-colors hover:bg-destructive/10 hover:text-destructive"
        >
          <PhoneOff className="size-4" />
          ปฏิเสธ
        </button>

        <button
          type="button"
          onClick={onAccept}
          className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          <Phone className="size-4" />
          รับสาย
        </button>
      </div>
    </div>
  );
}
