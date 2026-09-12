'use client'; // Error boundaries ต้องเป็น Client Component

/// ตาข่ายชั้นสุดท้าย — รับ error ที่เกิดใน root layout เอง
///
/// `error.tsx` รับ error ของหน้าต่าง ๆ ได้ แต่ถ้า root layout พังเสียเอง
/// มันจะไม่ถูกเรียก เพราะตัวมันอยู่ **ข้างใน** layout นั้น ไฟล์นี้จึงต้อง
/// วาด <html> และ <body> ของตัวเอง (Next บังคับ) และห้ามพึ่งอะไรจาก layout
///
/// เขียน style ฝังในไฟล์ ไม่ใช้คลาสของ Tailwind เพราะถ้า layout พัง
/// ตั้งแต่ต้น globals.css อาจยังไม่ถูกโหลด — หน้าจอนี้ต้องอ่านออกเสมอ
/// แม้ทุกอย่างอื่นจะล่มหมดแล้ว
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    // global-error ต้องมีแท็ก html และ body ของตัวเอง
    <html lang="th">
      <body
        style={{
          margin: 0,
          minHeight: '100dvh',
          display: 'grid',
          placeItems: 'center',
          padding: '1.5rem',
          fontFamily: 'system-ui, sans-serif',
          background: '#f8fafc',
          color: '#334155',
        }}
      >
        <div style={{ maxWidth: '28rem', textAlign: 'center' }}>
          <h1 style={{ fontSize: '1.25rem', margin: '0 0 0.5rem' }}>
            ระบบขัดข้อง
          </h1>

          <p style={{ fontSize: '0.875rem', lineHeight: 1.7, margin: 0 }}>
            เกิดข้อผิดพลาดร้ายแรงจนแสดงหน้าตามปกติไม่ได้ —
            ลองโหลดใหม่อีกครั้ง ถ้ายังเป็นอยู่ให้แจ้งผู้ดูแล
          </p>

          <button
            type="button"
            onClick={() => retry()}
            style={{
              marginTop: '1.25rem',
              padding: '0.65rem 1.25rem',
              borderRadius: '0.75rem',
              border: 'none',
              background: '#004c99',
              color: '#ffffff',
              fontSize: '0.875rem',
              cursor: 'pointer',
            }}
          >
            โหลดใหม่
          </button>

          {error.digest && (
            <p
              style={{
                marginTop: '0.75rem',
                fontSize: '0.75rem',
                fontFamily: 'ui-monospace, monospace',
                color: '#64748b',
              }}
            >
              รหัสอ้างอิง: {error.digest}
            </p>
          )}
        </div>
      </body>
    </html>
  );
}
