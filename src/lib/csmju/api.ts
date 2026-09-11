/// ตัวเรียก API ของหลังบ้าน — จุดเดียวที่หน้าบ้านคุยกับข้อมูล
///
/// **หน้าบ้านห้ามต่อฐานข้อมูลเอง** (Blueprint หน้า 13) ทุกอย่างต้องผ่านที่นี่
/// ถ้าเห็น import ของ Prisma หรือ pg ในโฟลเดอร์ src/ ที่ไม่ใช่ backend/
/// นั่นคือการละเมิดข้อห้าม ไม่ใช่ทางลัด
///
/// แกะ envelope ให้ที่ชั้นนี้ชั้นเดียว เพื่อให้หน้าจอเขียน
///   const posts = await api.get<Post[]>('/posts')
/// แทนที่จะต้องจำ `res.data` ทุกครั้ง แล้วลืมเช็ค success ในบางที่

import { getIdentity } from './identity';

const BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

export interface PaginationMeta {
  current_page: number;
  per_page: number;
  total_pages: number;
  total_items: number;
}

export interface Page<T> {
  items: T[];
  meta: PaginationMeta;
}

/// ข้อผิดพลาดที่ยังถือ code กับข้อความจากหลังบ้านไว้
///
/// หลังบ้านตอบ message เป็นภาษาไทยที่อ่านรู้เรื่องอยู่แล้ว (เช่น
/// "ห้องเต็มแล้ว (8/8 คน)") จึงเอาไปแสดงตรง ๆ ได้ ไม่ต้องแปลใหม่ที่หน้าบ้าน
/// — และไม่ควรแปลใหม่ เพราะข้อความจะเพี้ยนจากของจริงทันทีที่กฎหลังบ้านเปลี่ยน
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: string[] = [],
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /// true เมื่อเป็นเรื่องที่ผู้ใช้แก้เองได้ (กรอกผิด สิทธิ์ไม่พอ ของเต็ม)
  /// ต่างจาก 500 ที่เป็นความผิดของเรา และต้องขึ้นข้อความคนละแบบ
  get isUserFixable(): boolean {
    return this.status >= 400 && this.status < 500;
  }
}

interface Envelope<T> {
  success: boolean;
  data?: T;
  meta?: PaginationMeta;
  error?: { code: string; message: string; details?: string[] };
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ data: T; meta?: PaginationMeta }> {
  const identity = getIdentity();

  let response: Response;

  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        // ระหว่างที่ API Gateway ของ Core ยังไม่พร้อม หน้าบ้านแนบ header
        // เองเพื่อทดสอบหลายผู้ใช้ในเครื่องเดียว — ของจริง Gateway จะแนบให้
        // และหลังบ้านตั้ง DEV_FAKE_GATEWAY=false แล้ว header จากที่นี่จะไร้ผล
        'x-user-id': identity.username,
        'x-layer1-role': identity.layer1Role,
        'x-faculty': identity.faculty,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    // fetch โยน TypeError ว่า "Failed to fetch" ทั้งกรณีเซิร์ฟเวอร์ไม่ได้รัน
    // กรณีเน็ตหลุด และกรณีถูก CORS บล็อก — เบราว์เซอร์ตั้งใจไม่บอกว่าอันไหน
    // เพื่อไม่ให้หน้าเว็บสำรวจเครือข่ายของผู้ใช้ได้
    //
    // ข้อความดิบนั้นไม่ช่วยอะไรใครเลย จึงแปลงเป็นคำแนะนำที่ทำตามได้จริง
    throw new ApiError(
      0,
      'network_error',
      `ติดต่อหลังบ้านที่ ${BASE_URL} ไม่ได้ — ตรวจว่ารันอยู่ไหม ` +
        '(cd backend && npm run start:dev) และฐานข้อมูลขึ้นแล้วหรือยัง (npm run db:up)',
    );
  }

  // 204 No Content ไม่มี body ให้ parse
  if (response.status === 204) {
    return { data: undefined as T };
  }

  const text = await response.text();
  let payload: Envelope<T>;

  try {
    payload = JSON.parse(text) as Envelope<T>;
  } catch {
    // เจอกรณีนี้ตอนหลังบ้านไม่ได้รัน แล้ว fetch ได้หน้า error ของ dev server
    throw new ApiError(
      response.status,
      'bad_response',
      `หลังบ้านตอบไม่ใช่ JSON (HTTP ${response.status}) — เซิร์ฟเวอร์รันอยู่ไหม`,
    );
  }

  if (!response.ok || payload.success === false) {
    throw new ApiError(
      response.status,
      payload.error?.code ?? 'unknown',
      payload.error?.message ?? `คำขอไม่สำเร็จ (HTTP ${response.status})`,
      payload.error?.details ?? [],
    );
  }

  return { data: payload.data as T, meta: payload.meta };
}

export const api = {
  async get<T>(path: string): Promise<T> {
    return (await request<T>('GET', path)).data;
  },

  /// สำหรับ endpoint แบบ list — คืนทั้งรายการและ meta ของการแบ่งหน้า
  async list<T>(path: string): Promise<Page<T>> {
    const { data, meta } = await request<T[]>('GET', path);

    return {
      items: data ?? [],
      meta: meta ?? {
        current_page: 1,
        per_page: data?.length ?? 0,
        total_pages: 1,
        total_items: data?.length ?? 0,
      },
    };
  },

  async post<T>(path: string, body?: unknown): Promise<T> {
    return (await request<T>('POST', path, body)).data;
  },

  async patch<T>(path: string, body?: unknown): Promise<T> {
    return (await request<T>('PATCH', path, body)).data;
  },

  async put<T>(path: string, body?: unknown): Promise<T> {
    return (await request<T>('PUT', path, body)).data;
  },

  async del<T>(path: string): Promise<T> {
    return (await request<T>('DELETE', path)).data;
  },
};

/// ต่อ query string โดยตัด key ที่เป็น undefined ออก
///
/// จำเป็นเพราะ ValidationPipe ของหลังบ้านตั้ง forbidNonWhitelisted ไว้
/// ถ้าส่ง `?course_tag=undefined` ไปจะได้ 400 ไม่ใช่ถูกมองข้าม
export function qs(params: Record<string, string | number | boolean | undefined>) {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') {
      search.set(key, String(value));
    }
  }

  const query = search.toString();

  return query ? `?${query}` : '';
}
