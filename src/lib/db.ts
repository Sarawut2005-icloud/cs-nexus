import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

// Prisma 7 บังคับใช้ driver adapter สำหรับทุก SQL provider — connection string
// ไม่อยู่ใน schema แล้ว จึงต้องส่งเข้ามาที่นี่ (สเปกสถาปัตยกรรม D3)
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("ไม่พบ DATABASE_URL — ตั้งค่าใน .env ก่อนเริ่มเซิร์ฟเวอร์");
}

const createPrismaClient = () =>
  new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });

// บน Vercel ทุก cold start เปิด connection ใหม่ ส่วนตอน dev การ hot reload
// จะสร้าง client ใหม่ทุกครั้งถ้าไม่เก็บไว้ที่ global — ทั้งสองทางกินโควตา
// connection ของ Postgres จนหมด ฉะนั้น connection string ต้องชี้ไปที่ pooler
const globalForPrisma = globalThis as unknown as {
  prisma?: ReturnType<typeof createPrismaClient>;
};

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
