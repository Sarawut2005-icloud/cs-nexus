'use client';

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

/// ตัวตนของผู้ใช้ที่ล็อกอินอยู่ — **มาจาก Core Hub ทั้งหมด ไม่มีของปลอม**
///
/// ไฟล์นี้แทนที่ `identity.ts` เดิมที่เก็บรายชื่อผู้ใช้สมมติไว้ในโค้ดแล้วให้
/// เลือกว่า "จะสวมบทเป็นใคร" ผ่าน localStorage — ของแบบนั้นทดสอบหน้าจอได้
/// แต่ไม่ใช่การยืนยันตัวตน ใครเปิด devtools ก็เปลี่ยนเป็นใครก็ได้
///
/// ของจริงทำงานแบบนี้:
///
///   1. ผู้ใช้ล็อกอินที่ Core Hub แล้วกดเข้าระบบเรา
///   2. Core Hub 302 มาที่ `GET /auth/callback` ของหลังบ้านพร้อม access_token
///   3. หลังบ้านตรวจลายเซ็นด้วย JWKS **แล้วค่อย**ตั้งคุกกี้ httpOnly
///   4. หน้าบ้านถาม `GET /api/v1/me` ว่าคุกกี้นั้นเป็นของใคร
///
/// หน้าบ้านจึง **อ่าน token ไม่ได้เลย** (httpOnly) และเปลี่ยนตัวตนเองไม่ได้
/// ทุกคำตอบเรื่อง "ฉันเป็นใคร" มาจากหลังบ้านที่ตรวจลายเซ็นแล้วเท่านั้น

import { api, ApiError, setUnauthorizedHandler } from './api';

export type CoreRole = 'student' | 'alumni' | 'staff' | 'admin';
export type SubsystemRole = 'GUEST' | 'EDITOR' | 'ADMIN';

/// รูปร่างนี้ถูกล็อกไว้ที่ `contracts/openapi.yaml` (`MeEnvelope`) — สี่ฟิลด์
/// เท่านั้น ห้ามเพิ่มเอง เพราะ conformance L1-08..12 อ่านทั้งสี่ตัวแล้วเทียบ
/// กับ claim ใน token ที่มันถืออยู่
export interface Me {
  /// ค่า `sub` จาก token เช่น "user-002" — **ไม่ใช่รหัสนักศึกษา**
  /// token ของ Core Hub ไม่มี claim `coreUserId` (data-dictionary.md ข้อ 1.2)
  id: string;
  email: string;
  coreRole: CoreRole;
  subsystemRole: SubsystemRole;
}

/// ทางเข้าระบบ — SSO launcher ของ Core Hub ไม่ใช่หน้า login ของมัน
/// (ดูเหตุผลเต็มใน app/login/page.tsx)
const CORE_LOGIN_URL = process.env.NEXT_PUBLIC_CORE_LOGIN_URL ?? '';

type State =
  | { status: 'loading' }
  | { status: 'ready'; me: Me }
  | { status: 'anonymous' }
  /// เคยล็อกอินแล้วแต่ token หมดอายุระหว่างใช้งาน — ต่างจาก `anonymous`
  /// ตรงที่ผู้ใช้ไม่ได้ทำอะไรผิด และเราพาเขากลับเข้ามาได้เองโดยไม่ต้องถาม
  | { status: 'expired' }
  | { status: 'error'; message: string };

/// กันวนลูป: ถ้าเพิ่งกลับมาจาก SSO แล้วยังโดน 401 อีก แปลว่าพาไปกี่รอบก็
/// ไม่หาย (เช่นคุกกี้ตั้งไม่ติดเพราะ CORS ผิด) — ต้องหยุดแล้วบอกผู้ใช้ตรง ๆ
/// ดีกว่าปล่อยให้หน้าจอกะพริบไปมาจนหาสาเหตุไม่เจอ
const RESSO_KEY = 'csmju:last-resso';
const RESSO_COOLDOWN_MS = 30_000;

/// เส้นทางที่ผู้ใช้ค้างอยู่ตอน token หมดอายุ
const RETURN_KEY = 'csmju:return-to';

function rememberWhereWeWere(): void {
  try {
    window.sessionStorage.setItem(
      RETURN_KEY,
      window.location.pathname + window.location.search,
    );
  } catch {
    // จำไม่ได้ก็แค่กลับไปหน้าแรก ไม่ใช่เรื่องคอขาดบาดตาย
  }
}

