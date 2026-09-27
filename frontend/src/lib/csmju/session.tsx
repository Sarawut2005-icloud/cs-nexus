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

import { api, ApiError } from './api';

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
  | { status: 'error'; message: string };

const SessionContext = createContext<State | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ status: 'loading' });

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
/// **ไม่ redirect อัตโนมัติ** เพราะการเด้งออกทันทีทำให้คนที่ token เพิ่งหมดอายุ
/// เสียสิ่งที่กำลังพิมพ์อยู่โดยไม่ทันรู้ตัว และถ้าเกิดวนลูป (คุกกี้ตั้งไม่ติด
/// เพราะ CORS ผิด) จะกลายเป็นหน้าจอกะพริบที่หาสาเหตุไม่เจอ
function SessionGate({ state }: { state: Exclude<State, { status: 'ready' }> }) {
  if (state.status === 'loading') {
    return (
      <div className="grid min-h-dvh place-items-center px-6">
        <p className="text-sm text-muted-foreground">กำลังตรวจสอบตัวตน…</p>
      </div>
    );
  }

  const isAnonymous = state.status === 'anonymous';

  return (
    <div className="grid min-h-dvh place-items-center px-6">
      <div className="w-full max-w-sm text-center">
        <h1 className="text-lg font-semibold">
          {isAnonymous ? 'ต้องเข้าสู่ระบบก่อน' : 'ตรวจสอบตัวตนไม่สำเร็จ'}
        </h1>

        <p className="mt-2 text-sm leading-7 text-muted-foreground">
          {isAnonymous
            ? 'ระบบนี้ใช้บัญชีเดียวกับ CSMJU2030 — เข้าสู่ระบบที่ศูนย์กลางแล้วจะพากลับมาที่นี่เอง'
            : state.message}
        </p>

        {CORE_LOGIN_URL ? (
          // เป็น <a> ไม่ใช่ <Link> เพราะออกไปคนละแอปจริง ๆ
          <a
            href={CORE_LOGIN_URL}
            className="mt-5 inline-flex items-center justify-center rounded-xl bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground"
          >
            เข้าสู่ระบบด้วยบัญชี CSMJU2030
          </a>
        ) : (
          <p className="mt-5 rounded-xl border border-border bg-secondary/40 px-4 py-3 text-xs leading-6 text-muted-foreground">
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
