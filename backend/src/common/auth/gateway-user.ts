import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

/// Layer 1 — สิทธิ์ระดับองค์กร กำหนดโดย Admin ส่วนกลาง (Blueprint หน้า 11)
/// ค่าเหล่านี้ต้องตรงกันทุกระบบย่อยใน CSMJU2030 ห้ามเพิ่มค่าเอง
export const LAYER1_ROLES = ['student', 'alumni', 'staff', 'admin'] as const;
export type Layer1Role = (typeof LAYER1_ROLES)[number];

/// Shared Identity ที่ API Gateway แนบมาให้ (Blueprint หน้า 8, 10)
///
/// สามค่านี้เท่านั้นที่เป็นข้อมูลกลาง — ห้ามเก็บซ้ำลงฐานข้อมูลระบบย่อย
/// และห้ามใช้ user_id หรือ student_id เป็นคีย์ตัวตนแทน `username`
export interface GatewayUser {
  username: string;
  layer1Role: Layer1Role;
  faculty: string | null;
}

export const GATEWAY_HEADERS = {
  username: 'x-user-id',
  layer1Role: 'x-layer1-role',
  faculty: 'x-faculty',
} as const;

export interface RequestWithUser extends Request {
  gatewayUser?: GatewayUser;
}

/// ดึงตัวตนของผู้เรียกใน controller — `@CurrentUser() user: GatewayUser`
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): GatewayUser => {
    const request = ctx.switchToHttp().getRequest<RequestWithUser>();

    if (!request.gatewayUser) {
      // ไปถึงจุดนี้ได้แปลว่าลืมใส่ GatewayAuthGuard ที่ route นั้น
      throw new Error(
        'ไม่พบ gatewayUser ใน request — route นี้ยังไม่ได้ผ่าน GatewayAuthGuard',
      );
    }

    return request.gatewayUser;
  },
);
