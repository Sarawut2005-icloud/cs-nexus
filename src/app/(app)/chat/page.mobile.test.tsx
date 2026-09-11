import { render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/// เทสต์การสลับแผงบนมือถือของหน้าห้องแชท
///
/// บั๊กที่ชุดนี้เกิดมาเพื่อกัน: รายการห้องถูกซ่อนด้วย `max-md:hidden` เฉย ๆ
/// โดยไม่มีอะไรมาแทน — บนมือถือจึงเปิดมาติดอยู่ห้องแรกที่ระบบเลือกให้
/// แล้ว **สลับห้องไม่ได้เลย** ทั้งที่เป็นสมาชิกอยู่หลายห้อง
///
/// jsdom ไม่คำนวณ media query จึงตรวจที่คลาสที่ควบคุมการซ่อน ซึ่งเป็น
/// กลไกจริงที่ Tailwind ใช้ — ไม่ใช่การเดาว่าหน้าตาออกมาเป็นอย่างไร

const channels = [
  {
    id: 'ch-1',
    kind: 'GROUP',
    name: 'ห้องรวมรุ่น',
    course_tag: null,
    member_count: 12,
    unread_count: 0,
    my_role: 'MEMBER',
    max_seats: 8,
    created_at: '2026-09-01T00:00:00.000Z',
  },
  {
    id: 'ch-2',
    kind: 'COURSE',
    name: 'CS201',
    course_tag: 'CS201',
    member_count: 40,
    unread_count: 3,
    my_role: 'MEMBER',
    max_seats: 8,
    created_at: '2026-09-01T00:00:00.000Z',
  },
];

vi.mock('@/lib/csmju/api', () => {
  class ApiError extends Error {
    constructor(
      readonly status: number,
      readonly code: string,
      message: string,
    ) {
      super(message);
      this.name = 'ApiError';
    }
  }

  return {
    ApiError,
    qs: (input: Record<string, unknown>) => {
      const pairs = Object.entries(input).filter(
        ([, value]) => value !== undefined && value !== '',
      );

      return pairs.length === 0
        ? ''
        : `?${pairs.map(([k, v]) => `${k}=${String(v)}`).join('&')}`;
    },
    api: {
      list: vi.fn(async (path: string) => {
        if (path.startsWith('/channels?')) {
          return {
            items: channels,
            meta: {
              current_page: 1,
              per_page: 50,
              total_pages: 1,
              total_items: channels.length,
            },
          };
        }

        return {
          items: [],
          meta: {
            current_page: 1,
            per_page: 50,
            total_pages: 1,
            total_items: 0,
          },
        };
      }),
      get: vi.fn(async () => ({ online_usernames: [], total_online: 0 })),
      post: vi.fn(async () => ({})),
      patch: vi.fn(async () => ({})),
      del: vi.fn(async () => undefined),
    },
  };
});

vi.mock('@/lib/csmju/socket', () => ({
  connectSocket: vi.fn(async () => ({
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
  })),
  emitWithAck: vi.fn(async () => ({ ok: true })),
  bindSocket: vi.fn(() => () => undefined),
  rememberRoom: vi.fn(),
  forgetRoom: vi.fn(),
  onSocketStatus: vi.fn(() => () => undefined),
  onSocketReconnect: vi.fn(() => () => undefined),
}));

vi.mock('@/lib/csmju/identity', () => ({
  getIdentity: () => ({
    username: '6704101382-anuchat',
    layer1Role: 'student',
    faculty: 'science',
    displayName: 'อนุชาติ',
  }),
  DEV_IDENTITIES: [],
}));

/// หาแผงรายการห้องจากหัวข้อของมัน
function channelListPane(): HTMLElement {
  const heading = screen.getByRole('heading', { name: 'ห้องของฉัน' });
  const pane = heading.closest('div.flex.w-64');

  if (!pane) throw new Error('ไม่พบแผงรายการห้อง');

  return pane as HTMLElement;
}

/// แผงห้องแชท = ลูกโดยตรงของรากหน้าที่ครอบหัวข้อชื่อห้องนั้นอยู่
///
/// หาแบบนี้แทนการเดาคลาส เพราะทั้งแผงนอกและแผงในต่างก็มี `min-w-0 flex-1`
/// เหมือนกัน — `closest()` จึงหยิบตัวในมาให้ ซึ่งไม่ใช่ตัวที่ถือคลาสซ่อน
function roomPane(name: string): HTMLElement {
  const heading = screen.getByRole('heading', { name });
  const root = channelListPane().parentElement;

  if (!root) throw new Error('ไม่พบรากของหน้า');

  const pane = [...root.children].find((child) => child.contains(heading));

  if (!pane) throw new Error('ไม่พบแผงห้องแชท');

  return pane as HTMLElement;
}

/// หน้านี้ดึงข้อมูลผ่าน TanStack Query จึงต้องมี provider ครอบ
/// (แอปจริงใส่ไว้ที่ layout) — ปิด retry เพื่อให้เทสต์ล้มเร็วแทนการรอ
function renderPage(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });

  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

