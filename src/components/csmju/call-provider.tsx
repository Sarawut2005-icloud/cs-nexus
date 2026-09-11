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
import { getIdentity } from '@/lib/csmju/identity';
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
  fromUsername: string;
}

interface ActiveCall {
  sessionId: string;
  channelId: string;
  peerUsername: string;
  session: JoinVoiceResponse;
  /// true = เราเป็นฝ่ายโทรออก และยังรออีกฝ่ายรับ
  ringing: boolean;
}

interface CallContextValue {
  startCall: (channelId: string, peerUsername: string) => Promise<void>;
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

  /// ฝั่งไหนเป็นคนยื่นข้อเสนอ — ตัดสินครั้งเดียวตอนเปิดสาย
  const isOfferer = useRef(false);
  const unbindRef = useRef<(() => void)[]>([]);
  const me = getIdentity();

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
    negotiationReady.current = false;
    isOfferer.current = false;

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
  const negotiate = useCallback(async () => {
    const connectionInstance = peer.current;
    const socket = socketRef.current;
    const current = activeRef.current;

    if (!connectionInstance || !socket || !current) return;
    if (!negotiationReady.current) return;

    if (!isOfferer.current) {
      // เราไม่ใช่ฝ่ายยื่น — ขอให้อีกฝั่งเปิดรอบใหม่แทน
      socket.emit('rtc:signal', {
        to_username: current.peerUsername,
        kind: 'renegotiate',
        data: null,
      });

      return;
    }

    try {
      const offer = await connectionInstance.createOffer();

      await connectionInstance.setLocalDescription(offer);

      // ต้องรอ ack — หลังบ้านปฏิเสธการส่งต่อได้ (เช่นอีกฝ่ายออกจากห้องไปแล้ว)
      // แล้วเดิมเราทิ้งคำตอบนั้น ผู้ใช้จึงเห็นแต่ "กำลังเชื่อมต่อ" ค้างไว้
      // โดยไม่มีอะไรบอกว่าเกิดอะไรขึ้น
      const relayed = await emitWithAck<{ ok: boolean; error?: string }>(
        socket,
        'rtc:signal',
        {
          to_username: current.peerUsername,
          kind: 'offer',
          data: offer,
        },
      );

      if (!relayed.ok) {
        setError(relayed.error ?? 'ส่งสัญญาณเสียงไม่ถึงอีกฝ่าย');
      }
    } catch {
      setError('เปิดการเชื่อมต่อเสียงไม่สำเร็จ — ลองวางแล้วโทรใหม่');
    }
  }, []);

  /// สร้างสาย P2P หนึ่งเส้น
  ///
  /// `shouldOffer` ตัดสินด้วยการเทียบชื่อผู้ใช้ ทำให้ทั้งสองฝั่งได้ผลเหมือนกัน
  /// โดยไม่ต้องคุยกันก่อน — กันกรณีทั้งคู่ยื่น offer พร้อมกันแล้วสายไม่ติด
  const openPeer = useCallback(
    (
      socket: Socket,
      session: JoinVoiceResponse,
      peerUsername: string,
      shouldOffer: boolean,
    ) => {
      const connectionInstance = new RTCPeerConnection({
        iceServers: session.ice_servers.map((server) => ({
          urls: server.urls,
          username: server.username,
          credential: server.credential,
        })),
      });

      peer.current = connectionInstance;
      isOfferer.current = shouldOffer;

      for (const track of localStream.current?.getTracks() ?? []) {
        connectionInstance.addTrack(track, localStream.current!);
      }

      connectionInstance.onicecandidate = (event) => {
        if (!event.candidate) return;

        socket.emit('rtc:signal', {
          to_username: peerUsername,
          kind: 'ice',
          data: event.candidate.toJSON(),
        });
      };

      connectionInstance.ontrack = (event) => {
        setRemoteStream(event.streams[0] ?? null);
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
      connectionInstance.onnegotiationneeded = () => void negotiate();

      return connectionInstance;
    },
    [negotiate],
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
    async (channelId: string, peerUsername: string) => {
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
          peerUsername,
          session,
          ringing: true,
        });

        openPeer(socket, session, peerUsername, me.username < peerUsername);

        const ring = await emitWithAck<{ ok: boolean; error?: string }>(
          socket,
          'call:ring',
          { session_id: session.id, to_username: peerUsername },
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
    [enterSession, openPeer, teardown, leaveSession, me.username],
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
        to_username: current.peerUsername,
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
          to_username: previous.peerUsername,
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
        peerUsername: call.fromUsername,
        session,
        ringing: false,
      });

      openPeer(
        socket,
        session,
        call.fromUsername,
        me.username < call.fromUsername,
      );

      // ผู้โทรอยู่ในห้องมาตั้งแต่ก่อนส่งกริ่ง และเราเพิ่งเข้ามา = ครบสองฝ่าย
      negotiationReady.current = true;

      socket.emit('call:answer', {
        session_id: call.sessionId,
        to_username: call.fromUsername,
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
  }, [
    incoming,
    enterSession,
    openPeer,
    teardown,
    leaveSession,
    me.username,
  ]);

