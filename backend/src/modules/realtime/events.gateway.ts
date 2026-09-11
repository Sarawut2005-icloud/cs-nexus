import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import {
  GATEWAY_HEADERS,
  LAYER1_ROLES,
  type GatewayUser,
  type Layer1Role,
} from '../../common/auth/gateway-user.js';
import { RealtimeBus } from '../../common/realtime/realtime-bus.js';
import {
  SOCKET_NAMESPACE,
  userRoom,
  type JoinResult,
  type MessageEvent,
  type RtcSignalPayload,
  type ScreenClaimResult,
  type SendMessagePayload,
  type SendResult,
} from '../../common/realtime/events.js';
import { ChannelsService } from '../channels/channels.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { MAX_SCREEN_VIEWERS } from '../voice/dto/voice.dto.js';
import { VoiceService } from '../voice/voice.service.js';
import { MessagesService } from '../channels/messages.service.js';
import { RealtimeTicketsService } from './realtime-tickets.service.js';

/// จำกัดอัตราการส่งข้อความต่อ socket — กันสแปมห้องและกันคนเขียน bot ยิงรัว
const RATE_LIMIT_MESSAGES = 20;
const RATE_LIMIT_WINDOW_MS = 10_000;

interface SocketState {
  user: GatewayUser;
  /// เวลาที่ส่งข้อความล่าสุด ใช้ทำ sliding window แบบง่าย
  sentAt: number[];
  /// ห้องที่ socket นี้อยู่ ณ ตอนที่กำลังจะหลุด
  ///
  /// ต้องจำไว้เองเพราะ `socket.rooms` ว่างแล้วตอน handleDisconnect ทำงาน
  /// (รายละเอียดอยู่ที่ handleConnection)
  roomsAtDisconnect: string[];
}

