import { SetMetadata } from '@nestjs/common';

export const CORE_HUB_PUBLIC_KEY = 'csmju:coreHubPublic';

/// เปิดให้เรียกได้โดยไม่ต้องมี token ของ Core Hub
///
/// สัญญาอนุญาตแค่ **สองเส้นทาง** (contracts/vocabulary.json `requiredRoutes`
/// + api-conventions.md ข้อ 1): `GET /api/health` และ `GET /auth/callback`
/// route อื่นที่ติดตัวนี้ = ช่องโหว่ ไม่ใช่ความสะดวก
///
/// **ทำไมไม่ใช้ `@Public()` ตัวเดิมที่มีอยู่แล้ว**
///
/// ตัวเดิมคุม `GatewayAuthGuard` ซึ่งยังทำงานอยู่ระหว่างย้ายไป JWKS
/// ถ้าใช้คีย์เดียวกัน `/api/v1/me` จะต้องติด `@Public()` เพื่อให้ด่านเก่า
/// ปล่อยผ่าน แล้วด่านใหม่จะเห็นคีย์เดียวกันและปล่อยผ่านตามไปด้วย —
/// กลายเป็น endpoint ที่ไม่มีใครตรวจเลยทั้งที่ดูเหมือนมีสองด่าน
export const CoreHubPublic = () => SetMetadata(CORE_HUB_PUBLIC_KEY, true);
