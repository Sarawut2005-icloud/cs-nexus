import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReactionBar } from '@/components/csmju/reaction-bar';
import type { ReactionSummary } from '@/lib/csmju/types';

/// เทสต์แถบอิโมจิ
///
/// จุดที่ต้องพิสูจน์: การถอนรีแอ็กชันส่ง DELETE พร้อม query string ที่ถูกต้อง
/// (อิโมจิต้องเข้ารหัส URL ไม่งั้นหลังบ้านจะได้ค่าเพี้ยนแล้วลบไม่ตรงตัว)

const summary = (totals: ReactionSummary['totals']): ReactionSummary => ({
  target_kind: 'POST',
  target_id: 'p1',
  totals,
  total_count: totals.reduce((sum, row) => sum + row.count, 0),
});

function mockFetch(json: unknown) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ success: true, data: json }),
  } as Response);
}

describe('ReactionBar', () => {
  const original = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = original;
  });

  it('แสดงยอดที่มีคนกดแล้ว', () => {
    render(
      <ReactionBar
        targetKind="POST"
        targetId="p1"
        summary={summary([
          { emoji: '👍', count: 3, reacted_by_me: false },
          { emoji: '🎉', count: 1, reacted_by_me: true },
        ])}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('ยังไม่มีใครกด = มีแค่ปุ่มเพิ่มรีแอ็กชัน', () => {
    render(
      <ReactionBar
        targetKind="POST"
        targetId="p1"
        summary={null}
        onChange={vi.fn()}
      />,
    );

    expect(
      screen.getByRole('button', { name: 'เพิ่มรีแอ็กชัน' }),
    ).toBeInTheDocument();
  });

  it('เลือกอิโมจิจากตัวเลือกแล้วยิง POST', async () => {
    const next = summary([{ emoji: '👍', count: 1, reacted_by_me: true }]);
    const spy = mockFetch(next);

    globalThis.fetch = spy;

    const onChange = vi.fn();

    render(
      <ReactionBar
        targetKind="POST"
        targetId="p1"
        summary={null}
        onChange={onChange}
      />,
    );

    await userEvent.click(
      screen.getByRole('button', { name: 'เพิ่มรีแอ็กชัน' }),
    );
    await userEvent.click(screen.getAllByText('👍')[0]);

    await waitFor(() => expect(onChange).toHaveBeenCalledWith(next));

    const [url, init] = spy.mock.calls[0] as [string, RequestInit];

    expect(url).toContain('/reactions');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      target_kind: 'POST',
      target_id: 'p1',
      emoji: '👍',
    });
  });

  it('กดอิโมจิที่ตัวเองกดไว้แล้ว = ถอน (DELETE พร้อม query ที่เข้ารหัสถูก)', async () => {
    const spy = mockFetch(summary([]));

    globalThis.fetch = spy;

    render(
      <ReactionBar
        targetKind="POST"
        targetId="p1"
        summary={summary([{ emoji: '👍', count: 1, reacted_by_me: true }])}
        onChange={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByTitle('กดอีกครั้งเพื่อถอน'));

    await waitFor(() => expect(spy).toHaveBeenCalled());

    const [url, init] = spy.mock.calls[0] as [string, RequestInit];

    expect(init.method).toBe('DELETE');
    // อิโมจิต้องเข้ารหัส ไม่งั้นหลังบ้านได้ค่าเพี้ยนแล้วลบไม่ตรงตัว
    expect(url).toContain('emoji=%F0%9F%91%8D');
    expect(url).toContain('target_id=p1');
  });

  it('หลังบ้านปฏิเสธแล้วแสดงเหตุผลให้ผู้ใช้เห็น', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: async () =>
        JSON.stringify({
          success: false,
          error: {
            code: 'not_found',
            message: 'ไม่พบห้องนี้ หรือคุณไม่ได้เป็นสมาชิก',
          },
        }),
    } as Response);

    render(
      <ReactionBar
        targetKind="MESSAGE"
        targetId="m1"
        summary={null}
        onChange={vi.fn()}
      />,
    );

    await userEvent.click(
      screen.getByRole('button', { name: 'เพิ่มรีแอ็กชัน' }),
    );
    await userEvent.click(screen.getAllByText('👍')[0]);

    // ข้อความจากหลังบ้านต้องถึงผู้ใช้ ไม่ใช่เงียบไปเฉย ๆ
    expect(
      await screen.findByText(/ไม่พบห้องนี้ หรือคุณไม่ได้เป็นสมาชิก/),
    ).toBeInTheDocument();
  });

  it('ตัวเลือกอิโมจิมีครบ 12 ตัวตามที่หลังบ้านอนุญาต', async () => {
    render(
      <ReactionBar
        targetKind="POST"
        targetId="p1"
        summary={null}
        onChange={vi.fn()}
      />,
    );

    await userEvent.click(
      screen.getByRole('button', { name: 'เพิ่มรีแอ็กชัน' }),
    );

    // ถ้ารายการไม่ตรงกับ ALLOWED_EMOJI ของหลังบ้าน ผู้ใช้จะกดแล้วได้ 400
    // ทั้งที่ปุ่มโผล่อยู่บนหน้าจอ
    const picker = screen.getByRole('button', {
      name: 'เพิ่มรีแอ็กชัน',
    }).parentElement;

    expect(picker?.querySelectorAll('button').length).toBe(13); // 12 + ปุ่มเปิด
  });
});

describe('ชื่อที่โปรแกรมอ่านหน้าจออ่านได้', () => {
  it('ปุ่มอิโมจิในตัวเลือกมีชื่อจริง ไม่ใช่ปุ่มเปล่า', async () => {
    // เดิมข้างในมีแต่ <span aria-hidden>{emoji}</span> ทำให้ทั้งแถวเป็น
    // "ปุ่ม" ที่ไม่มีชื่อเหมือนกันหมด เลือกไม่ถูกว่าอันไหนคืออันไหน
    render(
      <ReactionBar
        targetKind="POST"
        targetId="p1"
        summary={summary([])}
        onChange={vi.fn()}
      />,
    );

    await userEvent.click(
      screen.getByRole('button', { name: 'เพิ่มรีแอ็กชัน' }),
    );

    expect(screen.getByRole('button', { name: 'ถูกใจ' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ขอบคุณ' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ไอเดีย' })).toBeInTheDocument();
  });

  it('ยอดที่กดแล้วอ่านออกว่าเป็นอิโมจิอะไร กี่คน', async () => {
    render(
      <ReactionBar
        targetKind="POST"
        targetId="p1"
        summary={summary([{ emoji: '👍', count: 3, reacted_by_me: true }])}
        onChange={vi.fn()}
      />,
    );

    expect(
      screen.getByRole('button', { name: /ถูกใจ 3 คน · คุณกดแล้ว/ }),
    ).toBeInTheDocument();
  });
});