/// Socket.io อยู่ในโพรเซสเดียวกับ REST ได้เพราะ NestJS เป็นเซิร์ฟเวอร์ที่รันค้าง
/// ต่างจาก Next.js บน Vercel ที่เป็น serverless จึงถือ WebSocket ไม่ได้
///
/// ข้อจำกัดที่ต้องรู้: presence และ rate limit เก็บในหน่วยความจำของโพรเซสนี้
/// ถ้าสเกลเป็นหลาย instance ต้องเพิ่ม Redis adapter ของ Socket.io
@WebSocketGateway({
  namespace: SOCKET_NAMESPACE,
  cors: { origin: process.env.CORS_ORIGIN?.split(',') ?? true },
})
export class EventsGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer() private server!: Server;

  private readonly logger = new Logger(EventsGateway.name);
  private readonly sockets = new Map<string, SocketState>();

  /// จำนวน socket ที่เปิดอยู่ต่อผู้ใช้หนึ่งคน
  ///
  /// นับ ไม่ใช่เก็บเป็น Set ของ username เพราะคนหนึ่งเปิดได้หลายแท็บ —
  /// ถ้าใช้ Set แล้วลบตอนแท็บใดแท็บหนึ่งปิด เขาจะกลายเป็นออฟไลน์ทั้งที่
  /// ยังเปิดอีกแท็บอยู่ ซึ่งเป็นบั๊ก presence ที่พบบ่อยที่สุด
  private readonly socketsPerUser = new Map<string, number>();

  /// ใครกำลังแชร์หน้าจอในแต่ละห้องเสียง — หนึ่งห้องได้คนเดียว
  private readonly presenters = new Map<string, string>();

  constructor(
    private readonly tickets: RealtimeTicketsService,
    private readonly channels: ChannelsService,
    private readonly messages: MessagesService,
    private readonly voice: VoiceService,
    private readonly bus: RealtimeBus,
    private readonly notifications: NotificationsService,
  ) {}

  /// ยืนยันตัวตนตอนจับมือ — สองทาง ทางไหนก็ไม่ได้ verify JWT เอง
  ///
  ///   1. header จาก API Gateway (ถ้า Gateway proxy WebSocket ให้)
  ///   2. ตั๋วที่ขอมาทาง REST ก่อนหน้า (ถ้า WS ไม่ผ่าน Gateway)
  ///
  /// ทำเป็น middleware ไม่ใช่ทำใน handleConnection เพราะ middleware ปฏิเสธได้
  /// "ก่อน" การเชื่อมต่อจะสำเร็จ ทำให้ client ได้ connect_error ที่อ่านรู้เรื่อง
  /// ถ้าไปเตะออกใน handleConnection client จะเห็นว่าต่อติดแล้วหลุดเอง
  /// ซึ่งแยกไม่ออกจากเน็ตมีปัญหา
  afterInit(server: Server): void {
    server.use((socket, next) => {
      try {
        const user = this.identify(socket as Socket);

        this.sockets.set(socket.id, { user, sentAt: [], roomsAtDisconnect: [] });
        next();
      } catch (error) {
        next(
          error instanceof Error
            ? error
            : new Error('ยืนยันตัวตนไม่สำเร็จ'),
        );
      }
    });

    // รับเหตุการณ์จากชั้นข้อมูลผ่าน bus — ฝั่งนั้นไม่รู้จัก gateway นี้เลย
    // (ดูเหตุผลเรื่องวงจร import ใน common/realtime/realtime-bus.ts)
    // ออกจากห้องผ่าน REST แล้ว socket ต้องออกตามด้วย
    this.bus.evictions.subscribe((eviction) => {
      for (const [socketId, state] of this.sockets) {
        if (state.user.username !== eviction.username) {
          continue;
        }

        void server.in(socketId).socketsLeave(eviction.room);
      }

      void this.broadcastPresence(eviction.room);
    });

    this.bus.userEvents.subscribe((push) => {
      server.to(userRoom(push.username)).emit('notification:new', {
        notification: push.notification,
        unread_count: push.unread_count,
      });
    });

    this.bus.roomEvents.subscribe((event) => {
      server.to(event.room).emit(event.event, event.payload);
    });
  }

  handleConnection(socket: Socket): void {
    const state = this.sockets.get(socket.id);

    if (!state) {
      return;
    }

    // เข้าห้องส่วนตัวทันทีที่ต่อติด เพื่อรับการแจ้งเตือนได้โดยไม่ต้องเปิดห้องแชทไว้
    void socket.join(userRoom(state.user.username));

    // จดห้องไว้ตอน 'disconnecting' เพราะตอน 'disconnect' มันว่างไปแล้ว
    //
    // ลำดับจริงใน socket.io (dist/socket.js `_onclose`) คือ
    //   emit('disconnecting') → _cleanup() ซึ่งเรียก leaveAll() → emit('disconnect')
    // ส่วน OnGatewayDisconnect ของ Nest ผูกกับ 'disconnect' ตัวหลัง
    // `socket.rooms` (ซึ่งอ่านจาก adapter.socketRooms) จึงคืน Set ว่างเสมอ
    //
    // ผลของบั๊กนี้: ลูป broadcastPresence ใน handleDisconnect ไม่เคยทำงานเลย
    // คนที่ปิดแท็บหรือเน็ตหลุดยังค้างอยู่ในรายชื่อ "ใครอยู่ในห้อง" ของทุกคน
    socket.on('disconnecting', () => {
      const current = this.sockets.get(socket.id);

      if (current) {
        current.roomsAtDisconnect = [...socket.rooms];
      }
    });

    const before = this.socketsPerUser.get(state.user.username) ?? 0;

    this.socketsPerUser.set(state.user.username, before + 1);

    // แจ้งทั้งระบบเฉพาะตอนเปลี่ยนจาก "ไม่มีแท็บเลย" เป็น "มีแท็บแรก"
    if (before === 0) {
      this.server.emit('presence:changed', {
        username: state.user.username,
        online: true,
      });
    }

    this.logger.log(`${state.user.username} เชื่อมต่อแล้ว (${socket.id})`);
  }

  /// ใครออนไลน์อยู่ตอนนี้ — ให้ชั้น REST เรียกตอนหน้าจอโหลดครั้งแรก
  ///
  /// ต้องมีทั้ง REST และ event: event บอกการเปลี่ยนแปลง แต่ผู้ใช้ที่เพิ่ง
  /// เปิดหน้าไม่เคยได้ยิน event ของคนที่ออนไลน์อยู่ก่อนแล้ว
  onlineUsernames(): string[] {
    return [...this.socketsPerUser.entries()]
      .filter(([, count]) => count > 0)
      .map(([username]) => username);
  }

  handleDisconnect(socket: Socket): void {
    const state = this.sockets.get(socket.id);

    this.sockets.delete(socket.id);

    if (!state) {
      return;
    }

    const remaining = (this.socketsPerUser.get(state.user.username) ?? 1) - 1;

    if (remaining <= 0) {
      this.socketsPerUser.delete(state.user.username);
      this.server.emit('presence:changed', {
        username: state.user.username,
        online: false,
      });
    } else {
      this.socketsPerUser.set(state.user.username, remaining);
    }

    // ปิดแท็บทิ้งโดยไม่กดออกจากห้องเสียง = ที่นั่งค้าง ทำให้ห้องเต็มทั้งที่ไม่มีคน
    //
    // ปล่อยที่นั่งเฉพาะเมื่อไม่มีแท็บเหลือแล้ว ไม่งั้นปิดแท็บที่ไม่ได้อยู่ใน
    // สายจะเตะตัวเองออกจากสายที่คุยอยู่ในอีกแท็บ
    if (remaining <= 0) {
      void this.releaseVoice(state.user.username);
    }

    // แจ้งทุกห้องที่ socket นี้อยู่ ว่ามีคนออกไปแล้ว
    const personalRoom = userRoom(state.user.username);

    for (const room of state.roomsAtDisconnect) {
      // ข้ามห้องส่วนตัว — มันไม่ใช่ห้องแชท จึงไม่มี presence ให้กระจาย
      if (room !== socket.id && room !== personalRoom) {
        void this.broadcastPresence(room);
      }
    }
  }

  @SubscribeMessage('channel:join')
  async onJoin(
    @ConnectedSocket() socket: Socket,
    @MessageBody() payload: { channel_id?: string },
  ): Promise<JoinResult> {
    const state = this.sockets.get(socket.id);

    if (!state || !payload?.channel_id) {
      return { ok: false, error: 'คำขอไม่ถูกต้อง' };
    }

    try {
      // เช็คสมาชิกด้วยตรรกะชุดเดียวกับ REST — ไม่เขียนกฎซ้ำสองที่
      await this.channels.requireMembership(state.user, payload.channel_id);
    } catch {
      return { ok: false, error: 'คุณไม่ได้เป็นสมาชิกห้องนี้' };
    }

    await socket.join(payload.channel_id);
    await this.broadcastPresence(payload.channel_id);

    return {
      ok: true,
      latest_seq: await this.messages.latestSeq(payload.channel_id),
    };
  }

  @SubscribeMessage('channel:leave')
  async onLeave(
    @ConnectedSocket() socket: Socket,
    @MessageBody() payload: { channel_id?: string },
  ): Promise<void> {
    if (!payload?.channel_id) {
      return;
    }

    await socket.leave(payload.channel_id);
    await this.broadcastPresence(payload.channel_id);
  }

  @SubscribeMessage('message:send')
  async onSend(
    @ConnectedSocket() socket: Socket,
    @MessageBody() payload: SendMessagePayload,
  ): Promise<SendResult> {
    const state = this.sockets.get(socket.id);
    const nonce = payload?.client_nonce ?? '';

    if (!state) {
      return { ok: false, client_nonce: nonce, error: 'ยังไม่ได้ยืนยันตัวตน' };
    }

    if (!this.allowSend(state)) {
      return {
        ok: false,
        client_nonce: nonce,
        error: 'ส่งข้อความถี่เกินไป รอสักครู่แล้วลองใหม่',
      };
    }

    try {
      // ตัวตนมาจาก state ของ socket ที่ยืนยันตอนจับมือ
      // ไม่ใช่จาก payload — ถ้าเชื่อ payload ใครก็ส่งข้อความในนามคนอื่นได้
      const message = await this.messages.send(
        state.user,
        payload.channel_id,
        {
          content: payload.content,
          asset_ids: payload.asset_ids,
          embed: payload.embed,
          parent_id: payload.parent_id,
          client_nonce: payload.client_nonce,
        },
      );

      // เขียนฐานข้อมูลสำเร็จแล้วค่อยกระจาย — ลำดับนี้ห้ามสลับ
      this.server.to(payload.channel_id).emit('message:new', message);

      // คำตอบในเธรดไม่ขึ้นไทม์ไลน์หลัก แต่ต้องบอกให้ตัวเลข "n คำตอบ"
      // ที่ข้อความต้นเธรดขยับ ไม่งั้นคนที่เปิดห้องอยู่จะไม่รู้ว่ามีคนตอบ
      if (message.parent_id) {
        this.server.to(payload.channel_id).emit('thread:updated', {
          channel_id: payload.channel_id,
          parent_id: message.parent_id,
        });
      }

      return {
        ok: true,
        client_nonce: message.client_nonce,
        message_id: message.id,
        seq: message.seq,
      };
    } catch (error) {
      return {
        ok: false,
        client_nonce: nonce,
        error:
          error instanceof Error ? error.message : 'ส่งข้อความไม่สำเร็จ',
      };
    }
  }

  @SubscribeMessage('typing:start')
  onTyping(
    @ConnectedSocket() socket: Socket,
    @MessageBody() payload: { channel_id?: string },
  ): void {
    const state = this.sockets.get(socket.id);

    if (!state || !payload?.channel_id || !socket.rooms.has(payload.channel_id)) {
      return;
    }

    socket.to(payload.channel_id).emit('typing:sync', {
      channel_id: payload.channel_id,
      username: state.user.username,
    });
  }

  /// ส่งต่อสัญญาณ WebRTC ระหว่างสองเบราว์เซอร์
  ///
  /// เซิร์ฟเวอร์ไม่แตะเสียงหรือภาพเลย ทำหน้าที่แค่พาสองฝ่ายมาเจอกัน
  /// เงื่อนไขเดียวที่ยอมส่งต่อคือ "สองคนนี้อยู่ห้องเสียงเดียวกันจริง"
  /// ถ้าไม่เช็ค จะยิง SDP ไปหาใครก็ได้ในระบบ ซึ่งเป็นทั้งช่องกวนคนอื่น
  /// และช่องให้รู้ IP ของคนอื่น
  @SubscribeMessage('rtc:signal')
  async onRtcSignal(
    @ConnectedSocket() socket: Socket,
    @MessageBody() payload: RtcSignalPayload,
  ): Promise<{ ok: boolean; error?: string }> {
    const state = this.sockets.get(socket.id);

    if (!state || !payload?.to_username) {
      return { ok: false, error: 'คำขอไม่ถูกต้อง' };
    }

    if (payload.to_username === state.user.username) {
      return { ok: false, error: 'ส่งสัญญาณหาตัวเองไม่ได้' };
    }

    const sessionId = await this.voice.sharesVoiceSession(
      state.user.username,
      payload.to_username,
    );

    if (!sessionId) {
      return { ok: false, error: 'ปลายทางไม่ได้อยู่ในห้องเสียงเดียวกับคุณ' };
    }

    let delivered = false;

    for (const [socketId, other] of this.sockets) {
      if (other.user.username !== payload.to_username) {
        continue;
      }

      this.server.to(socketId).emit('rtc:signal', {
        ...payload,
        from_username: state.user.username,
      });
      delivered = true;
    }

    return delivered
      ? { ok: true }
      : { ok: false, error: 'ปลายทางไม่ได้ออนไลน์อยู่' };
  }

  /// จับจองสิทธิ์แชร์หน้าจอ — หนึ่งห้องแชร์ได้ทีละคน
  ///
  /// เหตุผลไม่ใช่เรื่อง UI แต่เป็นเรื่องแบนด์วิดท์: mesh ทำให้คนแชร์ต้องส่ง
  /// ภาพให้ทุกคนพร้อมกัน ถ้าสองคนแชร์พร้อมกันเน็ตของทั้งห้องจะพัง
  @SubscribeMessage('screen:claim')
  async onScreenClaim(
    @ConnectedSocket() socket: Socket,
    @MessageBody() payload: { session_id?: string },
  ): Promise<ScreenClaimResult> {
    const state = this.sockets.get(socket.id);

    if (!state || !payload?.session_id) {
      return { ok: false, error: 'คำขอไม่ถูกต้อง' };
    }

    const mySession = await this.voice.activeSessionOf(state.user.username);

    if (mySession !== payload.session_id) {
      return { ok: false, error: 'คุณไม่ได้อยู่ในห้องเสียงนี้' };
    }

    const current = this.presenters.get(payload.session_id);

    if (current && current !== state.user.username) {
      return {
        ok: false,
        presenter_username: current,
        error: 'มีคนกำลังแชร์หน้าจออยู่ รอให้เขาหยุดก่อน',
      };
    }

    this.presenters.set(payload.session_id, state.user.username);
    this.server.emit('screen:changed', {
      session_id: payload.session_id,
      presenter_username: state.user.username,
    });

    return {
      ok: true,
      presenter_username: state.user.username,
      max_viewers: MAX_SCREEN_VIEWERS,
    };
  }

  @SubscribeMessage('screen:release')
  onScreenRelease(
    @ConnectedSocket() socket: Socket,
    @MessageBody() payload: { session_id?: string },
  ): void {
    const state = this.sockets.get(socket.id);

    if (!state || !payload?.session_id) {
      return;
    }

    if (this.presenters.get(payload.session_id) === state.user.username) {
      this.presenters.delete(payload.session_id);
      this.server.emit('screen:changed', {
        session_id: payload.session_id,
        presenter_username: null,
      });
    }
  }

  /// เริ่มโทร — ส่งเสียงกริ่งไปหาอีกฝ่าย
  ///
  /// เดิมระบบมีแต่ "เข้าห้องเสียง" ซึ่งเงียบ ผู้ใช้สองคนต้องนัดกันนอกระบบว่า
  /// ใครจะเข้าตอนไหน ตัวนี้เติมขั้น "ก่อนรับสาย" ที่ขาดไป
  ///
  /// สองด่านที่ต้องผ่าน:
  ///   1. ผู้โทรต้องอยู่ใน session นั้นจริง — ไม่งั้นส่งกริ่งในนามห้องที่ไม่ได้อยู่
  ///   2. ผู้รับต้องเป็นสมาชิกห้องเดียวกัน — ไม่งั้นโทรกวนใครก็ได้ในระบบ
  @SubscribeMessage('call:ring')
  async onCallRing(
    @ConnectedSocket() socket: Socket,
    @MessageBody() payload: { session_id?: string; to_username?: string },
  ): Promise<{ ok: boolean; error?: string }> {
    const state = this.sockets.get(socket.id);

    if (!state || !payload?.session_id || !payload?.to_username) {
      return { ok: false, error: 'คำขอไม่ถูกต้อง' };
    }

    if (payload.to_username === state.user.username) {
      return { ok: false, error: 'โทรหาตัวเองไม่ได้' };
    }

    const mySession = await this.voice.activeSessionOf(state.user.username);

    if (mySession !== payload.session_id) {
      return { ok: false, error: 'คุณไม่ได้อยู่ในห้องเสียงนี้' };
    }

    const channelId = await this.voice.channelOfSession(payload.session_id);

    if (!channelId) {
      return { ok: false, error: 'ไม่พบห้องเสียงนี้' };
    }

    const isMember = await this.channels.isMember(
      payload.to_username,
      channelId,
    );

    if (!isMember) {
      // ไม่บอกว่า "เขาไม่ได้อยู่ในห้อง" ตรง ๆ เพราะนั่นคือการยืนยันว่า
      // คนชื่อนี้มีอยู่จริงในระบบให้คนที่เดาชื่อ
      return { ok: false, error: 'โทรหาคนนี้ไม่ได้' };
    }

    this.server.to(userRoom(payload.to_username)).emit('call:incoming', {
      session_id: payload.session_id,
      channel_id: channelId,
      from_username: state.user.username,
    });

    // บันทึกไว้ด้วย เพื่อให้เห็นเป็น "สายที่ไม่ได้รับ" ถ้าเขาไม่ได้ออนไลน์
    // (นี่คือที่ที่ NotificationKind.VOICE_INVITE ถูกใช้จริงเป็นครั้งแรก)
    await this.notifications.push({
      username: payload.to_username,
      kind: 'VOICE_INVITE',
      refId: payload.session_id,
      actorUsername: state.user.username,
      payload: { channel_id: channelId },
    });

    return { ok: true };
  }

  /// ทั้งสองฝั่งของสายต้องเป็นสมาชิกห้องของ session นั้นจริง
  ///
  /// `call:ring` มีด่านนี้มาตั้งแต่แรก แต่ `call:answer` และ `call:cancel`
  /// **ไม่มีเลย** — ใครก็ตามที่ล็อกอินอยู่ส่ง
  /// `call:cancel {to_username: someone}` เพื่อตัดสายที่คนอื่นกำลังเรียกอยู่ได้
  /// หรือส่ง `call:answer {accepted: false}` ให้หน้าจอของเหยื่อขึ้นว่า
  /// อีกฝ่ายปฏิเสธสายทั้งที่เขาไม่ได้ปฏิเสธ
  private async bothInCallChannel(
    fromUsername: string,
    toUsername: string,
    sessionId: string,
  ): Promise<boolean> {
    const channelId = await this.voice.channelOfSession(sessionId);

    if (!channelId) {
      return false;
    }

    const [fromIsMember, toIsMember] = await Promise.all([
      this.channels.isMember(fromUsername, channelId),
      this.channels.isMember(toUsername, channelId),
    ]);

    return fromIsMember && toIsMember;
  }

  /// รับหรือปฏิเสธสาย — ส่งผลกลับให้ผู้โทรรู้ว่าจะต่อสายหรือวาง
  @SubscribeMessage('call:answer')
  async onCallAnswer(
    @ConnectedSocket() socket: Socket,
    @MessageBody()
    payload: { session_id?: string; to_username?: string; accepted?: boolean },
  ): Promise<void> {
    const state = this.sockets.get(socket.id);

    if (!state || !payload?.session_id || !payload?.to_username) {
      return;
    }

    // ผู้รับสายยังไม่ได้เข้า session ตอนตอบ จึงเช็คได้แค่ว่าทั้งคู่เป็นสมาชิก
    // ห้องเดียวกัน — พอที่จะกันคนนอกไม่ให้ตอบแทนคนอื่น
    const allowed = await this.bothInCallChannel(
      state.user.username,
      payload.to_username,
      payload.session_id,
    );

    if (!allowed) {
      return;
    }

    this.server.to(userRoom(payload.to_username)).emit('call:answered', {
      session_id: payload.session_id,
      from_username: state.user.username,
      accepted: payload.accepted === true,
    });
  }

  /// ผู้โทรวางก่อนอีกฝ่ายรับ — ให้ฝั่งนั้นเลิกส่งเสียงกริ่ง
  @SubscribeMessage('call:cancel')
  async onCallCancel(
    @ConnectedSocket() socket: Socket,
    @MessageBody() payload: { session_id?: string; to_username?: string },
  ): Promise<void> {
    const state = this.sockets.get(socket.id);

    if (!state || !payload?.session_id || !payload?.to_username) {
      return;
    }

    // ผู้ยกเลิกคือผู้โทร ซึ่งอยู่ใน session อยู่แล้ว จึงบังคับได้เข้มเท่า
    // call:ring — ถ้าไม่ได้อยู่ในสายนี้ ก็ไม่มีสิทธิ์สั่งให้สายนี้เงียบ
    const mySession = await this.voice.activeSessionOf(state.user.username);

    if (mySession !== payload.session_id) {
      return;
    }

    const allowed = await this.bothInCallChannel(
      state.user.username,
      payload.to_username,
      payload.session_id,
    );

    if (!allowed) {
      return;
    }

    this.server.to(userRoom(payload.to_username)).emit('call:cancelled', {
      session_id: payload.session_id,
      from_username: state.user.username,
    });
  }

  /// วางสายที่รับแล้ว — ให้อีกฝั่งเก็บสายตามด้วย
  ///
  /// เดิมไม่มี event นี้เลย: `call:cancel` ถูกส่งเฉพาะตอนที่ยัง "กำลังเรียก"
  /// อยู่ พอสายถูกรับแล้วฝ่ายที่วางก่อนจะเงียบหายไปโดยไม่บอกใคร อีกฝั่ง
  /// ยังเห็นแผงสายค้างอยู่ ตัวนับเวลายังเดิน ไมค์ยังเปิด และที่นั่งในห้อง
  /// ยังถูกจองไว้ จนกว่าเขาจะกดวางเอง
  @SubscribeMessage('call:end')
  async onCallEnd(
    @ConnectedSocket() socket: Socket,
    @MessageBody() payload: { session_id?: string; to_username?: string },
  ): Promise<void> {
    const state = this.sockets.get(socket.id);

    if (!state || !payload?.session_id || !payload?.to_username) {
      return;
    }

    const mySession = await this.voice.activeSessionOf(state.user.username);

    if (mySession !== payload.session_id) {
      return;
    }

    const allowed = await this.bothInCallChannel(
      state.user.username,
      payload.to_username,
      payload.session_id,
    );

    if (!allowed) {
      return;
    }

    this.server.to(userRoom(payload.to_username)).emit('call:ended', {
      session_id: payload.session_id,
      from_username: state.user.username,
    });
  }

  /// ให้ชั้น REST เรียกเมื่อส่งข้อความผ่าน HTTP เพื่อให้คนที่เปิดห้องอยู่เห็นทันที
  broadcastMessage(channelId: string, message: MessageEvent): void {
    this.server?.to(channelId).emit('message:new', message);
  }

  /// ให้ชั้น REST เรียกเมื่อมีข้อความถูกลบ เพื่อให้คนที่เปิดห้องอยู่เห็นทันที
  notifyMessageDeleted(channelId: string, messageId: string): void {
    this.server
      ?.to(channelId)
      .emit('message:deleted', { channel_id: channelId, message_id: messageId });
  }

  private async releaseVoice(username: string): Promise<void> {
    const sessionIds = await this.voice.leaveAllFor(username);

    for (const sessionId of sessionIds) {
      if (this.presenters.get(sessionId) === username) {
        this.presenters.delete(sessionId);
        this.server.emit('screen:changed', {
          session_id: sessionId,
          presenter_username: null,
        });
      }
    }
  }

  private async broadcastPresence(channelId: string): Promise<void> {
    const socketIds = await this.server.in(channelId).allSockets();
    const usernames = new Set<string>();

    for (const id of socketIds) {
      const state = this.sockets.get(id);

      if (state) {
        usernames.add(state.user.username);
      }
    }

    this.server.to(channelId).emit('presence:sync', {
      channel_id: channelId,
      online_usernames: [...usernames],
    });
  }

  private allowSend(state: SocketState): boolean {
    const now = Date.now();

    state.sentAt = state.sentAt.filter(
      (at) => now - at < RATE_LIMIT_WINDOW_MS,
    );

    if (state.sentAt.length >= RATE_LIMIT_MESSAGES) {
      return false;
    }

    state.sentAt.push(now);

    return true;
  }

  private identify(socket: Socket): GatewayUser {
    const headers = socket.handshake.headers;
    const headerUsername = readHeader(headers, GATEWAY_HEADERS.username);
    const headerRole = readHeader(headers, GATEWAY_HEADERS.layer1Role);

    // ทาง 1: Gateway proxy WebSocket มาให้พร้อม header
    if (headerUsername && headerRole && isLayer1Role(headerRole)) {
      return {
        username: headerUsername,
        layer1Role: headerRole,
        faculty: readHeader(headers, GATEWAY_HEADERS.faculty),
      };
    }

    // ทาง 2: แลกตั๋วที่ขอมาทาง REST
    const ticket =
      (socket.handshake.auth?.ticket as string | undefined) ??
      (socket.handshake.query?.ticket as string | undefined);

    return this.tickets.redeem(ticket);
  }
}

function readHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | null {
  const value = headers[name];
  const raw = Array.isArray(value) ? value[0] : value;
  const trimmed = raw?.trim();

  return trimmed ? trimmed : null;
}

function isLayer1Role(value: string): value is Layer1Role {
  return (LAYER1_ROLES as readonly string[]).includes(value);
}
