import { describe, expect, it } from 'vitest';
import {
  describeNotification,
  notificationLink,
  timeAgo,
} from './notifications';
import type { Notification } from './types';

/// เทสต์ตรรกะร่วมของการแจ้งเตือน
///
/// ใช้ทั้งกระดิ่งบนแถบบนและหน้า /notifications — ถ้าเพี้ยน สองที่นั้นจะพูด
/// คนละอย่างเรื่องการแจ้งเตือนรายการเดียวกัน
///
/// ข้อที่สำคัญที่สุดคือ `notificationLink` ต้องคืน null เมื่อพาไปตรงจุดไม่ได้
/// ลิงก์ที่พาไปผิดที่ทำให้คนเลิกเชื่อการแจ้งเตือนทั้งระบบ ซึ่งแย่กว่าไม่มีลิงก์

function make(overrides: Partial<Notification>): Notification {
  return {
    id: 'n1',
    kind: 'FOLLOW',
    ref_id: 'r1',
    actor_username: '6704101999-somchai',
    payload: null,
    read_at: null,
    created_at: '2026-09-12T00:00:00.000Z',
    ...overrides,
  };
}

describe('describeNotification', () => {
  it('อ่านออกโดยไม่ต้องยิงถามหลังบ้านเพิ่ม', () => {
    expect(describeNotification(make({ kind: 'FOLLOW' }))).toBe(
      '6704101999-somchai เริ่มติดตามคุณ',
    );
  });

  it('เอาตัวอย่างข้อความมาแสดงด้วยถ้ามี', () => {
    const text = describeNotification(
      make({ kind: 'POST_COMMENT', payload: { preview: 'เห็นด้วยครับ' } }),
    );

    expect(text).toContain('เห็นด้วยครับ');
  });

  it('ประกาศถึงทุกคนต่างจากการเรียกถึงเราคนเดียว', () => {
    const broadcast = describeNotification(
      make({ kind: 'MENTION', payload: { broadcast: true } }),
    );
    const direct = describeNotification(make({ kind: 'MENTION', payload: {} }));

    expect(broadcast).toContain('ประกาศถึงทุกคน');
    expect(direct).toContain('เรียกถึงคุณ');
  });

  it('ไม่รู้จักชนิดนี้ก็ยังอ่านออก ไม่ใช่ช่องว่าง', () => {
    // หลังบ้านเพิ่มชนิดใหม่แล้วหน้าบ้านยังไม่รู้จัก ต้องไม่กลายเป็นแถวเปล่า
    const text = describeNotification(
      make({ kind: 'SOMETHING_NEW' as Notification['kind'] }),
    );

    expect(text).toContain('SOMETHING_NEW');
  });

  it('ไม่รู้ว่าใครทำก็ยังอ่านออก', () => {
    expect(describeNotification(make({ actor_username: null }))).toContain(
      'มีคน',
    );
  });
});

describe('notificationLink', () => {
  it('ติดตาม → ไปโปรไฟล์คนนั้น', () => {
    expect(notificationLink(make({ kind: 'FOLLOW' }))).toBe(
      '/profile/6704101999-somchai',
    );
  });

  it('เรียกถึงในห้องแชท → เปิดห้องนั้นเลย ไม่ใช่หน้ารวม', () => {
    // นี่คือเหตุผลที่หน้าแชทรับ ?channel= — ถ้าพาไปหน้ารวมเฉย ๆ
    // ผู้ใช้ต้องไปไล่หาเองว่าใครเรียกในห้องไหน
    expect(
      notificationLink(
        make({ kind: 'MENTION', payload: { channel_id: 'ch-9' } }),
      ),
    ).toBe('/chat?channel=ch-9');
  });

  it('ไม่รู้ว่าห้องไหน → ไม่ให้ลิงก์ ดีกว่าพาไปผิดที่', () => {
    expect(notificationLink(make({ kind: 'MENTION', payload: {} }))).toBeNull();
  });

  it('ชนิดที่ยังไม่มีหน้าปลายทาง → ไม่ให้ลิงก์', () => {
    expect(
      notificationLink(make({ kind: 'UNKNOWN' as Notification['kind'] })),
    ).toBeNull();
  });

  it('เข้ารหัส id ที่มีอักขระพิเศษ', () => {
    // ชื่อผู้ใช้หรือ id ที่มี / หรือ ? จะทำให้ URL เพี้ยนถ้าไม่เข้ารหัส
    const link = notificationLink(
      make({ kind: 'FOLLOW', actor_username: 'a/b?c' }),
    );

    expect(link).toBe('/profile/a%2Fb%3Fc');
  });

  it('นัดประชุมและห้องเสียงมีหน้าปลายทางของตัวเอง', () => {
    expect(notificationLink(make({ kind: 'MEETING_INVITE' }))).toBe('/meetings');
    expect(notificationLink(make({ kind: 'VOICE_INVITE' }))).toBe('/voice');
  });
});

describe('timeAgo', () => {
  it('บอกเป็นภาษาคน ไม่ใช่วันที่ดิบ', () => {
    const now = Date.now();

    expect(timeAgo(new Date(now - 30_000).toISOString())).toBe('เมื่อครู่');
    expect(timeAgo(new Date(now - 5 * 60_000).toISOString())).toBe(
      '5 นาทีที่แล้ว',
    );
    expect(timeAgo(new Date(now - 3 * 3600_000).toISOString())).toBe(
      '3 ชั่วโมงที่แล้ว',
    );
    expect(timeAgo(new Date(now - 2 * 86400_000).toISOString())).toBe(
      '2 วันที่แล้ว',
    );
  });
});
