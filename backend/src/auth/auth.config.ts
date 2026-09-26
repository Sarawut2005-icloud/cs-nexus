/// ค่าตั้งต้นของชั้นยืนยันตัวตน — อ่านจาก env ตาม contracts/vocabulary.json
///
/// `requiredEnvVars` ในสัญญากำหนดห้าตัวนี้ไว้ ห้ามพิมพ์ค่าลงโค้ดเอง
/// (auth-contract.md ข้อ 2: "ให้โค้ดอ่านจากไฟล์/env ไม่ใช่พิมพ์ค่าเอง")
///
/// อ่านเป็นฟังก์ชัน ไม่ใช่ค่าคงที่ระดับโมดูล เพราะชุดทดสอบต้องสลับค่า env
/// ระหว่างเคสได้ ถ้าอ่านตอน import ค่าจะถูกตรึงไว้ตั้งแต่ไฟล์แรกที่โหลด

export interface AuthConfig {
  coreHubUrl: string;
  jwksUrl: string;
  issuer: string;
  audience: string;
  subsystemId: string;
  jwksCacheTtlMs: number;
  jwksMinRefreshIntervalMs: number;
  jwksRequestTimeoutMs: number;
  clockToleranceSec: number;
}

function num(name: string, fallback: number): number {
  const raw = process.env[name];

  if (raw === undefined || raw.trim() === '') return fallback;

  const value = Number(raw);

  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

export function authConfig(): AuthConfig {
  const coreHubUrl = (process.env.CORE_HUB_URL ?? '').replace(/\/+$/, '');

  return {
    coreHubUrl,

    // สัญญากำหนดเส้นทาง JWKS ไว้ตายตัวที่ /api/v1/.well-known/jwks.json
    // แต่ยอมให้ override ได้ เพราะ Dev Server อาจวางไว้คนละที่ระหว่างทดสอบ
    jwksUrl:
      process.env.CORE_HUB_JWKS_URL ??
      `${coreHubUrl}/api/v1/.well-known/jwks.json`,

    issuer: process.env.CORE_HUB_ISSUER ?? 'core-hub',
    audience: process.env.CORE_HUB_AUDIENCE ?? 'csmju2030',
    subsystemId: process.env.SUBSYSTEM_ID ?? 'csmju-social-reels',

    jwksCacheTtlMs: num('JWKS_CACHE_TTL_MS', 600_000),
    jwksMinRefreshIntervalMs: num('JWKS_MIN_REFRESH_INTERVAL_MS', 30_000),
    jwksRequestTimeoutMs: num('JWKS_REQUEST_TIMEOUT_MS', 5_000),

    // สัญญาข้อ 4 ยอมให้เหลื่อมได้ "ไม่เกิน 60 วินาที" — ตัวเลขนี้คือเพดาน
    // ไม่ใช่ค่าที่แนะนำ เทมเพลตของมาตรฐานตั้งไว้ 5 จึงใช้ค่านั้นเป็นค่าเริ่มต้น
    clockToleranceSec: Math.min(num('JWT_CLOCK_TOLERANCE_SEC', 5), 60),
  };
}