  const decline = useCallback(() => {
    const call = incoming;

    if (!call) return;

    socketRef.current?.emit('call:answer', {
      session_id: call.sessionId,
      to_username: call.fromUsername,
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
            from_username: string;
          }>(socket, 'call:incoming', (payload) => {
            setIncoming({
              sessionId: payload.session_id,
              channelId: payload.channel_id,
              fromUsername: payload.from_username,
            });
          }),
        );

        unbindRef.current.push(
          bindSocket<{
            accepted: boolean;
            from_username: string;
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

              if (payload.from_username !== activeRef.current.peerUsername) {
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

                setError(`${payload.from_username} ปฏิเสธสาย`);
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
              void negotiate();
            },
          ),
        );

        unbindRef.current.push(
          bindSocket<{ session_id?: string; from_username?: string }>(
            socket,
            'call:cancelled',
            (payload) =>
              // เฉพาะสายที่กำลังดังอยู่จริงเท่านั้น ไม่ใช่ทุกอย่างที่ลอยเข้ามา
              setIncoming((current) => {
                if (!current) return current;

                if (
                  payload.from_username &&
                  payload.from_username !== current.fromUsername
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
          bindSocket<{ session_id?: string; from_username?: string }>(
            socket,
            'call:ended',
            (payload) => {
              const current = activeRef.current;

              if (!current) return;

              if (
                payload.from_username &&
                payload.from_username !== current.peerUsername
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
            from_username: string;
            kind: 'offer' | 'answer' | 'ice' | 'renegotiate';
            data: unknown;
          }>(socket, 'rtc:signal', async (payload) => {
            const connectionInstance = peer.current;

            if (!connectionInstance) return;

            if (payload.kind === 'offer') {
              await connectionInstance.setRemoteDescription(
                payload.data as RTCSessionDescriptionInit,
              );

              const answer = await connectionInstance.createAnswer();

              await connectionInstance.setLocalDescription(answer);

              socket.emit('rtc:signal', {
                to_username: payload.from_username,
                kind: 'answer',
                data: answer,
              });

              return;
            }

            if (payload.kind === 'answer') {
              await connectionInstance.setRemoteDescription(
                payload.data as RTCSessionDescriptionInit,
              );

              return;
            }

            if (payload.kind === 'renegotiate') {
              // อีกฝ่ายเพิ่มแทร็กแต่ยื่นข้อเสนอเองไม่ได้ — เราเปิดรอบให้
              await negotiate();

              return;
            }

            try {
              await connectionInstance.addIceCandidate(
                payload.data as RTCIceCandidateInit,
              );
            } catch {
              // candidate ที่มาก่อน remote description ถูกปฏิเสธ ซึ่งไม่เป็นไร
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
  }, [teardown, leaveSession, negotiate]);

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

  async function toggleScreen() {
    const socket = socketRef.current;

    if (!active || !socket) return;

    if (presenting) {
      for (const track of screenStream.current?.getTracks() ?? []) {
        track.stop();
      }

      screenStream.current = null;
      socket.emit('screen:release', { session_id: active.sessionId });
      setPresenting(false);

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

        // ผู้ใช้กดหยุดแชร์จากแถบของเบราว์เซอร์เองได้ ต้องคืนสิทธิ์ตามด้วย
        track.onended = () => {
          socket.emit('screen:release', { session_id: active.sessionId });
          screenStream.current = null;
          setPresenting(false);
        };
      }

      setPresenting(true);

      // เพิ่มแทร็กแล้วต้องเจรจาใหม่ ไม่งั้นอีกฝ่ายไม่ได้รับภาพเลย
      // (เรียกตรง ๆ ไม่พึ่ง onnegotiationneeded อย่างเดียว เพราะลำดับการยิง
      //  ของมันต่างกันในแต่ละเบราว์เซอร์)
      await negotiate();
    } catch {
      // ผู้ใช้กดยกเลิกหน้าต่างเลือกจอ — ต้องคืนสิทธิ์ ไม่งั้นห้องจะล็อกไว้
      socket.emit('screen:release', { session_id: active.sessionId });
      setPresenting(false);
    }
  }

  const participants: VoiceParticipant[] = active
    ? [
        {
          username: me.username,
          isMe: true,
          isMuted: muted,
          isPresenting: presenting,
          connection: 'connected',
        },
        {
          username: active.peerUsername,
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
          from={incoming.fromUsername}
          onAccept={() => void accept()}
          onDecline={decline}
        />
      )}

      {active && (
        <div className="fixed bottom-4 right-4 z-90 w-[min(24rem,calc(100vw-2rem))]">
          {active.ringing && (
            <p className="mb-2 rounded-lg bg-card px-3 py-2 text-center text-sm text-muted-foreground shadow-sm">
              กำลังโทรหา {active.peerUsername}…
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
      className="fixed inset-x-0 bottom-4 z-100 mx-auto w-[min(24rem,calc(100vw-2rem))] rounded-2xl border border-border bg-card p-4 shadow-xl outline-none"
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
