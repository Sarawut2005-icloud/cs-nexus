import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/// เทสต์การจัดการ session โดยเฉพาะ **ตอน token หมดอายุกลางทาง**
///
/// access token อายุ 15 นาที (auth-contract.md ข้อ 7) ผู้ใช้ที่เปิดหน้าทิ้งไว้
/// จึงเจอเรื่องนี้ทุกวัน — ก่อนหน้านี้ไม่มีใครดัก 401 ที่เกิดจากคำขออื่น
/// ผู้ใช้เลยเห็นข้อความดิบจากหลังบ้าน ("ยืนยันตัวตนไม่สำเร็จ") โผล่ตรงไหน
/// ก็ได้ที่บังเอิญยิง API ตอนนั้น โดยไม่รู้ว่าต้องทำอะไรต่อ

const apiGet = vi.fn();

vi.mock('./api', async () => {
  const actual = await vi.importActual<typeof import('./api')>('./api');
  let handler: (() => void) | null = null;

  return {
    ApiError: actual.ApiError,
    api: { get: (path: string) => apiGet(path) },
    setUnauthorizedHandler: (fn: (() => void) | null) => {
      handler = fn;
    },
    /// ให้เทสต์เรียกได้เหมือน api.ts เจอ 401 จากคำขออื่น
    __fire401: () => handler?.(),
  };
});

const CORE_LOGIN = 'http://127.0.0.1:3100/api/sso/csmju-social-reels';

let assigned: string | null = null;
let reloaded = false;
let replacedWith: string | null = null;