describe('หน้าห้องแชทบนจอแคบ', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('เปิดมาเห็นรายการห้อง ไม่ใช่กระโดดเข้าห้องแรกทันที', async () => {
    const { default: ChatPage } = await import('./page');

    renderPage(<ChatPage />);

    // หัวข้อของแผงห้องแชทมีชื่อนี้อยู่ตัวเดียว ต่างจากปุ่มในรายการ
    await screen.findByRole('heading', { name: 'ห้องรวมรุ่น' });

    // รายการห้องต้องไม่ถูกซ่อนบนจอแคบ
    expect(channelListPane().className).not.toContain('max-md:hidden');

    // ส่วนห้องแชทต้องถูกซ่อนไว้ก่อน
    expect(roomPane('ห้องรวมรุ่น').className).toContain('max-md:hidden');
  });

  it('แตะห้องแล้วเข้าห้องนั้น และรายการถูกซ่อน', async () => {
    const { default: ChatPage } = await import('./page');

    renderPage(<ChatPage />);

    await screen.findByRole('heading', { name: 'ห้องรวมรุ่น' });

    // ต้องยืนยันว่ามันเห็นอยู่ *ก่อน* กด ไม่งั้นเทสต์จะเขียวเพราะรายการ
    // ถูกซ่อนอยู่ตลอดเวลา ซึ่งคือบั๊กที่กำลังจะกัน ไม่ใช่พฤติกรรมที่ถูก
    expect(channelListPane().className).not.toContain('max-md:hidden');

    await userEvent.click(
      within(channelListPane()).getByRole('button', { name: /CS201/ }),
    );

    await waitFor(() =>
      expect(channelListPane().className).toContain('max-md:hidden'),
    );

    expect(roomPane('CS201').className).not.toContain('max-md:hidden');
  });

  it('มีปุ่มย้อนกลับ และกดแล้วกลับไปที่รายการห้องได้', async () => {
    // นี่คือสิ่งที่หายไปทั้งหมด — ไม่มีปุ่มนี้ = เข้าห้องแล้วออกไม่ได้
    const { default: ChatPage } = await import('./page');

    renderPage(<ChatPage />);

    // หัวข้อของแผงห้องแชทมีชื่อนี้อยู่ตัวเดียว ต่างจากปุ่มในรายการ
    await screen.findByRole('heading', { name: 'ห้องรวมรุ่น' });

    await userEvent.click(
      within(channelListPane()).getByRole('button', { name: /ห้องรวมรุ่น/ }),
    );

    await waitFor(() =>
      expect(channelListPane().className).toContain('max-md:hidden'),
    );

    await userEvent.click(
      screen.getByRole('button', { name: 'กลับไปที่รายการห้อง' }),
    );

    await waitFor(() =>
      expect(channelListPane().className).not.toContain('max-md:hidden'),
    );
  });

  it('ปุ่มย้อนกลับโผล่เฉพาะจอแคบ ไม่กวนจอกว้าง', async () => {
    const { default: ChatPage } = await import('./page');

    renderPage(<ChatPage />);

    // หัวข้อของแผงห้องแชทมีชื่อนี้อยู่ตัวเดียว ต่างจากปุ่มในรายการ
    await screen.findByRole('heading', { name: 'ห้องรวมรุ่น' });

    expect(
      screen.getByRole('button', { name: 'กลับไปที่รายการห้อง' }).className,
    ).toContain('md:hidden');
  });
});