function restoreWhereWeWere(): void {
  try {
    const target = window.sessionStorage.getItem(RETURN_KEY);

    window.sessionStorage.removeItem(RETURN_KEY);

    // **ยอมเฉพาะเส้นทางภายใน** — ค่านี้อยู่ใน sessionStorage ซึ่งสคริปต์
    // ที่หลุดเข้ามาในหน้าเขียนทับได้ ถ้าเอาไปใส่ location ตรง ๆ จะกลายเป็น
    // ช่องพาผู้ใช้ออกไปเว็บอื่น (open redirect) ทันที
    //
    // `//` ต้องกันด้วย เพราะ `//evil.com` คือ URL เต็มที่ขึ้นต้นด้วย /
    if (!target || !target.startsWith('/') || target.startsWith('//')) return;

    if (target === window.location.pathname + window.location.search) return;

    window.history.replaceState(null, '', target);
    window.location.reload();
  } catch {
    // ทำไม่ได้ก็อยู่หน้าแรกต่อไป
  }
}

function shouldAutoReSso(): boolean {
  try {
    const last = Number(window.sessionStorage.getItem(RESSO_KEY) ?? 0);

    if (Date.now() - last < RESSO_COOLDOWN_MS) return false;

    window.sessionStorage.setItem(RESSO_KEY, String(Date.now()));

    return true;
  } catch {
    // โหมดส่วนตัวบล็อก sessionStorage — ไม่พาไปเอง ให้ผู้ใช้กดเอง
    // ปลอดภัยกว่าเสี่ยงวนลูปโดยไม่มีตัวนับ
    return false;
  }
}

const SessionContext = createContext<State | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ status: 'loading' });

  // ดัก 401 ที่เกิดจาก **คำขออื่น** ระหว่างใช้งาน
  //
  // เดิมไม่มีใครดัก ผู้ใช้จึงเจอข้อความดิบจากหลังบ้าน ("ยืนยันตัวตนไม่สำเร็จ")
  // โผล่ตรงไหนก็ได้ที่บังเอิญยิง API ตอน token หมดอายุ โดยไม่รู้ว่าต้องทำอะไรต่อ
  //
  // auth-contract.md ข้อ 7: access token อายุ 15 นาที และการต่ออายุใน v1.0
  // คือ "ให้วิ่ง SSO ใหม่อีกครั้ง" (v1.1 จะมี silent re-SSO)
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setState((current) =>
        // ยังไม่เคยล็อกอินสำเร็จ = ไม่ใช่หมดอายุ อย่าเปลี่ยนสถานะทับ
        current.status === 'ready' ? { status: 'expired' } : current,
      );
    });

    return () => setUnauthorizedHandler(null);
  }, []);

  // หมดอายุแล้วพากลับเข้า SSO เอง — Core Hub ยังจำผู้ใช้ได้ (มี browser
  // session ของมันเอง) การวิ่ง SSO ใหม่จึงแทบไม่มีอะไรให้ผู้ใช้ทำ
  useEffect(() => {
    if (state.status !== 'expired' || !CORE_LOGIN_URL) return;

    if (shouldAutoReSso()) {
      rememberWhereWeWere();
      window.location.href = CORE_LOGIN_URL;
    }
  }, [state.status]);

  // กลับมาแล้วพาไปหน้าที่ค้างไว้
  //
  // `/auth/callback` ของหลังบ้านพากลับมาหน้าแรกเสมอ เพราะ Core Hub เป็น
  // คนสร้าง `state` เองสำหรับกัน CSRF เราจึงยัดเส้นทางของเราเข้าไปไม่ได้
  // (csmju-core-hub/frontend/app/api/sso/[subsystem]/route.ts)
  //
  // จำไว้ฝั่งเบราว์เซอร์แทน — ไม่ต้องขอให้ Core Hub แก้อะไรเลย
  useEffect(() => {
    if (state.status !== 'ready') return;

    restoreWhereWeWere();
  }, [state.status]);

  useEffect(() => {
    let alive = true;

    api
      .get<Me>('/me')
      .then((me) => {
        if (alive) setState({ status: 'ready', me });
      })
      .catch((error: unknown) => {
        if (!alive) return;

        // 401 ไม่ใช่ความผิดพลาด — แปลว่ายังไม่ได้ล็อกอิน ซึ่งเป็นสถานะปกติ
        // ของคนที่เพิ่งเปิดเว็บมา แยกออกจาก error จริงเพื่อไม่ให้หน้าจอขึ้น
        // ข้อความน่ากลัวทั้งที่แค่ต้องกดเข้าสู่ระบบ
        if (error instanceof ApiError && error.status === 401) {
          setState({ status: 'anonymous' });
          return;
        }

        setState({
          status: 'error',
          message:
            error instanceof Error ? error.message : 'ตรวจสอบตัวตนไม่สำเร็จ',
        });
      });

    return () => {
      alive = false;
    };
  }, []);

  return (
    <SessionContext.Provider value={state}>
      {state.status === 'ready' ? children : <SessionGate state={state} />}
    </SessionContext.Provider>
  );
}

