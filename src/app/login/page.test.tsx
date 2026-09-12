import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/// เทสต์หน้าทางเข้าระบบ
///
/// สิ่งที่ต้องกันให้ได้ตลอดไปคือ **หน้านี้ต้องไม่มีช่องรับรหัสผ่าน**
/// Blueprint หน้า 8 ห้ามระบบย่อยทำหน้า Login เอง และเหตุผลจริงหนักกว่ากฎ:
/// ถ้า 36 ระบบย่อยต่างคนต่างรับรหัสผ่าน รหัสของนักศึกษาจะไปอยู่ 36 ที่
///
/// เทสต์นี้จะแดงทันทีถ้ามีใครเผลอเติม <input type="password"> เข้ามา

const push = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}));

const setIdentity = vi.fn();

vi.mock('@/lib/csmju/identity', () => ({
  setIdentity: (...args: unknown[]) => setIdentity(...args),
  DEV_IDENTITIES: [
    {
      username: '6704101382-anuchat',
      layer1Role: 'student',
      faculty: 'science',
      displayName: 'อนุชาติ (นักศึกษา)',
    },
    {
      username: '6700000001-ajarn',
      layer1Role: 'staff',
      faculty: 'science',
      displayName: 'อาจารย์ (บุคลากร)',
    },
  ],
}));

describe('หน้าทางเข้าระบบ', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('ต้องไม่มีช่องรับรหัสผ่านเด็ดขาด', async () => {
    const { default: LoginPage } = await import('./page');

    const { container } = render(<LoginPage />);

    expect(container.querySelector('input[type="password"]')).toBeNull();

    // และต้องไม่มีช่องกรอกอะไรเลยที่รับตัวตน
    expect(container.querySelectorAll('input')).toHaveLength(0);
  });

  it('บอกผู้ใช้ตรง ๆ ว่าไม่เก็บรหัสผ่าน', async () => {
    const { default: LoginPage } = await import('./page');

    render(<LoginPage />);

    expect(screen.getByText(/ไม่รับรหัสผ่าน/)).toBeInTheDocument();
  });



  it('หน้านี้ประกอบแถบสลับเข้าสู่ระบบ/สมัครสมาชิกเข้ามา', async () => {
    // รายละเอียดของแถบทดสอบอยู่ที่ auth-switch.test.tsx — ตรงนี้ตรวจแค่ว่า
    // หน้าเรียกใช้มันจริง ไม่ใช่วาดปุ่มเองซ้ำอีกชุด
    const { default: LoginPage } = await import('./page');

    render(<LoginPage />);

    expect(screen.getByRole('tablist')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /เข้าสู่ระบบ/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /สมัครสมาชิก/ })).toBeInTheDocument();
  });

  it('โหมดพัฒนาเลือกตัวตนแล้วเข้าแอปได้', async () => {
    // ระหว่างที่ยังไม่มี Gateway ต้องมีทางเข้าไปทดสอบระบบ
    const { default: LoginPage } = await import('./page');

    render(<LoginPage />);

    await userEvent.click(
      screen.getByRole('button', { name: /อนุชาติ \(นักศึกษา\)/ }),
    );

    expect(setIdentity).toHaveBeenCalledWith(
      expect.objectContaining({ username: '6704101382-anuchat' }),
    );
    expect(push).toHaveBeenCalledWith('/feed');
  });

  it('รายชื่อโหมดพัฒนาบอกสิทธิ์ระดับองค์กรของแต่ละคน', async () => {
    // ต้องเห็นว่ากำลังทดสอบในฐานะนักศึกษาหรืออาจารย์ ไม่งั้นจะงงว่า
    // ทำไมบางปุ่มกดไม่ได้
    const { default: LoginPage } = await import('./page');

    render(<LoginPage />);

    expect(screen.getByText('student')).toBeInTheDocument();
    expect(screen.getByText('staff')).toBeInTheDocument();
  });
});
