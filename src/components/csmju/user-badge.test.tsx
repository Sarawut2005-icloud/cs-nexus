import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/// เทสต์จุดออนไลน์และเครื่องหมายยืนยัน
///
/// สถานะออนไลน์เก็บใน module scope (ไม่ใช่ context) เพื่อไม่ให้ avatar
/// ร้อยตัวในหน้าเดียว re-render พร้อมกันทุกครั้งที่มีคนเปิด-ปิดแท็บ
/// เทสต์ชุดนี้จึงต้อง reset module ระหว่างเทสต์ ไม่งั้นสถานะจะรั่วข้ามกัน

type Handler = (payload: unknown) => void;

/// ผู้ฟังที่ผูกอยู่กับ socket **ตัวปัจจุบัน**
///
/// การต่อใหม่สร้าง Socket ตัวใหม่ ของที่ผูกไว้กับตัวเก่าจึงหายไปทั้งหมด
/// ตัวปลอมนี้ต้องจำลองข้อนั้นให้ตรง ไม่งั้นเทสต์จะแยกไม่ออกระหว่าง
/// `socket.on` ดิบ (ตายตอนต่อใหม่) กับ `bindSocket` (ย้ายตามไป)
let handlers = new Map<string, Handler>();

/// ทะเบียนของ bindSocket — ตัวจริงใน socket.ts ย้ายของพวกนี้ไปให้ socket ใหม่
const registry = new Map<string, Handler>();

vi.mock('@/lib/csmju/api', () => ({
  api: {
    get: vi.fn().mockResolvedValue({
      online_usernames: ['6700000001-ajarn'],
      total_online: 1,
    }),
  },
  ApiError: class extends Error {},
}));

const reconnectHandlers = new Set<() => void>();

vi.mock('@/lib/csmju/socket', () => ({
  connectSocket: vi.fn().mockResolvedValue({
    // ผูกกับ instance ปัจจุบันเท่านั้น — หายไปพร้อมกับมันตอนต่อใหม่
    on: (event: string, handler: Handler) => {
      handlers.set(event, handler);
    },
  }),
  bindSocket: (_socket: unknown, event: string, handler: Handler) => {
    registry.set(event, handler);
    handlers.set(event, handler);

    return () => {
      registry.delete(event);
      handlers.delete(event);
    };
  },
  onSocketReconnect: (handler: () => void) => {
    reconnectHandlers.add(handler);

    return () => reconnectHandlers.delete(handler);
  },
}));

/// จำลองว่าต่อกลับมาได้หลังเน็ตหลุด
///
/// socket ตัวใหม่เริ่มจากศูนย์ แล้วมีแต่ของในทะเบียนที่ถูกย้ายตามไป
/// — ตรงตามที่ socket.ts ทำจริง
function fireReconnect() {
  handlers = new Map(registry);

  act(() => {
    for (const handler of reconnectHandlers) {
      handler();
    }
  });
}

/// ยิง event เข้ามาเหมือนที่ socket ทำ
///
/// ต้องห่อด้วย act() เพราะ handler ไปเรียก setState ของ component ที่ mount อยู่
/// — ถ้าไม่ห่อ React จะเตือน "not wrapped in act(...)" ซึ่งหมายความว่า
/// การ assert หลังจากนั้นอาจอ่านค่าก่อนที่ React จะวาดเสร็จ
function emitPresence(username: string, online: boolean) {
  act(() => {
    handlers.get('presence:changed')?.({ username, online });
  });
}

