import { SetMetadata } from '@nestjs/common';
import type { Layer1Role } from './gateway-user.js';

export const LAYER1_ROLES_KEY = 'csmju:layer1Roles';

/// จำกัด route ตามสิทธิ์ระดับองค์กร เช่น @Layer1Roles('staff', 'admin')
export const Layer1Roles = (...roles: Layer1Role[]) =>
  SetMetadata(LAYER1_ROLES_KEY, roles);
