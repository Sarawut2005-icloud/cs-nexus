import type { Notification } from './types';

/// ตรรกะร่วมของการแจ้งเตือน — ใช้ทั้งกระดิ่งบนแถบบนและหน้า /notifications
///
/// แยกออกมาเพราะสองที่นั้นต้องอ่านข้อความเดียวกันเสมอ ถ้าปล่อยให้ต่างคนต่าง
/// เขียน วันหนึ่งกระดิ่งจะบอกอย่างหนึ่งแล้วหน้าเต็มบอกอีกอย่าง ทั้งที่เป็น
/// การแจ้งเตือนรายการเดียวกัน

/// ข้อความของแจ้งเตือนแต่ละชนิด
///
/// หลังบ้านส่ง kind + actor_username + payload มาให้ครบในหนึ่ง query
/// หน้าบ้านจึงประกอบข้อความได้โดยไม่ต้องยิงถามเพิ่มทีละรายการ
export function describeNotification(item: Notification): string {
  const who = item.actor_username ?? 'มีคน';
  const payload = item.payload ?? {};
  const preview = typeof payload.preview === 'string' ? payload.preview : null;

  switch (item.kind) {
    case 'FOLLOW':
      return `${who} เริ่มติดตามคุณ`;
    case 'REEL_LIKE':
      return `${who} ถูกใจคลิปของคุณ${preview ? ` · ${preview}` : ''}`;
    case 'REEL_COMMENT':
      return `${who} คอมเมนต์คลิปของคุณ${preview ? `: ${preview}` : ''}`;
    case 'POST_COMMENT':
      return `${who} ตอบกระทู้ของคุณ${preview ? `: ${preview}` : ''}`;
    case 'REACTION':
      return `${who} กด ${payload.emoji ?? 'รีแอ็กชัน'} ${preview ? `· ${preview}` : ''}`;
    case 'MENTION':
      return payload.broadcast
        ? `${who} ประกาศถึงทุกคนในห้อง${preview ? `: ${preview}` : ''}`
        : `${who} เรียกถึงคุณ${preview ? `: ${preview}` : ''}`;
    case 'THREAD_REPLY':
      return `${who} ตอบในเธรดของคุณ`;
    case 'VOICE_INVITE':
      return `${who} ชวนคุณเข้าห้องเสียง`;
    case 'CHANNEL_INVITE':
      return `${who} เพิ่มคุณเข้าห้องแชท`;
    case 'MEETING_INVITE':
      return payload.cancelled
        ? `${who} ยกเลิกนัด "${payload.title ?? ''}"`
        : `${who} นัดประชุม "${payload.title ?? ''}"`;
    default:
      return `${who} · ${item.kind}`;
  }
}

export function timeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);

  if (seconds < 60) return 'เมื่อครู่';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} นาทีที่แล้ว`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} ชั่วโมงที่แล้ว`;

  return `${Math.floor(seconds / 86400)} วันที่แล้ว`;
}

/// การแจ้งเตือนนี้ควรพาไปที่ไหน
///
/// คืน null เมื่อ **ยังไม่มีหน้าปลายทางที่พาไปได้ตรงจุดจริง ๆ** ดีกว่าพาไป
/// หน้ารวมแล้วปล่อยให้ผู้ใช้ไปหาเอง เพราะลิงก์ที่พาไปผิดที่ทำให้คนเลิกเชื่อ
/// การแจ้งเตือนทั้งระบบ
///
/// ห้องแชทรับ ?channel= เพื่อเปิดห้องที่ถูกต้องได้ทันที
export function notificationLink(item: Notification): string | null {
  const payload = item.payload ?? {};
  const channelId =
    typeof payload.channel_id === 'string' ? payload.channel_id : null;

  switch (item.kind) {
    case 'FOLLOW':
      return item.actor_username
        ? `/profile/${encodeURIComponent(item.actor_username)}`
        : null;

    case 'MENTION':
    case 'THREAD_REPLY':
    case 'REACTION':
    case 'CHANNEL_INVITE':
      return channelId ? `/chat?channel=${encodeURIComponent(channelId)}` : null;

    case 'MEETING_INVITE':
      return '/meetings';

    case 'VOICE_INVITE':
      return '/voice';

    case 'REEL_LIKE':
    case 'REEL_COMMENT':
      return '/reels';

    case 'POST_COMMENT':
      return '/feed';

    default:
      return null;
  }
}