describe('UserAvatar และ presence', () => {
  beforeEach(() => {
    handlers = new Map();
    registry.clear();
    reconnectHandlers.clear();
    vi.resetModules();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('คนที่ออนไลน์อยู่ก่อนเราเปิดหน้าต้องมีจุดเขียว', async () => {
    // ถ้ามีแต่ event จะไม่เห็นใครเลยจนกว่าจะมีคนเปิดหรือปิดแท็บ —
    // REST จึงต้องให้ภาพตั้งต้นด้วย
    const { UserAvatar } = await import('./user-badge');

    render(<UserAvatar username="6700000001-ajarn" />);

    expect(await screen.findByText('ออนไลน์')).toBeInTheDocument();
  });

  it('คนที่ไม่ได้ออนไลน์ไม่มีจุด', async () => {
    const { UserAvatar } = await import('./user-badge');

    render(<UserAvatar username="6704101382-anuchat" />);

    await waitFor(() => expect(screen.queryByText('ออนไลน์')).toBeNull());
  });

  it('event ทำให้จุดขึ้นและดับตามจริง', async () => {
    const { UserAvatar } = await import('./user-badge');

    render(<UserAvatar username="6704101999-somchai" />);

    await waitFor(() => expect(handlers.has('presence:changed')).toBe(true));

    await waitFor(() =>
      expect(screen.queryByText('ออนไลน์')).not.toBeInTheDocument(),
    );

    emitPresence('6704101999-somchai', true);
    expect(await screen.findByText('ออนไลน์')).toBeInTheDocument();

    emitPresence('6704101999-somchai', false);
    await waitFor(() =>
      expect(screen.queryByText('ออนไลน์')).not.toBeInTheDocument(),
    );
  });

  it('สถานะของคนอื่นเปลี่ยน ไม่ทำให้ avatar ของเราขึ้นจุด', async () => {
    const { UserAvatar } = await import('./user-badge');

    render(<UserAvatar username="6704101777-malee" />);

    await waitFor(() => expect(handlers.has('presence:changed')).toBe(true));

    emitPresence('someone-else', true);

    await waitFor(() =>
      expect(screen.queryByText('ออนไลน์')).not.toBeInTheDocument(),
    );
  });

  it('avatar สองตัวของคนเดียวกันขึ้นจุดพร้อมกัน', async () => {
    // ผู้ฟังแยกตาม username เก็บใน Set เดียวกัน — ถ้า cleanup ของตัวหนึ่ง
    // ลบทั้ง Set อีกตัวจะหยุดอัปเดตเงียบ ๆ
    const { UserAvatar } = await import('./user-badge');

    render(
      <>
        <UserAvatar username="6704101999-somchai" />
        <UserAvatar username="6704101999-somchai" />
      </>,
    );

    await waitFor(() => expect(handlers.has('presence:changed')).toBe(true));

    emitPresence('6704101999-somchai', true);

    await waitFor(() => expect(screen.getAllByText('ออนไลน์')).toHaveLength(2));
  });

  it('ถอด avatar ตัวหนึ่งออก อีกตัวยังอัปเดตอยู่', async () => {
    const { UserAvatar } = await import('./user-badge');

    const { rerender } = render(
      <>
        <UserAvatar username="6704101999-somchai" />
        <UserAvatar username="6704101999-somchai" />
      </>,
    );

    await waitFor(() => expect(handlers.has('presence:changed')).toBe(true));

    rerender(
      <>
        <UserAvatar username="6704101999-somchai" />
      </>,
    );

    emitPresence('6704101999-somchai', true);

    await waitFor(() => expect(screen.getAllByText('ออนไลน์')).toHaveLength(1));
  });

  it('ต่อกลับมาแล้วจุดออนไลน์ยังทำงานอยู่', async () => {
    // เดิมผูกด้วย `socket.on` ดิบ ซึ่งตายไปพร้อม socket ตัวเก่าตอนต่อใหม่
    // และ `started` ที่ล็อกไว้ตลอดกาลทำให้ไม่มีใครมาผูกใหม่ —
    // จุดออนไลน์ทั้งหน้าค้างแช่จนกว่าผู้ใช้จะรีเฟรชเอง
    const { UserAvatar } = await import('./user-badge');

    render(<UserAvatar username="6704101999-somchai" />);

    await waitFor(() => expect(handlers.has('presence:changed')).toBe(true));
    await waitFor(() => expect(reconnectHandlers.size).toBeGreaterThan(0));

    fireReconnect();

    // หลังต่อกลับ event ยังต้องถึงมือ handler ตัวเดิม
    emitPresence('6704101999-somchai', true);

    expect(await screen.findByText('ออนไลน์')).toBeInTheDocument();
  });

  it('ต่อกลับมาแล้วดึงรายชื่อออนไลน์ใหม่ทั้งชุด', async () => {
    // ระหว่างที่หลุดเราพลาด event ไปหมด ภาพที่ถืออยู่จึงเก่าแล้ว
    const { api } = await import('@/lib/csmju/api');
    const { UserAvatar } = await import('./user-badge');

    render(<UserAvatar username="6700000001-ajarn" />);

    await screen.findByText('ออนไลน์');
    await waitFor(() => expect(reconnectHandlers.size).toBeGreaterThan(0));

    // คราวนี้หลังบ้านบอกว่าเขาออฟไลน์ไปแล้ว
    vi.mocked(api.get).mockResolvedValueOnce({
      online_usernames: [],
      total_online: 0,
    });

    fireReconnect();

    // ถ้าดึงมาแล้วเติมทับอย่างเดียวโดยไม่ล้างก่อน จุดเขียวจะค้างอยู่
    await waitFor(() =>
      expect(screen.queryByText('ออนไลน์')).not.toBeInTheDocument(),
    );
  });

  it('เครื่องหมายยืนยันแยกผู้ดูแลกับอาจารย์', async () => {
    const { VerifiedBadge } = await import('./user-badge');

    const { rerender } = render(<VerifiedBadge badge="ADMIN" />);
    expect(screen.getByLabelText('ผู้ดูแลระบบ')).toBeInTheDocument();

    rerender(<VerifiedBadge badge="STAFF" />);
    expect(screen.getByLabelText('อาจารย์หรือบุคลากร')).toBeInTheDocument();

    rerender(<VerifiedBadge badge={null} />);
    expect(screen.queryByLabelText(/ผู้ดูแล|อาจารย์/)).toBeNull();
  });

  it('showOnline=false ปิดจุดได้ (สำหรับที่ที่ไม่ต้องการ)', async () => {
    const { UserAvatar } = await import('./user-badge');

    render(<UserAvatar username="6700000001-ajarn" showOnline={false} />);

    await waitFor(() => expect(screen.queryByText('ออนไลน์')).toBeNull());
  });
});