beforeEach(() => {
  vi.resetModules();
  apiGet.mockReset();
  assigned = null;
  reloaded = false;
  replacedWith = null;
  window.sessionStorage.clear();

  // จับว่าเราพาไปเส้นทางไหน โดยไม่ให้ jsdom เปลี่ยนหน้าจริง
  vi.spyOn(window.history, 'replaceState').mockImplementation(
    (_s, _t, url) => {
      replacedWith = String(url);
    },
  );

  process.env.NEXT_PUBLIC_CORE_LOGIN_URL = CORE_LOGIN;

  // `window.location.href = …` ใน jsdom จะพยายามเปลี่ยนหน้าจริงแล้วเตือน
  // จึงแทนที่ด้วยตัวจับค่าเพื่อดูว่าเราพาไปไหน
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      pathname: '/voice',
      search: '',
      reload: () => {
        reloaded = true;
      },
      get href() {
        return 'http://localhost:4100/voice';
      },
      set href(value: string) {
        assigned = value;
      },
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function load() {
  const mod = await import('./session');
  const apiMod = (await import('./api')) as unknown as {
    __fire401: () => void;
  };

  return { ...mod, fire401: apiMod.__fire401 };
}

const ME = {
  id: 'user-002',
  email: 'student@core.local',
  coreRole: 'student' as const,
  subsystemRole: 'GUEST' as const,
};

describe('SessionProvider', () => {
  it('ล็อกอินอยู่ก็เรนเดอร์เนื้อหาตามปกติ', async () => {
    apiGet.mockResolvedValue(ME);

    const { SessionProvider } = await load();

    render(
      <SessionProvider>
        <p>เนื้อหาของแอป</p>
      </SessionProvider>,
    );

    expect(await screen.findByText('เนื้อหาของแอป')).toBeInTheDocument();
  });

  it('ยังไม่เคยล็อกอิน → ชวนให้เข้าสู่ระบบ ไม่ใช่ขึ้น error', async () => {
    const { ApiError } = await import('./api');

    apiGet.mockRejectedValue(new ApiError(401, 'UNAUTHORIZED', 'ยืนยันตัวตนไม่สำเร็จ'));

    const { SessionProvider } = await load();

    render(
      <SessionProvider>
        <p>เนื้อหาของแอป</p>
      </SessionProvider>,
    );

    expect(await screen.findByText('ต้องเข้าสู่ระบบก่อน')).toBeInTheDocument();
    expect(screen.queryByText('เนื้อหาของแอป')).not.toBeInTheDocument();

    // ต้องไม่พาไปเอง — คนที่ยังไม่เคยล็อกอินควรได้เลือกเองว่าจะเข้าเมื่อไหร่
    expect(assigned).toBeNull();
  });

  it('**token หมดอายุกลางทาง → พากลับเข้า SSO เอง**', async () => {
    apiGet.mockResolvedValue(ME);

    const { SessionProvider, fire401 } = await load();

    render(
      <SessionProvider>
        <p>เนื้อหาของแอป</p>
      </SessionProvider>,
    );

    await screen.findByText('เนื้อหาของแอป');

    // จำลองว่าคำขออื่นได้ 401 เพราะ token หมดอายุ
    // ห่อด้วย act() เพราะมันเปลี่ยน state ของ React จากนอกต้นไม้
    await act(async () => fire401());

    // ต้องไม่ปล่อยให้ผู้ใช้เห็นข้อความดิบจากหลังบ้าน
    expect(await screen.findByText('หมดเวลาใช้งานชั่วคราว')).toBeInTheDocument();

    // auth-contract.md ข้อ 7: การต่ออายุใน v1.0 คือ "ให้วิ่ง SSO ใหม่อีกครั้ง"
    await waitFor(() => expect(assigned).toBe(CORE_LOGIN));
  });

  it('พาไป SSO ซ้ำติด ๆ ไม่ได้ — กันหน้าจอวนลูป', async () => {
    // มีร่องรอยว่าเพิ่งพาไปเมื่อกี้
    window.sessionStorage.setItem('csmju:last-resso', String(Date.now()));

    apiGet.mockResolvedValue(ME);

    const { SessionProvider, fire401 } = await load();

    render(
      <SessionProvider>
        <p>เนื้อหาของแอป</p>
      </SessionProvider>,
    );

    await screen.findByText('เนื้อหาของแอป');
    await act(async () => fire401());

    expect(await screen.findByText('หมดเวลาใช้งานชั่วคราว')).toBeInTheDocument();

    // ถ้าพาไปอีกจะกลายเป็นหน้าจอกะพริบที่หาสาเหตุไม่เจอ —
    // ต้องหยุดแล้วให้ผู้ใช้กดปุ่มเอง
    await new Promise((r) => setTimeout(r, 50));
    expect(assigned).toBeNull();
    expect(
      screen.getByRole('link', { name: 'เข้าสู่ระบบต่อ' }),
    ).toBeInTheDocument();
  });

  it('401 ก่อนล็อกอินสำเร็จ ไม่ถูกนับเป็น "หมดอายุ"', async () => {
    const { ApiError } = await import('./api');

    apiGet.mockRejectedValue(new ApiError(401, 'UNAUTHORIZED', 'x'));

    const { SessionProvider, fire401 } = await load();

    render(
      <SessionProvider>
        <p>เนื้อหาของแอป</p>
      </SessionProvider>,
    );

    await screen.findByText('ต้องเข้าสู่ระบบก่อน');
    await act(async () => fire401());

    // ยังเป็น "ต้องเข้าสู่ระบบก่อน" ไม่ใช่ "หมดเวลาใช้งาน" —
    // คนที่ยังไม่เคยเข้ามา ไม่มีอะไรให้ "หมดอายุ"
    expect(screen.getByText('ต้องเข้าสู่ระบบก่อน')).toBeInTheDocument();
    expect(assigned).toBeNull();
  });

  it('error อื่นที่ไม่ใช่ 401 ต้องบอกสาเหตุจริง ไม่ซ่อน', async () => {
    apiGet.mockRejectedValue(new Error('ต่อหลังบ้านไม่ได้'));

    const { SessionProvider } = await load();

    render(
      <SessionProvider>
        <p>เนื้อหาของแอป</p>
      </SessionProvider>,
    );

    expect(await screen.findByText('ตรวจสอบตัวตนไม่สำเร็จ')).toBeInTheDocument();
    expect(screen.getByText('ต่อหลังบ้านไม่ได้')).toBeInTheDocument();
  });

  it('จำหน้าที่ค้างไว้ก่อนเด้งไป SSO', async () => {
    apiGet.mockResolvedValue(ME);

    const { SessionProvider, fire401 } = await load();

    render(
      <SessionProvider>
        <p>เนื้อหาของแอป</p>
      </SessionProvider>,
    );

    await screen.findByText('เนื้อหาของแอป');
    await act(async () => fire401());
    await waitFor(() => expect(assigned).toBe(CORE_LOGIN));

    // `/auth/callback` พากลับมาหน้าแรกเสมอ เพราะ Core Hub เป็นคนสร้าง state
    // เราจึงต้องจำเส้นทางไว้เอง ไม่งั้นผู้ใช้หลุดจากที่ค้างไว้ทุกครั้ง
    expect(window.sessionStorage.getItem('csmju:return-to')).toBe('/voice');
  });

  it('กลับมาแล้วพาไปหน้าที่ค้างไว้', async () => {
    window.sessionStorage.setItem('csmju:return-to', '/chat?room=abc');
    apiGet.mockResolvedValue(ME);

    const { SessionProvider } = await load();

    render(
      <SessionProvider>
        <p>เนื้อหาของแอป</p>
      </SessionProvider>,
    );

    await screen.findByText('เนื้อหาของแอป');
    await waitFor(() => expect(replacedWith).toBe('/chat?room=abc'));
    expect(reloaded).toBe(true);

    // ใช้แล้วต้องลบ ไม่งั้นครั้งหน้าที่เปิดแอปจะถูกพาไปหน้าเก่าโดยไม่มีเหตุผล
    expect(window.sessionStorage.getItem('csmju:return-to')).toBeNull();
  });

  it('**ไม่พาออกไปเว็บอื่น** แม้ค่าใน sessionStorage จะถูกแก้', async () => {
    apiGet.mockResolvedValue(ME);

    // ค่านี้อยู่ใน sessionStorage ซึ่งสคริปต์ที่หลุดเข้ามาในหน้าเขียนทับได้
    // ถ้าเอาไปใส่ location ตรง ๆ จะกลายเป็นช่องพาผู้ใช้ออกไปเว็บปลอมทันที
    for (const evil of [
      'https://evil.example.com/phish',
      '//evil.example.com/phish',
      'javascript:alert(1)',
    ]) {
      window.sessionStorage.setItem('csmju:return-to', evil);
      replacedWith = null;
      reloaded = false;

      const { SessionProvider } = await load();
      const view = render(
        <SessionProvider>
          <p>เนื้อหาของแอป</p>
        </SessionProvider>,
      );

      await screen.findByText('เนื้อหาของแอป');
      await new Promise((r) => setTimeout(r, 30));

      expect(replacedWith, evil).toBeNull();
      expect(reloaded, evil).toBe(false);

      view.unmount();
      window.sessionStorage.clear();
    }
  });
});
