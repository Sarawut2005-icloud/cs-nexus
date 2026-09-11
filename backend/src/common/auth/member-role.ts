import type { PrismaService } from '../prisma/prisma.service.js';
import type { GatewayUser, Layer1Role } from './gateway-user.js';
import type { Layer2Role } from '../../generated/prisma/enums.js';

/// default_role_mapping ตาม subsystem.yaml — ต้องตรงกับที่ยื่นให้ PM อนุมัติ
export function defaultLayer2Role(layer1Role: Layer1Role): Layer2Role {
  switch (layer1Role) {
    case 'admin':
      return 'ADMIN';
    case 'staff':
      return 'EDITOR';
    case 'student':
    case 'alumni':
    default:
      return 'GUEST';
  }
}

/// ใครทำสิ่งที่กระทบทั้งห้องได้ (เพิ่มสมาชิก · นัดประชุม)
///
/// จุดเดียวที่ตัดสินเรื่องนี้ เพราะเดิมเขียนซ้ำสองที่แล้วเขียนผิดเหมือนกัน
/// ทั้งสองที่: เงื่อนไขคือ "ไม่ใช่ผู้ดูแลห้อง **และ** เป็นนักศึกษา" จึงห้าม
/// ได้เฉพาะนักศึกษา — ศิษย์เก่าที่เป็นสมาชิกธรรมดาผ่านฉลุย แล้วดึงใครก็ได้
/// เข้าห้องส่วนตัว ซึ่งคนที่ถูกดึงเข้ามาอ่านประวัติแชททั้งห้องได้ทันที
///
/// ข้อความ error ที่เขียนไว้ว่า "เฉพาะผู้ดูแลห้องหรืออาจารย์" คือเจตนาจริง
/// โค้ดต่างหากที่ไม่ตรงกับมัน
export function canAdministerChannel(
  channelRole: string,
  user: GatewayUser,
): boolean {
  return (
    channelRole === 'MODERATOR' ||
    user.layer1Role === 'staff' ||
    user.layer1Role === 'admin'
  );
}

/// หาแถวสมาชิกของผู้เรียก และปรับสิทธิ์ให้ตรงกับ layer1_role ถ้าจำเป็น
///
/// จุดเดียวในระบบที่ตัดสินว่า "คนนี้มีสิทธิ์ Layer 2 อะไร" — ทั้ง RolesGuard
/// และ GET /subsystem-members/me เรียกตัวนี้ ไม่เขียนตรรกะซ้ำสองที่
///
/// เหตุผลที่ต้องปรับ: เราไม่เก็บ layer1_role (หน้า 10) จึงรู้ค่าจริงเฉพาะ
/// ตอนเจ้าตัวยิง request เข้ามา ถ้าแถวถูกสร้างโดยคนอื่น (เช่นผู้ดูแลตั้ง
/// โควตาล่วงหน้า) มันจะได้ค่าเริ่มต้น GUEST ซึ่งผิดสำหรับอาจารย์ —
/// การมาถึงของ request แรกคือโอกาสเดียวที่จะแก้ให้ถูก
///
/// เขียนฐานข้อมูลเฉพาะเมื่อค่าไม่ตรง ไม่ใช่ทุก request
export async function resolveMember(prisma: PrismaService, user: GatewayUser) {
  const expected = defaultLayer2Role(user.layer1Role);

  // upsert ไม่ใช่ findUnique-แล้ว-create เพราะหน้าแรกของแอปยิงหลายคำขอพร้อมกัน
  // (GET /subsystem-members/me และทุก route ที่มี @Layer2Roles ต่างก็เรียกตัวนี้)
  // ทั้งคู่เห็นว่ายังไม่มีแถว ต่างก็ create แล้วตัวที่สองชน unique constraint
  // กลายเป็น 500 ในคำขอแรกสุดของผู้ใช้ใหม่ทุกคน — ช่วงเวลาที่แย่ที่สุดที่จะพัง
  const existing = await prisma.subsystemMember.upsert({
    where: { username: user.username },
    create: { username: user.username, layer2Role: expected },
    update: {},
  });

  // ผู้ดูแลตั้งค่านี้ด้วยมือ = เจตนาของคน ห้ามเขียนทับด้วยการแปลงอัตโนมัติ
  if (existing.layer2RoleExplicit || existing.layer2Role === expected) {
    return existing;
  }

  return prisma.subsystemMember.update({
    where: { username: user.username },
    data: { layer2Role: expected },
  });
}
