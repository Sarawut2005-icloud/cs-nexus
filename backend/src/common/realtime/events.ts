/// สัญญาของ Socket.io — ประกาศที่นี่ที่เดียวแล้วใช้ร่วมกับหน้าบ้าน
///
/// หน้าบ้านให้ import type จากไฟล์นี้ (หรือคัดลอกไปไว้ใน frontend/) เพื่อไม่ให้
/// ชื่อ event เพี้ยนกันคนละฝั่ง ซึ่งเป็นบั๊กที่หายากที่สุดของงานเรียลไทม์
///
/// field ทุกตัวเป็น snake_case เหมือน REST เพื่อให้หน้าบ้านไม่ต้องจำสองแบบ

export const SOCKET_NAMESPACE = '/realtime';

/// ห้องส่วนตัวของผู้ใช้หนึ่งคน — socket ทุกเครื่องของเขาเข้าห้องนี้ตอนต่อ
///
/// ใช้ส่งของที่ "ถึงคน" ไม่ใช่ "ถึงห้อง" เช่นการแจ้งเตือน โดยไม่ต้องวนหา
/// socket id ทีละตัว และทำให้คนที่เปิดทั้งมือถือและคอมได้รับพร้อมกัน
export const userRoom = (username: string) => `user:${username}`;

/// client → server
export interface ClientEvents {
  'channel:join': (
    payload: { channel_id: string },
    ack: (result: JoinResult) => void,
  ) => void;

  'channel:leave': (payload: { channel_id: string }) => void;

  'message:send': (
    payload: SendMessagePayload,
    ack: (result: SendResult) => void,
  ) => void;

  'typing:start': (payload: { channel_id: string }) => void;

  /// ---- WebRTC signaling (mesh P2P) ----
  ///
  /// เซิร์ฟเวอร์เป็นแค่บุรุษไปรษณีย์ ไม่แตะเสียงหรือภาพเลย — เสียงวิ่ง P2P
  /// ระหว่างเบราว์เซอร์โดยตรง นี่คือเหตุผลที่ระบบนี้อยู่บนงบ 0 บาทได้
  'rtc:signal': (
    payload: RtcSignalPayload,
    ack: (result: { ok: boolean; error?: string }) => void,
  ) => void;

  'screen:claim': (
    payload: { session_id: string },
    ack: (result: ScreenClaimResult) => void,
  ) => void;

  'screen:release': (payload: { session_id: string }) => void;

  /// ---- การโทร (เสียงกริ่ง) ----
  ///
  /// ต่างจาก `rtc:signal` ที่เป็นการต่อสายหลังทั้งสองฝ่ายตกลงแล้ว — สามตัวนี้
  /// คือขั้น "ก่อนรับสาย" ซึ่งเดิมไม่มีเลย ผู้ใช้จึงต้องนัดกันนอกระบบว่า
  /// ใครจะเข้าห้องเสียงตอนไหน
  'call:ring': (
    payload: { session_id: string; to_username: string },
    ack: (result: { ok: boolean; error?: string }) => void,
  ) => void;

  'call:answer': (payload: {
    session_id: string;
    to_username: string;
    accepted: boolean;
  }) => void;

  /// ผู้โทรกดยกเลิกก่อนอีกฝ่ายรับ
  'call:cancel': (payload: { session_id: string; to_username: string }) => void;
}

export interface RtcSignalPayload {
  /// ปลายทาง — เซิร์ฟเวอร์จะส่งต่อก็ต่อเมื่อสองคนอยู่ห้องเสียงเดียวกันจริง
  to_username: string;
  /// `renegotiate` = "ผมเพิ่มแทร็กใหม่ แต่ผมไม่ใช่ฝ่ายที่ยื่นข้อเสนอ
  /// ช่วยเปิดรอบเจรจาใหม่ให้ที" — จำเป็นเพราะฝ่ายผู้ยื่นถูกตัดสินด้วยชื่อผู้ใช้
  /// ถ้าฝ่ายที่ไม่ได้ยื่นเริ่มแชร์หน้าจอ จะไม่มีใครสร้าง offer ให้เลย
  kind: 'offer' | 'answer' | 'ice' | 'renegotiate';
  /// SDP หรือ ICE candidate ส่งผ่านไปตามที่เบราว์เซอร์สร้างมา
  data: unknown;
}

export interface ScreenClaimResult {
  ok: boolean;
  /// ใครกำลังแชร์อยู่ ถ้ามีคนอื่นจับจองไปแล้ว
  presenter_username?: string;
  max_viewers?: number;
  error?: string;
}

/// server → client
export interface ServerEvents {
  'message:new': (payload: MessageEvent) => void;
  'message:deleted': (payload: { channel_id: string; message_id: string }) => void;
  'presence:sync': (payload: PresencePayload) => void;
  'typing:sync': (payload: { channel_id: string; username: string }) => void;
  'error:notice': (payload: { code: string; message: string }) => void;

  /// ข้อความถูกแก้ — payload เป็น MessageResponse เต็มตัว ให้ client แทนที่ทั้งก้อน
  /// (ส่งแค่ id กับข้อความใหม่จะทำให้ client ต้องรวมสถานะเอง ซึ่งพลาดง่าย)
  'message:edited': (payload: unknown) => void;

