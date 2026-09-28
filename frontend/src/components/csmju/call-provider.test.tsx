import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

/// เทสต์ตัวจัดการสาย
///
/// เป็นเครื่องสถานะที่ซับซ้อนที่สุดในหน้าบ้าน: ไมค์ · WebRTC · เสียงกริ่ง ·
/// การรับ/ปฏิเสธ/ยกเลิก และต้องทำงานได้ทุกหน้าจอเพราะอยู่ใน layout
///
/// สิ่งที่ต้องพิสูจน์คือ **ทางที่ผิดพลาด**: ปฏิเสธไมค์ · อีกฝ่ายไม่รับ ·
/// หลังบ้านปฏิเสธ — ทุกทางต้องคืนสถานะให้สะอาด ไม่ค้างสายไว้

/// ปุ่ม "หยุดแชร์หน้าจอ" มีสองที่: บนแถบควบคุมของสาย และบนกรอบจอที่กำลัง
/// แชร์ (แบบ Discord) ทั้งคู่ทำงานเดียวกัน เทสต์จึงต้องระบุให้ชัดว่าอันไหน
function controlButton(name: string) {
  const stage = screen.queryByRole('region', { name: 'จอที่กำลังแชร์' });
  const matches = screen.getAllByRole('button', { name });
  const onControls = matches.filter((button) => !stage?.contains(button));

  if (onControls.length !== 1) {
    throw new Error(`คาดว่าจะเจอปุ่ม "${name}" บนแถบควบคุมหนึ่งปุ่ม แต่เจอ ${onControls.length}`);
  }

  return onControls[0];
}

const handlers = new Map<string, (payload: unknown) => void>();
const emitted: { event: string; payload: unknown }[] = [];

let ackResult: unknown = { ok: true };

/// คำตอบเฉพาะบาง event — ที่เหลือใช้ ackResult
let ackByEvent: Record<string, unknown> = {};

/// `ReturnType<typeof vi.fn>` กว้างเกินไป — มันคือ
/// `Mock<Procedure | Constructable>` ซึ่ง TypeScript ถือว่าเรียกตรง ๆ ไม่ได้
/// ระบุชนิดของฟังก์ชันให้ชัด แล้วยังเรียก .mockRejectedValue() ได้เหมือนเดิม
type AsyncMock = Mock<(...args: unknown[]) => Promise<unknown>>;

function asyncMock(
  implementation: (...args: unknown[]) => Promise<unknown>,
): AsyncMock {
  return vi.fn(implementation);
}

let apiPost: AsyncMock;
let apiDel: AsyncMock;
let getUserMedia: AsyncMock;

/// RTCPeerConnection ปลอม — ต้องเป็น **class** ไม่ใช่ arrow function
///
/// บทเรียนที่เสียเวลาไปหนึ่งรอบ: `vi.fn(() => ({ ... }))` ใช้กับ `new` ไม่ได้
/// เพราะ vitest เรียกผ่าน `Reflect.construct` และ arrow function ไม่ใช่
/// constructor — มันโยน "is not a constructor" ออกมา แล้ว `startCall` ก็ตกเข้า
/// catch ทั่วไป เทสต์จึงแดงหกตัวโดยที่โค้ดจริงไม่ได้ผิดอะไรเลย
///
/// เขียนเป็น class ยังได้ของแถม: ตรวจได้ว่าส่ง ice server อะไรไป ต่อ track
/// กี่เส้น ปิดหรือยัง และ **สั่งให้สถานะการเชื่อมต่อเปลี่ยนได้** ซึ่งเป็น
/// เส้นทางที่ของปลอมแบบเดิมทดสอบไม่ได้เลย
class FakePeerConnection {
  static instances: FakePeerConnection[] = [];

  static latest(): FakePeerConnection {
    const last = FakePeerConnection.instances.at(-1);

    if (!last) throw new Error('ยังไม่มีการสร้าง RTCPeerConnection');

    return last;
  }

  onicecandidate: ((event: { candidate: unknown }) => void) | null = null;
  ontrack:
    | ((event: { streams: unknown[]; track: { kind: string; addEventListener: () => void } }) => void)
    | null = null;
  onconnectionstatechange: (() => void) | null = null;
  onnegotiationneeded: (() => void) | null = null;

  connectionState = 'new';

  /// สถานะการเจรจา — จำเป็นตั้งแต่ย้ายมาใช้ perfect negotiation
  ///
  /// กฎ "ยื่นชนกันแล้วใครถอย" อ่านค่านี้ตัดสิน ถ้าของปลอมค้างที่ 'stable'
  /// ตลอด เทสต์จะไม่มีทางเดินเข้าเส้นทางที่ชนกันเลยสักครั้ง
  signalingState: RTCSignalingState = 'stable';
  closed = false;
  localDescription: unknown = null;
  remoteDescription: unknown = null;

  readonly config: RTCConfiguration;
  readonly addedTracks: unknown[] = [];
  readonly iceCandidates: unknown[] = [];

  constructor(config: RTCConfiguration) {
    this.config = config;
    FakePeerConnection.instances.push(this);
  }

  readonly senders: { track: unknown }[] = [];
  readonly removedSenders: { track: unknown }[] = [];

