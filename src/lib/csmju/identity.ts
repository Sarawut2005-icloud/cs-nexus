/// ตัวตนที่หน้าบ้านใช้ตอนพัฒนา — **ของชั่วคราว จะถูกลบเมื่อ Core พร้อม**
///
/// Blueprint หน้า 8 ห้ามระบบย่อยทำหน้า login เอง ฉะนั้นไฟล์นี้ไม่ใช่ระบบ
/// ยืนยันตัวตน มันคือสวิตช์สำหรับ "สวมบทเป็นใคร" ระหว่างที่ยังไม่มี SSO
/// กลางให้เข้า — ไม่มีการตรวจรหัสผ่าน ไม่มีการออก token
///
/// ของจริงจะเป็นแบบนี้:
///   ผู้ใช้ล็อกอินที่ Core → Gateway แนบ X-User-Id ให้ทุก request →
///   หลังบ้านตั้ง DEV_FAKE_GATEWAY=false แล้ว header จากหน้าบ้านจะไร้ผล
///
/// พอถึงตอนนั้น ลบไฟล์นี้กับ IdentitySwitcher ทิ้ง แล้วอ่านตัวตนจาก
/// GET /subsystem-members/me แทน — ที่เหลือของแอปไม่ต้องแก้เลย
/// เพราะทุกที่เรียกผ่าน api.ts อยู่แล้ว

export type Layer1Role = 'student' | 'alumni' | 'staff' | 'admin';

export interface Identity {
  username: string;
  layer1Role: Layer1Role;
  faculty: string;
  displayName: string;
}

const STORAGE_KEY = 'csmju:dev-identity';

/// ตัวละครสำหรับทดลอง — ครอบทุก Layer 1 role เพื่อให้เห็นความต่างของสิทธิ์
///
/// ชุดนี้ตรงกับที่ใช้ในสคริปต์ทดสอบของหลังบ้าน ทำให้ข้อมูลที่เทสต์สร้างไว้
/// โผล่ในหน้าจอทันทีโดยไม่ต้องสร้างใหม่
export const DEV_IDENTITIES: Identity[] = [
  {
    username: '6704101382-anuchat',
    layer1Role: 'student',
    faculty: 'science',
    displayName: 'อนุชาติ (นักศึกษา)',
  },
  {
    username: '6704101999-somchai',
    layer1Role: 'student',
    faculty: 'science',
    displayName: 'สมชาย (นักศึกษา)',
  },
  {
    username: '6704101777-malee',
    layer1Role: 'student',
    faculty: 'science',
    displayName: 'มาลี (นักศึกษา)',
  },
  {
    username: '6700000001-ajarn',
    layer1Role: 'staff',
    faculty: 'science',
    displayName: 'อาจารย์ (บุคลากร)',
  },
  {
    username: '6700000000-admin',
    layer1Role: 'admin',
    faculty: 'science',
    displayName: 'ผู้ดูแลระบบ (admin)',
  },
];

export const DEFAULT_IDENTITY = DEV_IDENTITIES[0];

/// อ่านตัวตนปัจจุบัน — เรียกได้ทั้งฝั่ง server และ client
///
/// ฝั่ง server ไม่มี localStorage จึงคืนค่าเริ่มต้น ซึ่งไม่มีปัญหาเพราะทุก
/// หน้าจอที่ดึงข้อมูลเป็น Client Component (ข้อมูลขึ้นกับว่าใครเป็นผู้เรียก
/// จึง prerender ล่วงหน้าไม่ได้อยู่แล้ว)
export function getIdentity(): Identity {
  if (typeof window === 'undefined') {
    return DEFAULT_IDENTITY;
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);

    if (!raw) {
      return DEFAULT_IDENTITY;
    }

    const parsed = JSON.parse(raw) as Identity;
    const known = DEV_IDENTITIES.find((i) => i.username === parsed.username);

    // ยึดรายการที่โค้ดรู้จักเป็นหลัก เผื่อ localStorage ค้างค่าเก่าจาก
    // รอบก่อนที่รายชื่อยังไม่เหมือนนี้
    return known ?? DEFAULT_IDENTITY;
  } catch {
    return DEFAULT_IDENTITY;
  }
}

export function setIdentity(identity: Identity): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
  } catch {
    // โหมดส่วนตัวของเบราว์เซอร์บล็อก localStorage ได้ — ไม่ใช่เรื่องคอขาดบาดตาย
    // เพราะค่าเริ่มต้นยังใช้งานได้ แค่จำไม่ได้เมื่อรีเฟรช
  }
}
