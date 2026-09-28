import { api } from '@/lib/csmju/api';

/// ท่ออัปโหลดไฟล์สามจังหวะของหลังบ้าน
///
///   1. ขอ intent → ได้ signed URL (ตรวจโควตากับนามสกุลที่จังหวะนี้)
///   2. PUT ไบต์ขึ้น storage ตรง ๆ ไม่ผ่าน API ของเรา
///   3. commit → หลังบ้านตรวจ magic bytes กับขนาดจริง แล้วตัดโควตา
///
/// **จังหวะที่สามข้ามไม่ได้** เพราะเป็นจุดที่กันไฟล์ปลอมนามสกุล ถ้าข้าม ไฟล์
/// จะค้างสถานะ PENDING แล้วถูกตัวเก็บกวาดลบทิ้งภายในชั่วโมง โดยที่ผู้ใช้เห็น
/// ว่าอัปโหลดสำเร็จไปแล้ว
///
/// รวมมาไว้ที่เดียวเพราะเดิมโค้ดชุดนี้ถูกคัดลอกไว้สามที่ (ลงคลิป · ลงสตอรี่ ·
/// เปลี่ยนรูปโปรไฟล์) เวลาสัญญาหลังบ้านเปลี่ยน จะต้องไล่แก้ครบทุกที่ ซึ่ง
/// พลาดง่ายมากและพลาดแล้วเงียบ

export type AssetBucket = 'reels' | 'attachments';

export type AssetKind = 'IMAGE' | 'VIDEO' | 'CODE' | 'DOCUMENT' | 'ARCHIVE';

export interface UploadedAsset {
  asset_id: string;
  file_name: string;
  kind: AssetKind;
  mime_type: string;
  size_bytes: string;
}

interface UploadIntent {
  asset_id: string;
  upload_url: string;
  upload_method: string;
  upload_headers: Record<string, string>;
  expires_at: string;
}

interface AssetResponse {
  id: string;
  file_name: string;
  kind: AssetKind;
  mime_type: string;
  size_bytes: string;
  status: string;
}

/// อัปโหลดไฟล์หนึ่งไฟล์จนพร้อมใช้งาน
///
/// `onStep` มีไว้บอกผู้ใช้ว่ากำลังทำอะไรอยู่ — ไฟล์ 40 MB ใช้เวลาหลายวินาที
/// ถ้าไม่บอก ผู้ใช้จะกดซ้ำเพราะนึกว่าไม่ทำงาน
export async function uploadFile(
  file: File,
  bucket: AssetBucket,
  onStep?: (step: string) => void,
): Promise<UploadedAsset> {
  onStep?.('ขอสิทธิ์อัปโหลด…');

  const intent = await api.post<UploadIntent>('/assets/upload-intents', {
    file_name: file.name,
    size_bytes: file.size,
    bucket,
  });

  onStep?.('อัปโหลดไฟล์…');

  // ใช้ method และ header ที่หลังบ้านสั่งมา ไม่ hardcode — ตอนย้ายไป
  // Supabase Storage ค่าพวกนี้จะเปลี่ยน ถ้า hardcode ไว้ที่หน้าบ้าน
  // การอัปโหลดจะพังทั้งระบบโดยที่หลังบ้านไม่มีอะไรผิด
  const put = await fetch(intent.upload_url, {
    method: intent.upload_method || 'PUT',
    headers: intent.upload_headers ?? {},
    body: file,
  });

  if (!put.ok) {
    throw new Error(`อัปโหลดไฟล์ไม่สำเร็จ (HTTP ${put.status})`);
  }

  onStep?.('ยืนยันไฟล์…');

  const asset = await api.post<AssetResponse>(
    `/assets/${intent.asset_id}/commit`,
  );

  return {
    asset_id: asset.id,
    file_name: asset.file_name,
    kind: asset.kind,
    mime_type: asset.mime_type,
    size_bytes: asset.size_bytes,
  };
}

/// ขนาดไฟล์แบบที่คนอ่านรู้เรื่อง
///
/// หลังบ้านส่งมาเป็น string เพราะ BigInt เกินช่วงของ JSON number
export function formatBytes(sizeBytes: string | number): string {
  const bytes = typeof sizeBytes === 'string' ? Number(sizeBytes) : sizeBytes;

  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;

  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;

  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }

  // ทศนิยมหนึ่งตำแหน่งพอ — "1.5 MB" อ่านง่ายกว่า "1.48 MB"
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/// นามสกุลที่ช่องเลือกไฟล์ควรเสนอ
///
/// ต้องตรงกับบัญชีของหลังบ้าน (`common/util/file-type.ts`) ไม่งั้นผู้ใช้จะเลือก
/// ไฟล์ที่ระบบไม่รับได้ แล้วเพิ่งมารู้ตอนอัปโหลดเสร็จ ซึ่งเสียเวลาเปล่า
export const ACCEPTED_UPLOAD_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'application/pdf',
  'application/zip',
  '.docx',
  '.xlsx',
  '.pptx',
  '.doc',
  '.xls',
  '.ppt',
  '.txt',
  '.md',
  '.csv',
  '.json',
].join(',');