  addTrack(track: unknown) {
    this.addedTracks.push(track);
    this.senders.push({ track });
  }

  getSenders() {
    return this.senders;
  }

  removeTrack(sender: { track: unknown }) {
    this.removedSenders.push(sender);

    const index = this.senders.indexOf(sender);

    if (index !== -1) this.senders.splice(index, 1);
  }

  close() {
    this.closed = true;
  }

  async createOffer() {
    return { type: 'offer', sdp: 'fake-offer' };
  }

  async createAnswer() {
    return { type: 'answer', sdp: 'fake-answer' };
  }

  /// เรียกแบบไม่ใส่อาร์กิวเมนต์ได้ = เบราว์เซอร์ตัดสินเองว่าเป็น offer
  /// หรือ answer ตามสถานะปัจจุบัน ซึ่งเป็นท่ามาตรฐานของ perfect negotiation
  async setLocalDescription(description?: unknown) {
    const resolved =
      description ??
      (this.signalingState === 'have-remote-offer'
        ? { type: 'answer', sdp: 'fake-answer' }
        : { type: 'offer', sdp: 'fake-offer' });

    this.localDescription = resolved;
    this.signalingState =
      (resolved as { type: string }).type === 'offer'
        ? 'have-local-offer'
        : 'stable';
  }

  async setRemoteDescription(description: unknown) {
    this.remoteDescription = description;
    this.signalingState =
      (description as { type?: string })?.type === 'offer'
        ? 'have-remote-offer'
        : 'stable';
  }

  async addIceCandidate(candidate: unknown) {
    this.iceCandidates.push(candidate);
  }

  /// จำลองให้เบราว์เซอร์แจ้งว่าสถานะการเชื่อมต่อเปลี่ยน
  moveTo(state: string) {
    this.connectionState = state;

    act(() => {
      this.onconnectionstatechange?.();
    });
  }
}

const fakeSocket = {
  on: (event: string, handler: (payload: unknown) => void) => {
    handlers.set(event, handler);
  },
  off: (event: string) => {
    handlers.delete(event);
  },
  emit: (event: string, payload: unknown) => {
    emitted.push({ event, payload });
  },
};

vi.mock('@/lib/csmju/socket', () => ({
  connectSocket: vi.fn(async () => fakeSocket),
  emitWithAck: vi.fn(
    async (_socket: unknown, event: string, payload: unknown) => {
      emitted.push({ event, payload });

      return ackByEvent[event] ?? ackResult;
    },
  ),
  bindSocket: (
    _socket: unknown,
    event: string,
    handler: (payload: unknown) => void,
  ) => {
    handlers.set(event, handler);

    return () => handlers.delete(event);
  },
}));

vi.mock('@/lib/csmju/api', () => {
  class ApiError extends Error {
    constructor(
      readonly status: number,
      readonly code: string,
      message: string,
    ) {
      super(message);
      this.name = 'ApiError';
    }
  }

  return {
    ApiError,
    api: {
      post: (...args: unknown[]) => apiPost(...args),
      del: (...args: unknown[]) => apiDel(...args),
    },
  };
});

vi.mock('@/lib/csmju/session', () => ({
  useMe: () => ({
    id: 'aaa-caller',
    email: 'caller@core.local',
    coreRole: 'student',
    subsystemRole: 'GUEST',
  }),
}));

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    id: 'session-1',
    channel_id: 'dm-1',
    started_at: '2026-09-11T10:00:00.000Z',
    participants: [],
    max_seats: 2,
    seats_taken: 1,
    ice_servers: [{ urls: ['stun:stun.example:3478'] }],
    turn_available: true,
    max_screen_viewers: 4,
    ...overrides,
  };
}

/// track ปลอมหนึ่งเส้น — ต้องมีของจริง ไม่งั้นเทสต์ "ต่อไมค์เข้าสาย" จะเขียว
/// ทั้งที่ไม่ได้ต่ออะไรเลย
let trackSeq = 0;

function makeMicStream() {
  // ต้องมี id ที่ไม่ซ้ำเหมือน MediaStreamTrack จริง — โค้ดจริงใช้ id
  // จับคู่ตอนถอนแทร็กออกจากสาย ถ้าของปลอมไม่มี id จะถอนผิดตัว
  const track = {
    id: `track-${(trackSeq += 1)}`,
    kind: 'audio',
    enabled: true,
    stop: vi.fn(),
  };

  return {
    getTracks: () => [track],
    getAudioTracks: () => [track],
    track,
  };
}

let micStream: ReturnType<typeof makeMicStream>;
let screenStream: ReturnType<typeof makeMicStream>;