  /// ปักหมุดหรือถอนหมุด — ดูที่ pinned_at ใน payload ว่าเป็นทางไหน
  'message:pinned': (payload: unknown) => void;

  /// แถบอิโมจิของข้อความหนึ่งเปลี่ยน — ส่งยอดรวมชุดใหม่ทั้งชุด
  'reaction:changed': (payload: ReactionChangedPayload) => void;

  /// การแจ้งเตือนใหม่ ส่งเข้าห้องส่วนตัวของผู้รับ (ดู userRoom)
  'notification:new': (payload: NotificationPayload) => void;

  /// มีคนตอบในเธรด — ให้ client ขยับตัวเลข "n คำตอบ" ที่ข้อความต้นเธรด
  'thread:updated': (payload: {
    channel_id: string;
    parent_id: string;
  }) => void;

  /// ---- การโทร ----
  ///
  /// ส่งเข้าห้องส่วนตัวของผู้รับ (ดู userRoom) จึงดังทุกอุปกรณ์ที่เขาเปิดอยู่
  'call:incoming': (payload: {
    session_id: string;
    channel_id: string;
    from_username: string;
  }) => void;

  /// ผลของการโทร — ส่งกลับให้ผู้โทร
  'call:answered': (payload: {
    session_id: string;
    from_username: string;
    accepted: boolean;
  }) => void;

  /// ผู้โทรวางก่อนรับ — ให้ฝั่งผู้รับเลิกส่งเสียงกริ่ง
  'call:cancelled': (payload: {
    session_id: string;
    from_username: string;
  }) => void;

  /// ใครออนไลน์/ออฟไลน์ทั้งระบบ — ต่างจาก `presence:sync` ที่บอกเฉพาะในห้อง
  ///
  /// ต้องมีตัวนี้เพราะจุดเขียวบนรูปโปรไฟล์ต้องขึ้นได้ทุกที่ ไม่ใช่แค่ในห้อง
  /// ที่เปิดอยู่ · ยิงเฉพาะตอนนับ socket ของคนนั้นเปลี่ยนจาก 0→1 หรือ 1→0
  /// ไม่ใช่ทุกครั้งที่เปิดแท็บใหม่ ไม่งั้นเปิดสามแท็บจะยิงสามรอบ
  'presence:changed': (payload: {
    username: string;
    online: boolean;
  }) => void;

  /// ---- WebRTC signaling ----
  'rtc:signal': (
    payload: RtcSignalPayload & { from_username: string },
  ) => void;

  'voice:participants': (payload: VoiceParticipantsPayload) => void;

  'screen:changed': (payload: {
    session_id: string;
    presenter_username: string | null;
  }) => void;
}

export interface VoiceParticipantsPayload {
  session_id: string;
  channel_id: string;
  /// รายชื่อคนที่อยู่ในห้องเสียงตอนนี้ — client ใช้ตัดสินว่าต้องเปิดสายกับใครบ้าง
  usernames: string[];
}

export interface SendMessagePayload {
  channel_id: string;
  /// ตัวใดตัวหนึ่งต้องมี: ข้อความ ไฟล์แนบ หรือคลิปที่แชร์
  content?: string;
  asset_ids?: string[];
  embed?: { kind: 'REEL' | 'POST'; ref_id: string };
  /// ตอบกลับในเธรดของข้อความนี้ — ข้อความที่มี parent_id ไม่ขึ้นไทม์ไลน์หลัก
  parent_id?: string;
  /// client สร้างเอง ใช้กันส่งซ้ำตอนเน็ตกระตุกและใช้เป็นคีย์ชั่วคราวใน UI
  client_nonce: string;
}

export interface JoinResult {
  ok: boolean;
  /// seq ล่าสุดของห้อง ให้ client รู้ว่าต้องดึงย้อนหลังถึงไหน
  latest_seq?: number;
  error?: string;
}

export interface SendResult {
  ok: boolean;
  /// ส่ง client_nonce กลับมาด้วย เพื่อให้ UI แทนที่ข้อความชั่วคราวได้ถูกตัว
  client_nonce: string;
  message_id?: string;
  seq?: number;
  error?: string;
}

export interface MessageEvent {
  id: string;
  seq: number;
  channel_id: string;
  author_username: string;
  content: string | null;
  attachments: {
    id: string;
    file_name: string;
    kind: string;
    mime_type: string;
    size_bytes: string;
  }[];
  embed: { kind: string; ref_id: string } | null;
  client_nonce: string;
  created_at: string;
}

export interface PresencePayload {
  channel_id: string;
  online_usernames: string[];
}

export interface ReactionChangedPayload {
  channel_id: string;
  target_kind: string;
  target_id: string;
  totals: { emoji: string; count: number; reacted_by_me: boolean }[];
  total_count: number;
}

export interface NotificationPayload {
  notification: {
    id: string;
    kind: string;
    ref_id: string;
    actor_username: string | null;
    payload: unknown;
    created_at: string;
  };
  /// ส่งมาด้วยเพื่อให้ตัวเลขบนกระดิ่งอัปเดตได้โดยไม่ต้องยิง REST ตาม
  unread_count: number;
}
