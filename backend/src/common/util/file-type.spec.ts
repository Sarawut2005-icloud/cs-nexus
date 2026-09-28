import { describe, expect, it } from 'vitest';
import {
  FileTypeError,
  assertUploadableName,
  sniffFileType,
} from './file-type.js';

/// เทสต์การตัดสินชนิดไฟล์ที่ผู้ใช้อัปโหลด
///
/// จุดนี้เป็นด่านความปลอดภัยด่านสุดท้ายก่อนไฟล์ของคนอื่นจะถูกเสิร์ฟกลับออกไป
/// ทั้งนามสกุลและ Content-Type ผู้ใช้แก้ได้ตามใจ จึงต้องตัดสินจากไบต์จริง
///
/// **เอกสาร Office ยากกว่าที่คิด** เพราะ .docx/.xlsx/.pptx คือไฟล์ zip
/// ส่วน .doc/.xls/.ppt ใช้ภาชนะ OLE2 ร่วมกันทั้งสามชนิด — ดูแค่หัวไฟล์
/// จึงแยกไม่ออกว่าเป็นอะไร ต้องอ่านนามสกุลประกอบ

/// หัวไฟล์จริงของแต่ละรูปแบบ
const HEADERS = {
  png: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0]),
  gif: Buffer.from('GIF89a' + '\u0001\u0000\u0001\u0000\u0000\u0000\u0000\u0000\u0000\u0000'),
  pdf: Buffer.from('%PDF-1.7\n%โครง\n'),
  zip: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
  ole2: Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0, 0, 0, 0, 0]),
  mp4: Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from('ftypisom'), Buffer.alloc(4)]),
  text: Buffer.from('บันทึกการประชุม\n- แบ่งงาน\n'),
};

describe('เอกสาร Office', () => {
  it('**รับ .docx ได้** — ผู้ใช้เรียกมันว่า "ไฟล์ Word"', () => {
    expect(sniffFileType(HEADERS.zip, 'รายงานกลุ่ม.docx')).toEqual({
      kind: 'DOCUMENT',
      mimeType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
  });

  it('รับ .xlsx และ .pptx ด้วย — ภาชนะเดียวกัน คนละชนิด', () => {
    expect(sniffFileType(HEADERS.zip, 'คะแนน.xlsx').mimeType).toContain(
      'spreadsheetml',
    );
    expect(sniffFileType(HEADERS.zip, 'นำเสนอ.pptx').mimeType).toContain(
      'presentationml',
    );
  });

  it('รับ Word รุ่นเก่า .doc ที่เป็นภาชนะ OLE2', () => {
    expect(sniffFileType(HEADERS.ole2, 'ใบงานเก่า.doc')).toEqual({
      kind: 'DOCUMENT',
      mimeType: 'application/msword',
    });
  });

  it('.zip ธรรมดายังเป็น ARCHIVE ไม่ใช่เอกสาร', () => {
    // ถ้าเผลอตัดสินจากภาชนะอย่างเดียว ไฟล์ zip ทุกไฟล์จะกลายเป็น Word
    expect(sniffFileType(HEADERS.zip, 'โปรเจกต์.zip')).toEqual({
      kind: 'ARCHIVE',
      mimeType: 'application/zip',
    });
  });

  it('OLE2 ที่นามสกุลไม่ใช่ของ Office ไม่รับ', () => {
    // ภาชนะ OLE2 ใช้กับไฟล์เก่าหลายอย่างรวมถึงตัวติดตั้ง — รับเฉพาะที่รู้จัก
    expect(() => sniffFileType(HEADERS.ole2, 'ของเก่า.pdf')).toThrow(
      FileTypeError,
    );
  });

  it('.docx ที่ข้างในไม่ใช่ zip ถูกจับได้', () => {
    expect(() => sniffFileType(HEADERS.mp4, 'หลอก.docx')).toThrow(FileTypeError);
  });

  it('**ไม่รับไฟล์ Office ที่ฝังมาโครได้**', () => {
    // .docm รันโค้ดบนเครื่องคนที่เปิด — เป็นช่องแพร่มัลแวร์ที่ยังใช้ได้ผลอยู่
    for (const name of ['มาโคร.docm', 'มาโคร.xlsm', 'มาโคร.pptm']) {
      expect(() => assertUploadableName(name)).toThrow(FileTypeError);
    }
  });
});

describe('ชนิดไฟล์ที่รองรับอยู่เดิม ต้องไม่พังตาม', () => {
  it('GIF เป็นรูปภาพ', () => {
    expect(sniffFileType(HEADERS.gif, 'สติกเกอร์.gif')).toEqual({
      kind: 'IMAGE',
      mimeType: 'image/gif',
    });
  });

  it('PNG · PDF · MP4 · ข้อความ ยังตัดสินได้ถูก', () => {
    expect(sniffFileType(HEADERS.png, 'รูป.png').kind).toBe('IMAGE');
    expect(sniffFileType(HEADERS.pdf, 'ใบงาน.pdf').kind).toBe('DOCUMENT');
    expect(sniffFileType(HEADERS.mp4, 'คลิป.mp4').kind).toBe('VIDEO');
    expect(sniffFileType(HEADERS.text, 'บันทึก.txt').kind).toBe('CODE');
  });

  it('ยังกันไฟล์ที่เบราว์เซอร์เปิดเป็นหน้าเว็บได้เหมือนเดิม', () => {
    for (const name of ['หน้า.html', 'ไอคอน.svg', 'ตัวติดตั้ง.exe']) {
      expect(() => assertUploadableName(name)).toThrow(FileTypeError);
    }
  });

  it('ยังจับไฟล์ปลอมนามสกุลได้เหมือนเดิม', () => {
    expect(() => sniffFileType(HEADERS.zip, 'หลอก.png')).toThrow(FileTypeError);
  });
});