beforeEach(() => {
  handlers.clear();
  emitted.length = 0;
  ackResult = { ok: true };
  ackByEvent = {};
  FakePeerConnection.instances = [];
  vi.resetModules();

  micStream = makeMicStream();
  apiPost = asyncMock(async () => makeSession());
  apiDel = asyncMock(async () => undefined);
  getUserMedia = asyncMock(async () => micStream);

  screenStream = makeMicStream();

  Object.defineProperty(globalThis.navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia,
      getDisplayMedia: asyncMock(async () => ({
        ...screenStream,
        getVideoTracks: () => [screenStream.track],
      })),
    },
  });

  globalThis.RTCPeerConnection =
    FakePeerConnection as unknown as typeof RTCPeerConnection;
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function renderProvider() {
  const { CallProvider, useCall } = await import('./call-provider');

  function Caller() {
    const { startCall, inCall } = useCall();

    return (
      <button type="button" onClick={() => void startCall('dm-1', 'bbb-peer')}>
        {inCall ? 'อยู่ในสาย' : 'โทร'}
      </button>
    );
  }

  render(
    <CallProvider>
      <Caller />
    </CallProvider>,
  );

  // รอให้ provider ผูก handler กับ socket เสร็จก่อน
  await waitFor(() => expect(handlers.has('call:incoming')).toBe(true));
}

function incoming() {
  act(() => {
    handlers.get('call:incoming')?.({
      session_id: 'session-9',
      channel_id: 'dm-9',
      from_core_user_id: 'ccc-friend',
    });
  });
}

async function callOut() {
  await userEvent.click(screen.getByRole('button', { name: 'โทร' }));
  await screen.findByText(/กำลังโทรหา bbb-peer/);
}