/// หน้าจอระหว่างที่ยังไม่รู้ว่าเป็นใคร
///
/// สามสถานะที่ต่างกันจริง ๆ และต้องพูดกับผู้ใช้คนละแบบ:
///
///   loading    ยังถามอยู่ — ไม่ต้องพูดอะไรนอกจากบอกว่ากำลังทำ
///   anonymous  ยังไม่เคยล็อกอิน — อธิบายว่าใช้บัญชีกลาง
///   expired    เคยล็อกอินแล้ว token หมดอายุ — **ผู้ใช้ไม่ได้ทำอะไรผิด**
///              พากลับเข้าไปเองได้ ไม่ต้องให้อ่านอะไรยาว ๆ
///   error      อย่างอื่นพัง — บอกสาเหตุจริง ไม่ใช่ซ่อน
function SessionGate({ state }: { state: Exclude<State, { status: 'ready' }> }) {
  if (state.status === 'loading') {
    return (
      <div className="grid min-h-dvh place-items-center px-6">
        <p className="text-csmju-label text-muted-foreground">
          กำลังตรวจสอบตัวตน…
        </p>
      </div>
    );
  }

  const COPY = {
    anonymous: {
      title: 'ต้องเข้าสู่ระบบก่อน',
      body: 'ระบบนี้ใช้บัญชีเดียวกับ CSMJU2030 — เข้าสู่ระบบที่ศูนย์กลางแล้วจะพากลับมาที่นี่เอง',
      cta: 'เข้าสู่ระบบด้วยบัญชี CSMJU2030',
    },
    expired: {
      title: 'หมดเวลาใช้งานชั่วคราว',
      // บอกอายุจริงไปเลย ผู้ใช้จะได้ไม่คิดว่าระบบพัง
      body: 'เพื่อความปลอดภัย ระบบต่ออายุการเข้าใช้ทุก 15 นาที — กำลังพากลับเข้าระบบให้อัตโนมัติ',
      cta: 'เข้าสู่ระบบต่อ',
    },
    error: {
      title: 'ตรวจสอบตัวตนไม่สำเร็จ',
      body: state.status === 'error' ? state.message : '',
      cta: 'ลองเข้าสู่ระบบอีกครั้ง',
    },
  } as const;

  const copy = COPY[state.status];

  return (
    <div className="grid min-h-dvh place-items-center px-6">
      <div className="w-full max-w-sm text-center">
        <h1 className="text-csmju-title">{copy.title}</h1>

        <p className="mt-2 text-csmju-body text-muted-foreground">
          {copy.body}
        </p>

        {CORE_LOGIN_URL ? (
          // เป็น <a> ไม่ใช่ <Link> เพราะออกไปคนละแอปจริง ๆ
          <a
            href={CORE_LOGIN_URL}
            className="csmju-brand mt-5 inline-flex items-center justify-center rounded-xl px-5 py-2.5 text-csmju-label font-medium shadow-csmju-glow"
          >
            {copy.cta}
          </a>
        ) : (
          <p className="mt-5 rounded-xl border border-border bg-secondary/40 px-4 py-3 text-csmju-caption leading-6 text-muted-foreground">
            ยังไม่ได้ตั้ง <code>NEXT_PUBLIC_CORE_LOGIN_URL</code> —
            ดูค่าที่ถูกต้องใน <code>frontend/.env.example</code>
          </p>
        )}
      </div>
    </div>
  );
}

/// ตัวตนของผู้ใช้ปัจจุบัน — ใช้ได้เฉพาะใต้ `<SessionProvider>`
///
/// คืนค่าแบบ synchronous ได้เพราะ provider ไม่เรนเดอร์ children จนกว่าจะรู้
/// แล้วว่าเป็นใคร หน้าจอข้างในจึงไม่ต้องเขียนเคส "ยังไม่รู้ว่าเป็นใคร" ซ้ำ ๆ
export function useMe(): Me {
  const state = useContext(SessionContext);

  if (!state) {
    throw new Error('useMe ต้องอยู่ใต้ <SessionProvider>');
  }

  if (state.status !== 'ready') {
    // ไปถึงตรงนี้ไม่ได้ในทางปฏิบัติ เพราะ provider กันไว้แล้ว — ถ้าเกิดขึ้น
    // แปลว่ามีคนเรียกจากนอกต้นไม้ของ provider ซึ่งเป็นบั๊กของโครงสร้าง
    throw new Error('ยังไม่รู้ว่าผู้ใช้เป็นใคร');
  }

  return state.me;
}