describe('สายเรียกเข้า', () => {
  it('มีสายเข้าแล้วขึ้นแผ่นรับสาย', async () => {
    await renderProvider();

    incoming();

    expect(screen.getByText('สายเรียกเข้า…')).toBeInTheDocument();
    expect(screen.getByText('ccc-friend')).toBeInTheDocument();
  });

  it('กดรับแล้วเข้าห้องเสียงและตอบว่ารับ', async () => {
    await renderProvider();

    incoming();
    await userEvent.click(screen.getByRole('button', { name: /รับสาย/ }));

    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith('/voice-sessions', {
        channel_id: 'dm-9',
      }),
    );

    const answer = emitted.find((row) => row.event === 'call:answer');

    expect(answer?.payload).toMatchObject({
      session_id: 'session-9',
      to_core_user_id: 'ccc-friend',
      accepted: true,
    });
  });

  it('กดปฏิเสธแล้วตอบว่าไม่รับ และแผ่นหายไป', async () => {
    await renderProvider();

    incoming();
    await userEvent.click(screen.getByRole('button', { name: /ปฏิเสธ/ }));

    const answer = emitted.find((row) => row.event === 'call:answer');

    expect(answer?.payload).toMatchObject({ accepted: false });
    expect(screen.queryByText('สายเรียกเข้า…')).not.toBeInTheDocument();

    // ปฏิเสธแล้วต้องไม่เข้าห้องเสียง และต้องไม่แตะไมค์เลย
    expect(apiPost).not.toHaveBeenCalled();
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('ผู้โทรวางก่อนรับ แผ่นหายเอง', async () => {
    await renderProvider();

    incoming();
    expect(screen.getByText('สายเรียกเข้า…')).toBeInTheDocument();

    act(() => {
      handlers.get('call:cancelled')?.({
        session_id: 'session-9',
        from_core_user_id: 'ccc-friend',
      });
    });

    expect(screen.queryByText('สายเรียกเข้า…')).not.toBeInTheDocument();
  });
});

describe('โทรออก', () => {
  it('ขอไมค์ เข้าห้อง แล้วส่งเสียงกริ่ง', async () => {
    await renderProvider();

    await userEvent.click(screen.getByRole('button', { name: 'โทร' }));

    await waitFor(() => expect(getUserMedia).toHaveBeenCalled());

    expect(apiPost).toHaveBeenCalledWith('/voice-sessions', {
      channel_id: 'dm-1',
    });

    const ring = emitted.find((row) => row.event === 'call:ring');

    expect(ring?.payload).toMatchObject({
      session_id: 'session-1',
      to_core_user_id: 'bbb-peer',
    });
  });

  it('ระหว่างรอรับ แสดงว่ากำลังโทรหาใคร', async () => {
    await renderProvider();

    await userEvent.click(screen.getByRole('button', { name: 'โทร' }));

    expect(await screen.findByText(/กำลังโทรหา bbb-peer/)).toBeInTheDocument();
  });

  it('อีกฝ่ายปฏิเสธ แล้วสายถูกเก็บให้สะอาด', async () => {
    // ถ้าไม่เก็บ ผู้โทรจะค้างอยู่ในหน้าจอ "กำลังโทร" ตลอดไป
    await renderProvider();

    await callOut();

    act(() => {
      handlers.get('call:answered')?.({
        accepted: false,
        from_core_user_id: 'bbb-peer',
      });
    });

    await waitFor(() =>
      expect(screen.queryByText(/กำลังโทรหา/)).not.toBeInTheDocument(),
    );

    expect(await screen.findByText(/bbb-peer ปฏิเสธสาย/)).toBeInTheDocument();

    // ไมค์ต้องถูกปล่อย ไม่งั้นไฟไมค์ค้างติดทั้งที่ไม่มีสายแล้ว
    expect(micStream.track.stop).toHaveBeenCalled();
    expect(FakePeerConnection.latest().closed).toBe(true);
  });

  it('อีกฝ่ายรับ แล้วเลิกแสดงว่ากำลังโทร', async () => {
    await renderProvider();

    await callOut();

    act(() => {
      handlers.get('call:answered')?.({
        accepted: true,
        from_core_user_id: 'bbb-peer',
      });
    });

    await waitFor(() =>
      expect(screen.queryByText(/กำลังโทรหา/)).not.toBeInTheDocument(),
    );

    // ระบุด้วย role — VoiceChat เองก็มีหัวข้อว่า "อยู่ในสาย" อยู่ในแผง
    expect(
      screen.getByRole('button', { name: 'อยู่ในสาย' }),
    ).toBeInTheDocument();

    // รับแล้วต้องไม่ปิดสายทิ้ง — พลาดตรงนี้ได้ง่ายเพราะ teardown อยู่ใน
    // เส้นทางเดียวกับการถูกปฏิเสธ
    expect(FakePeerConnection.latest().closed).toBe(false);
  });
});

describe('เก็บสายให้สะอาดทุกทาง', () => {
  /// ทำให้สายอยู่ในสถานะ "รับแล้ว" เพื่อทดสอบการวางสาย
  async function answeredCall() {
    await renderProvider();
    await callOut();

    act(() => {
      handlers.get('call:answered')?.({
        accepted: true,
        from_core_user_id: 'bbb-peer',
      });
    });

    await waitFor(() =>
      expect(screen.queryByText(/กำลังโทรหา/)).not.toBeInTheDocument(),
    );
  }

  it('ถูกปฏิเสธแล้วต้องออกจากห้องเสียงด้วย ไม่ใช่แค่เก็บฝั่งตัวเอง', async () => {
    // ห้อง DM มี 2 ที่นั่ง ถ้าไม่ออก ที่นั่งจะค้างจนโทรซ้ำไม่ได้อีกเลย
    // ทั้งที่ไม่มีใครอยู่ในสาย
    await renderProvider();
    await callOut();

    act(() => {
      handlers.get('call:answered')?.({
        accepted: false,
        from_core_user_id: 'bbb-peer',
      });
    });

    await waitFor(() =>
      expect(apiDel).toHaveBeenCalledWith(
        '/voice-sessions/session-1/participants/me',
      ),
    );
  });

  it('กริ่งไม่ผ่านแล้วต้องออกจากห้องเสียง', async () => {
    ackResult = { ok: false, error: 'โทรหาคนนี้ไม่ได้' };

    await renderProvider();
    await userEvent.click(screen.getByRole('button', { name: 'โทร' }));

    await waitFor(() =>
      expect(apiDel).toHaveBeenCalledWith(
        '/voice-sessions/session-1/participants/me',
      ),
    );
  });

  it('วางสายที่รับแล้วต้องบอกอีกฝั่งด้วย call:end', async () => {
    // call:cancel ถูกส่งเฉพาะตอนยังไม่มีใครรับ สายที่รับแล้วจึงเคยวางแบบ
    // เงียบสนิท ปล่อยให้อีกฝั่งนั่งมองแผงสายที่ตายไปแล้ว
    await answeredCall();

    await userEvent.click(screen.getByRole('button', { name: 'วางสาย' }));

    const ended = emitted.find((row) => row.event === 'call:end');

    expect(ended?.payload).toMatchObject({
      session_id: 'session-1',
      to_core_user_id: 'bbb-peer',
    });

    await waitFor(() =>
      expect(apiDel).toHaveBeenCalledWith(
        '/voice-sessions/session-1/participants/me',
      ),
    );
  });

  it('ยังไม่มีใครรับแล้ววาง = ส่ง call:cancel ไม่ใช่ call:end', async () => {
    await renderProvider();
    await callOut();

    await userEvent.click(screen.getByRole('button', { name: 'วางสาย' }));

    expect(emitted.some((row) => row.event === 'call:cancel')).toBe(true);
    expect(emitted.some((row) => row.event === 'call:end')).toBe(false);
  });

  it('อีกฝั่งวางสาย แล้วฝั่งเราต้องเก็บตาม', async () => {
    await answeredCall();

    act(() => {
      handlers.get('call:ended')?.({
        session_id: 'session-1',
        from_core_user_id: 'bbb-peer',
      });
    });

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'โทร' })).toBeInTheDocument(),
    );

    expect(micStream.track.stop).toHaveBeenCalled();
    expect(FakePeerConnection.latest().closed).toBe(true);
  });

  it('call:ended จากคนอื่นต้องไม่ทำให้สายเราหลุด', async () => {
    await answeredCall();

    act(() => {
      handlers.get('call:ended')?.({
        session_id: 'session-1',
        from_core_user_id: 'zzz-stranger',
      });
    });

    expect(
      screen.getByRole('button', { name: 'อยู่ในสาย' }),
    ).toBeInTheDocument();
    expect(FakePeerConnection.latest().closed).toBe(false);
  });

  it('call:ended ของสายเก่าที่มาช้าต้องไม่ตัดสายปัจจุบัน', async () => {
    // คนเดิม แต่คนละ session — เกิดได้จริงเมื่อวางสายแรกแล้วโทรใหม่ทันที
    // แล้ว event ของสายแรกเพิ่งเดินทางมาถึง
    //
    // ต้องแยกเทสต์จากกรณี "คนอื่นส่งมา" เพราะด่านชื่อผู้ส่งถูกตรวจก่อน
    // ถ้ารวมเป็นเทสต์เดียว ด่าน session จะถูกลบทิ้งได้โดยไม่มีอะไรแดง
    await answeredCall();

    act(() => {
      handlers.get('call:ended')?.({
        session_id: 'session-เก่า',
        from_core_user_id: 'bbb-peer',
      });
    });

    expect(
      screen.getByRole('button', { name: 'อยู่ในสาย' }),
    ).toBeInTheDocument();
    expect(FakePeerConnection.latest().closed).toBe(false);
  });

  it('วางสายตอนกำลังแชร์หน้าจอ ต้องคืนสิทธิ์แชร์ด้วย', async () => {
    // ไม่คืน = ห้องล็อกไว้ให้คนที่ออกไปแล้ว อีกฝ่ายกดแชร์ไม่ได้จนจบ session
    await answeredCall();

    await userEvent.click(screen.getByRole('button', { name: 'แชร์หน้าจอ' }));

    await waitFor(() =>
      expect(controlButton('หยุดแชร์หน้าจอ')).toBeInTheDocument(),
    );

    await userEvent.click(screen.getByRole('button', { name: 'วางสาย' }));

    expect(emitted.some((row) => row.event === 'screen:release')).toBe(true);
  });

  it('โทรซ้อนสายที่คุยอยู่ไม่ได้', async () => {
    // เดิม setActive ทับของเก่าดื้อ ๆ แล้ว peer ตัวเดิมก็ลอยอยู่โดยไม่ถูกปิด
    await answeredCall();

    const peersBefore = FakePeerConnection.instances.length;

    await userEvent.click(
      screen.getByRole('button', { name: 'อยู่ในสาย' }),
    );

    expect(await screen.findByText(/วางสายก่อน/)).toBeInTheDocument();
    expect(FakePeerConnection.instances).toHaveLength(peersBefore);
  });
});

describe('WebRTC', () => {
  it('ส่ง ice server ที่หลังบ้านให้มาเข้า peer connection', async () => {
    // ถ้าลืมส่ง สายจะติดเฉพาะคนที่อยู่วงแลนเดียวกัน แล้วจะกลายเป็นอาการ
    // "บางคนโทรได้ บางคนไม่ได้" โดยไม่มี error อะไรเลย
    apiPost = asyncMock(async () =>
      makeSession({
        ice_servers: [
          {
            urls: ['turn:turn.example:3478'],
            username: 'u1',
            credential: 'c1',
          },
        ],
      }),
    );

    await renderProvider();
    await callOut();

    // **ชื่อฟิลด์ต้องเป็น `username` ตามมาตรฐาน WebRTC เป๊ะ ๆ**
    //
    // เทสต์นี้เคยยืนยัน `coreUserId` เพราะโดนกวาดเปลี่ยนชื่อไปพร้อมกับโค้ด
    // ตอนย้ายคีย์ตัวตนทั้งระบบ — มันจึง **ล็อกบั๊กเอาไว้** แทนที่จะจับมัน
    //
    // บั๊กนั้นร้ายเพราะไม่มีอะไรดังเลย: เบราว์เซอร์มองข้ามฟิลด์ที่ไม่รู้จัก
    // แล้ว TURN ปฏิเสธการยืนยันตัวตน คนหลัง NAT เข้มงวดจึงเชื่อมเสียงไม่ติด
    // โดยไม่มี error ให้ใครเห็น
    const servers = FakePeerConnection.latest().config.iceServers ?? [];
    const server = servers[0] as unknown as Record<string, unknown>;

    expect(server).toEqual({
      urls: ['turn:turn.example:3478'],
      username: 'u1',
      credential: 'c1',
    });

    // กันชื่ออื่นที่ WebRTC ไม่รู้จักหลุดเข้าไป
    expect(Object.keys(server).sort()).toEqual([
      'credential',
      'urls',
      'username',
    ]);
  });

  it('ต่อเสียงไมค์เข้าสาย', async () => {
    await renderProvider();
    await callOut();

    expect(FakePeerConnection.latest().addedTracks).toEqual([micStream.track]);
  });

  /// อีกฝ่ายตอบ `answer` กลับมา = จบการจับมือหนึ่งรอบ สายกลับสู่ stable
  ///
  /// **ต้องเรียกทุกครั้งหลังยื่น offer** ไม่งั้นสายจะค้างที่ have-local-offer
  /// แล้วรอบเจรจาถัดไปจะถูกข้ามด้วยกฎ "ยื่นได้ทีละรอบ" ซึ่งเป็นพฤติกรรมที่
  /// ถูกต้องของโค้ดจริง — ของปลอมที่ไม่เคยตอบกลับต่างหากที่ไม่เหมือนจริง
  async function peerAnswers(fromCoreUserId = 'bbb-peer') {
    await act(async () => {
      await handlers.get('rtc:signal')?.({
        from_core_user_id: fromCoreUserId,
        kind: 'answer',
        data: { type: 'answer', sdp: 'ของอีกฝ่าย' },
      });
    });
  }

  function offersSent() {
    return emitted.filter(
      (row) =>
        row.event === 'rtc:signal' &&
        (row.payload as { kind?: string }).kind === 'offer',
    );
  }

  it('ยังไม่มีใครรับ = ยังไม่ยื่น offer', async () => {
    // **บั๊กที่เคยทำให้สายไม่ติดเลยสักสาย**
    //
    // ยื่นตอนนี้ = อีกฝ่ายยังไม่มีแถวผู้เข้าร่วม หลังบ้าน
    // (voice.service `sharesVoiceSession`) จึงทิ้ง SDP ทิ้งไปเงียบ ๆ
    // แล้วไม่มีใครยื่นซ้ำอีกเลย
    await renderProvider();
    await callOut();

    // รอให้ทุกอย่างที่ค้างอยู่เดินจนจบก่อนค่อยสรุป
    await act(async () => {
      await Promise.resolve();
    });

    expect(offersSent()).toHaveLength(0);
    expect(FakePeerConnection.latest().localDescription).toBeNull();
  });

  it('อีกฝ่ายกดรับแล้วจึงยื่น offer', async () => {
    await renderProvider();
    await callOut();

    act(() => {
      handlers.get('call:answered')?.({
        accepted: true,
        from_core_user_id: 'bbb-peer',
      });
    });

    await waitFor(() => expect(offersSent()).toHaveLength(1));

    expect(offersSent()[0].payload).toMatchObject({
      to_core_user_id: 'bbb-peer',
      kind: 'offer',
    });

    expect(FakePeerConnection.latest().localDescription).toMatchObject({
      type: 'offer',
    });
  });

  it('**ผู้รับสายยื่น offer เองได้ ไม่ต้องรอฝั่งโน้น**', async () => {
    // เดิมแบ่งหน้าที่ตายตัวว่าใครเป็นฝ่ายยื่นด้วยการเทียบชื่อ ฝั่งที่ชื่อ
    // มากกว่าจึงเงียบตลอด และเวลาฝั่งนั้นเพิ่มแทร็ก (เช่นแชร์หน้าจอ) ก็ต้อง
    // ไปขอให้อีกฝั่งยื่นให้ ซึ่งใช้ไม่ได้ตามสเปก — ดู makeOffer
    //
    // ตอนนี้ยื่นเองได้ทั้งคู่ ถ้าชนกันกฎ polite ตัดสินให้เอง
    await renderProvider();

    act(() => {
      handlers.get('call:incoming')?.({
        session_id: 'session-9',
        channel_id: 'dm-9',
        from_core_user_id: 'AAA-earlier',
      });
    });

    await userEvent.click(screen.getByRole('button', { name: /รับสาย/ }));

    await waitFor(() => expect(apiPost).toHaveBeenCalled());

    await act(async () => {
      await Promise.resolve();
    });

    expect(offersSent()).toHaveLength(1);

    // ยื่นไปแล้วแต่ของเขามาชนพอดี — เราชื่อมากกว่า (aaa > AAA) จึงเป็นฝ่าย
    // ยอมถอย ต้องทิ้งของตัวเองแล้วตอบ answer ให้เขา ไม่ใช่เมินแล้วค้างกันทั้งคู่
    await act(async () => {
      await handlers.get('rtc:signal')?.({
        from_core_user_id: 'AAA-earlier',
        kind: 'offer',
        data: { type: 'offer', sdp: 'ของผู้โทร' },
      });
    });

    expect(
      emitted.some(
        (row) =>
          row.event === 'rtc:signal' &&
          (row.payload as { kind?: string }).kind === 'answer',
      ),
    ).toBe(true);
  });

  it('**ผู้รับสายแชร์หน้าจอแล้วยื่น offer เอง ไม่ใช่ไปขอให้อีกฝ่ายยื่น**', async () => {
    // บั๊กเดิม: ฝั่งที่ไม่ได้ถูกเลือกให้เป็นผู้ยื่น จะส่ง `renegotiate` ไปขอ
    // ให้อีกฝั่งเปิดรอบให้ — แต่ข้อเสนอที่อีกฝั่งสร้างมีเฉพาะช่องสื่อของเขา
    // เอง ส่วนแทร็กหน้าจอของเราไม่มีช่องรองรับ และเราเพิ่มช่องในคำตอบไม่ได้
    // (JSEP บังคับว่าคำตอบต้องมี m-section เท่าข้อเสนอ)
    //
    // ผลคือผู้รับสายกดแชร์จอแล้วผู้โทรไม่เห็นอะไรเลย ไม่มี error สักตัว
    await renderProvider();

    act(() => {
      handlers.get('call:incoming')?.({
        session_id: 'session-9',
        channel_id: 'dm-9',
        from_core_user_id: 'AAA-earlier',
      });
    });

    await userEvent.click(screen.getByRole('button', { name: /รับสาย/ }));
    await waitFor(() => expect(apiPost).toHaveBeenCalled());

    const before = offersSent().length;

    // จับมือรอบแรกให้จบก่อน ไม่งั้นสายยังค้างที่ have-local-offer
    await peerAnswers('AAA-earlier');

    await userEvent.click(screen.getByRole('button', { name: 'แชร์หน้าจอ' }));

    // ยื่นเองจริง
    await waitFor(() => expect(offersSent().length).toBe(before + 1));

    // และไม่ไปขอใครให้ยื่นแทน
    expect(
      emitted.some(
        (row) =>
          row.event === 'rtc:signal' &&
          (row.payload as { kind?: string }).kind === 'renegotiate',
      ),
    ).toBe(false);
  });

  it('ผู้แชร์เห็นจอของตัวเองระหว่างอยู่ในสาย', async () => {
    // ของเดิม remoteStream ถูกยัดเข้า <audio> อย่างเดียว ภาพหน้าจอที่เจรจา
    // มาได้จึงไม่ถูกเรนเดอร์ที่ไหนเลย — ไม่มีใครเห็นภาพสักฝ่าย
    await renderProvider();
    await callOut();

    act(() => {
      handlers.get('call:answered')?.({
        accepted: true,
        from_core_user_id: 'bbb-peer',
      });
    });

    await userEvent.click(screen.getByRole('button', { name: 'แชร์หน้าจอ' }));

    expect(
      await screen.findByRole('region', { name: 'จอที่กำลังแชร์' }),
    ).toBeInTheDocument();
    expect(screen.getByText('คุณกำลังแชร์หน้าจอนี้')).toBeInTheDocument();
  });

  it('หลังบ้านส่งสัญญาณต่อไม่ได้ = บอกผู้ใช้ ไม่ใช่ค้างที่กำลังเชื่อมต่อ', async () => {
    // เดิม emit แบบไม่รอ ack คำปฏิเสธของหลังบ้านจึงถูกทิ้ง
    // ผู้ใช้เห็นแต่ "กำลังเชื่อมต่อ" ค้างไว้โดยไม่มีอะไรอธิบาย
    ackByEvent = {
      'rtc:signal': { ok: false, error: 'ปลายทางไม่ได้อยู่ในห้องเสียงเดียวกับคุณ' },
    };

    await renderProvider();
    await callOut();

    act(() => {
      handlers.get('call:answered')?.({
        accepted: true,
        from_core_user_id: 'bbb-peer',
      });
    });

    expect(
      await screen.findByText(/ไม่ได้อยู่ในห้องเสียงเดียวกับคุณ/),
    ).toBeInTheDocument();
  });

  it('ได้คำขอ renegotiate แล้วยื่น offer รอบใหม่', async () => {
    await renderProvider();
    await callOut();

    act(() => {
      handlers.get('call:answered')?.({
        accepted: true,
        from_core_user_id: 'bbb-peer',
      });
    });

    await waitFor(() => expect(offersSent()).toHaveLength(1));
    await peerAnswers();

    await act(async () => {
      await handlers.get('rtc:signal')?.({
        from_core_user_id: 'bbb-peer',
        kind: 'renegotiate',
        data: null,
      });
    });

    expect(offersSent()).toHaveLength(2);
  });

  it('ได้ offer มาแล้วตอบ answer กลับ', async () => {
    await renderProvider();
    await callOut();

    await act(async () => {
      await handlers.get('rtc:signal')?.({
        from_core_user_id: 'bbb-peer',
        kind: 'offer',
        data: { type: 'offer', sdp: 'ของอีกฝ่าย' },
      });
    });

    const peer = FakePeerConnection.latest();

    expect(peer.remoteDescription).toMatchObject({ sdp: 'ของอีกฝ่าย' });
    expect(peer.localDescription).toMatchObject({ type: 'answer' });

    const answer = emitted.find(
      (row) =>
        row.event === 'rtc:signal' &&
        (row.payload as { kind?: string }).kind === 'answer',
    );

    expect(answer?.payload).toMatchObject({ to_core_user_id: 'bbb-peer' });
  });

  it('ice candidate ที่มาก่อน remote description ไม่ทำให้สายพัง', async () => {
    await renderProvider();
    await callOut();

    const peer = FakePeerConnection.latest();

    peer.addIceCandidate = async () => {
      throw new Error('remote description ยังไม่ถูกตั้ง');
    };

    // ต้องไม่โยนออกมา ไม่งั้นจะกลายเป็น unhandled rejection
    await act(async () => {
      await handlers.get('rtc:signal')?.({
        from_core_user_id: 'bbb-peer',
        kind: 'ice',
        data: { candidate: 'x' },
      });
    });

    expect(screen.getByText(/กำลังโทรหา bbb-peer/)).toBeInTheDocument();
  });

  it('เริ่มแชร์หน้าจอแล้วต้องเปิดรอบเจรจาใหม่ ไม่ใช่แค่เพิ่มแทร็ก', async () => {
    // **บั๊กที่ตัวนี้กัน:** addTrack เข้าสายที่ต่ออยู่แล้ว ไม่ทำให้ภาพวิ่งไปเอง
    // ต้องมีรอบ offer/answer ใหม่เสมอ ถ้าลืม ผู้แชร์จะเห็นแถบ "กำลังแชร์"
    // ของเบราว์เซอร์และ UI ขึ้นว่าแชร์อยู่ แต่ปลายทางไม่ได้รับอะไรเลย
    // และไม่มี error ให้เห็นสักตัว
    await renderProvider();
    await callOut();

    act(() => {
      handlers.get('call:answered')?.({
        accepted: true,
        from_core_user_id: 'bbb-peer',
      });
    });

    await waitFor(() => expect(offersSent()).toHaveLength(1));
    await peerAnswers();

    await userEvent.click(screen.getByRole('button', { name: 'แชร์หน้าจอ' }));

    // ต้องมี offer รอบที่สองหลังเพิ่มแทร็กหน้าจอ
    await waitFor(() => expect(offersSent()).toHaveLength(2));

    expect(FakePeerConnection.latest().addedTracks).toContain(
      screenStream.track,
    );
  });

  it('หยุดแชร์แล้วต้องถอนแทร็กออกจากสายและเจรจาใหม่', async () => {
    // แค่ track.stop() ไม่พอ — sender ยังอยู่ในสายและ SDP ยังบอกว่ามีช่อง
    // วิดีโออยู่ ฝั่งผู้ชมจะเห็นภาพค้างที่เฟรมสุดท้ายแทนที่จะหายไป
    await renderProvider();
    await callOut();

    act(() => {
      handlers.get('call:answered')?.({
        accepted: true,
        from_core_user_id: 'bbb-peer',
      });
    });

    await waitFor(() => expect(offersSent()).toHaveLength(1));
    await peerAnswers();

    await userEvent.click(screen.getByRole('button', { name: 'แชร์หน้าจอ' }));
    await waitFor(() => expect(offersSent()).toHaveLength(2));
    await peerAnswers();

    await userEvent.click(controlButton('หยุดแชร์หน้าจอ'));

    const peer = FakePeerConnection.latest();

    // ถอนออกจริง
    expect(peer.removedSenders.map((sender) => sender.track)).toContain(
      screenStream.track,
    );

    // และเจรจาใหม่ให้อีกฝั่งรู้ว่าช่องวิดีโอหายไปแล้ว
    await waitFor(() => expect(offersSent()).toHaveLength(3));

    // ปิดแทร็กด้วย ไม่งั้นไฟแสดงการแชร์ของเบราว์เซอร์ยังติดค้าง
    expect(screenStream.track.stop).toHaveBeenCalled();
  });

  it('ต่อไม่ติดและไม่มี TURN = บอกสาเหตุจริง', async () => {
    // ไม่มี TURN แล้วอยู่หลัง NAT แบบเข้มงวด = ต่อไม่ติดตลอดกาล
    // ถ้าไม่บอก ผู้ใช้จะนั่งรอหน้าจอ "กำลังเชื่อมต่อ" ไปเรื่อย ๆ
    apiPost = asyncMock(async () => makeSession({ turn_available: false }));

    await renderProvider();
    await callOut();

    FakePeerConnection.latest().moveTo('failed');

    expect(await screen.findByText(/ต้องมี TURN server/)).toBeInTheDocument();
  });
});

describe('ทางที่ผิดพลาด', () => {
  it('ผู้ใช้ไม่อนุญาตไมค์ = บอกให้ไปอนุญาต ไม่ค้างสาย', async () => {
    getUserMedia.mockRejectedValue(
      new DOMException('Permission denied', 'NotAllowedError'),
    );

    await renderProvider();

    await userEvent.click(screen.getByRole('button', { name: 'โทร' }));

    expect(
      await screen.findByText(/เข้าถึงไมโครโฟนไม่ได้/),
    ).toBeInTheDocument();

    // ต้องไม่ค้างสถานะว่าอยู่ในสาย
    expect(screen.getByRole('button', { name: 'โทร' })).toBeInTheDocument();
  });

  it('หลังบ้านปฏิเสธการส่งกริ่ง = แสดงเหตุผลและเก็บสายให้สะอาด', async () => {
    ackResult = { ok: false, error: 'โทรหาคนนี้ไม่ได้' };

    await renderProvider();

    await userEvent.click(screen.getByRole('button', { name: 'โทร' }));

    expect(await screen.findByText(/โทรหาคนนี้ไม่ได้/)).toBeInTheDocument();

    await waitFor(() =>
      expect(screen.queryByText(/กำลังโทรหา/)).not.toBeInTheDocument(),
    );

    expect(micStream.track.stop).toHaveBeenCalled();
  });

  it('เข้าห้องเสียงไม่ได้ (ห้องเต็ม) = แสดงข้อความจากหลังบ้าน', async () => {
    const { ApiError } = await import('@/lib/csmju/api');

    apiPost.mockRejectedValue(
      new (ApiError as new (
        status: number,
        code: string,
        message: string,
      ) => Error)(409, 'conflict', 'ห้องเต็มแล้ว (2/2 คน)'),
    );

    await renderProvider();

    await userEvent.click(screen.getByRole('button', { name: 'โทร' }));

    expect(await screen.findByText(/ห้องเต็มแล้ว/)).toBeInTheDocument();
  });

  it('รับสายตอนห้องเต็ม = ไม่ค้างแผ่นรับสายไว้', async () => {
    const { ApiError } = await import('@/lib/csmju/api');

    apiPost.mockRejectedValue(
      new (ApiError as new (
        status: number,
        code: string,
        message: string,
      ) => Error)(409, 'conflict', 'ห้องเต็มแล้ว (2/2 คน)'),
    );

    await renderProvider();

    incoming();
    await userEvent.click(screen.getByRole('button', { name: /รับสาย/ }));

    expect(await screen.findByText(/ห้องเต็มแล้ว/)).toBeInTheDocument();
    expect(screen.queryByText('สายเรียกเข้า…')).not.toBeInTheDocument();
  });
});
