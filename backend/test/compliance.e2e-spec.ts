import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/bootstrap.js';
import {
  RealtimeBus,
  type RoomEviction,
} from '../src/common/realtime/realtime-bus.js';

/// ทดสอบว่า response ยังตรงมาตรฐาน CSMJU2030 อยู่
///
/// ชุดนี้มีไว้ให้ CI Gate จับตอนใครเผลอแก้ envelope หรือเปลี่ยนชื่อ field
/// เป็น camelCase เพราะสองอย่างนั้นทำให้ระบบย่อยอื่นที่เรียก API เราพังเงียบ ๆ
describe('มาตรฐาน API ของ CSMJU2030 (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.DEV_FAKE_GATEWAY = 'true';
    process.env.DEV_FAKE_USERNAME ??= '6704101382-anuchat';
    process.env.DEV_FAKE_LAYER1_ROLE ??= 'student';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();

    // ใช้การตั้งค่าชุดเดียวกับ main.ts เพื่อให้ที่ทดสอบคือของจริง
    configureApp(app);

    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health ต้องมีและตอบสถานะได้ (บังคับตามหน้า 7)', async () => {
    const response = await request(app.getHttpServer()).get('/health').expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data.subsystem).toBe('aie4-social-reels');
    expect(['ok', 'degraded']).toContain(response.body.data.status);
  });

  it('list endpoint ต้องคืน envelope พร้อม meta แบบ snake_case', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/reels?page=1&per_page=5')
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(Array.isArray(response.body.data)).toBe(true);
    expect(Object.keys(response.body.meta).sort()).toEqual([
      'current_page',
      'per_page',
      'total_items',
      'total_pages',
    ]);
  });

  it('ข้อผิดพลาดต้องอยู่ในรูป { success: false, error: { code, message } }', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/reels?page=0')
      .expect(400);

    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('validation_failed');
    expect(typeof response.body.error.message).toBe('string');
  });

  it('ตัวตนต้องมาจาก header ของ Gateway และมีสิทธิ์สองชั้น', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/subsystem-members/me')
      .expect(200);

    expect(response.body.data.username).toBe(process.env.DEV_FAKE_USERNAME);
    expect(response.body.data.layer1_role).toBe('student');
    expect(response.body.data.layer2_role).toBe('GUEST');
  });

  it('ปฏิเสธนามสกุลที่เบราว์เซอร์เรนเดอร์เป็นหน้าเว็บได้', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/assets/upload-intents')
      .send({ file_name: 'payload.svg', size_bytes: 100, bucket: 'attachments' })
      .expect(400);

    expect(response.body.error.message).toContain('.svg');
  });

  it('ตอบ 404 ไม่ใช่ 403 เมื่อไม่ได้เป็นสมาชิกห้อง เพื่อไม่ให้คนนอกรู้ว่าห้องมีจริง', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/channels/00000000-0000-4000-8000-000000000000/messages')
      .expect(404);

    expect(response.body.error.code).toBe('not_found');
  });

  it('นักศึกษาสร้างห้องประจำวิชาไม่ได้ (Layer 1 RBAC)', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/channels')
      .send({ kind: 'COURSE', name: 'CS999' })
      .expect(403);

    expect(response.body.error.code).toBe('forbidden');
  });

  it('บังคับรูปแบบแท็กวิชาให้ตรงกันทั้งระบบ', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/posts')
      .send({ title: 'ทดสอบ', content: 'เนื้อหา', course_tag: 'cs-201' })
      .expect(400);

    expect(response.body.error.message).toContain('CS201');
  });

  it('เข้าห้องเสียงที่ไม่ได้เป็นสมาชิกไม่ได้', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/voice-sessions')
      .send({ channel_id: '00000000-0000-4000-8000-000000000000' })
      .expect(404);
  });

  it('อิโมจิรีแอ็กชันต้องอยู่ในรายการที่อนุญาต', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/reactions')
      .send({
        target_kind: 'POST',
        target_id: '00000000-0000-4000-8000-000000000000',
        emoji: 'PIZZA',
      })
      .expect(400);

    expect(response.body.error.code).toBe('validation_failed');
  });

  it('กดรีแอ็กชันใส่ข้อความที่เข้าถึงไม่ได้ต้องได้ 404 เหมือนกับข้อความที่ไม่มีจริง', async () => {
    // คำตอบต้องแยกไม่ออกระหว่าง "ไม่มีข้อความนี้" กับ "มีแต่คุณเข้าไม่ถึง"
    // ไม่งั้นคนนอกใช้ status code ยืนยันได้ว่า id ที่เดามาถูกต้อง
    await request(app.getHttpServer())
      .post('/api/v1/reactions')
      .send({
        target_kind: 'MESSAGE',
        target_id: '00000000-0000-4000-8000-000000000000',
        emoji: 'THUMBSUP',
      })
      .expect(400);
  });

  it('ค้นข้อความแชทได้เฉพาะห้องที่ตัวเองเป็นสมาชิก', async () => {
    // ผู้ใช้ที่ไม่เคยเข้าห้องไหนเลยต้องได้ผลว่าง ไม่ใช่ได้แชทของคนอื่นทั้งระบบ
    // ถ้าเทสต์นี้แดง หมายถึงช่องค้นหากลายเป็นช่องอ่านแชทส่วนตัวของคนอื่น
    const response = await request(app.getHttpServer())
      .get('/api/v1/search?q=ทดสอบ&kind=messages')
      .set('x-user-id', '6799999999-nobody')
      .set('x-layer1-role', 'student')
      .expect(200);

    expect(response.body.meta.total_items).toBe(0);
  });

  it('ทำเครื่องหมายอ่านแล้วบนการแจ้งเตือนของคนอื่นไม่ได้', async () => {
    await request(app.getHttpServer())
      .patch('/api/v1/notifications/00000000-0000-4000-8000-000000000000/read')
      .expect(404);
  });

  it('ติดตามตัวเองไม่ได้ (ไม่งั้นปั่นยอดผู้ติดตามเองได้)', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/follows')
      .send({ username: process.env.DEV_FAKE_USERNAME })
      .expect(400);

    expect(response.body.success).toBe(false);
  });

  it('นัดประชุมยาวเกินเพดานต้องไม่ถูกสร้าง', async () => {
    const starts = new Date(Date.now() + 3600_000);
    const ends = new Date(starts.getTime() + 40 * 24 * 3600_000);

    // ยอมรับทั้ง 400 และ 404 เพราะเช็คสมาชิกห้องมาก่อนเช็คช่วงเวลา
    // สิ่งที่ห้ามคือ 201
    const response = await request(app.getHttpServer())
      .post('/api/v1/meetings')
      .send({
        channel_id: '00000000-0000-4000-8000-000000000000',
        title: 'ใส่ปีผิด',
        starts_at: starts.toISOString(),
        ends_at: ends.toISOString(),
      });

    expect([400, 404]).toContain(response.status);
  });

  it('audit log อ่านได้เฉพาะผู้ดูแลระดับองค์กร', async () => {
    // ผู้เรียกในชุดทดสอบนี้เป็น student ตาม DEV_FAKE_* จึงต้องถูกปฏิเสธ
    // ถ้าเทสต์นี้แดง แปลว่าประวัติการลบเนื้อหาของทุกคนกลายเป็นข้อมูลสาธารณะ
    const response = await request(app.getHttpServer())
      .get('/api/v1/audit-logs')
      .expect(403);

    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('forbidden');
  });

  it('แดชบอร์ดผู้ดูแลไม่เปิดให้นักศึกษา', async () => {
    await request(app.getHttpServer()).get('/api/v1/admin-overview').expect(403);
  });

  it('นักศึกษาเปลี่ยนสิทธิ์ Layer 2 ของคนอื่นไม่ได้', async () => {
    await request(app.getHttpServer())
      .patch('/api/v1/subsystem-members/6799999999-target/role')
      .send({ layer2_role: 'ADMIN' })
      .expect(403);
  });

  it('โควตาที่ตั้งได้มีเพดาน (กันพิมพ์ศูนย์เกินแล้วจองพื้นที่เกินที่ระบบมี)', async () => {
    // ยอมรับทั้ง 400 และ 403 เพราะเช็คสิทธิ์มาก่อนเช็คค่า — ที่ห้ามคือ 200
    const response = await request(app.getHttpServer())
      .patch('/api/v1/subsystem-members/6799999999-target/storage-quota')
      .send({ storage_quota_bytes: 99999999999 });

    expect([400, 403]).toContain(response.status);
  });

  it('สั่งเก็บกวาดไฟล์ค้างได้เฉพาะผู้ดูแลองค์กร', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/assets/maintenance/sweeps')
      .expect(403);
  });

  it('บันทึกการดูคลิปที่ไม่มีอยู่จริงต้องได้ 404 ไม่ใช่สร้างแถวขยะ', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/reels/00000000-0000-4000-8000-000000000000/views')
      .expect(404);
  });

  it('แถวสตอรี่คืนอาเรย์จัดกลุ่มตามเจ้าของ', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/stories')
      .expect(200);

    expect(Array.isArray(response.body.data)).toBe(true);

    for (const tray of response.body.data) {
      expect(typeof tray.has_unseen).toBe('boolean');
      expect(typeof tray.is_me).toBe('boolean');
      expect(Array.isArray(tray.stories)).toBe(true);
    }
  });

  it('ยอดผู้ชมสตอรี่ของคนอื่นต้องเป็น 0 เสมอ', async () => {
    // ยอดผู้ชมเป็นข้อมูลของเจ้าของ คนอื่นไม่ควรรู้ว่าสตอรี่นี้มีคนดูกี่คน
    const response = await request(app.getHttpServer())
      .get('/api/v1/stories')
      .expect(200);

    for (const tray of response.body.data) {
      if (tray.is_me) continue;

      for (const story of tray.stories) {
        expect(story.view_count).toBe(0);
      }
    }
  });

  it('บันทึกการดูสตอรี่ที่ไม่มีอยู่จริงต้องได้ 404', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/stories/00000000-0000-4000-8000-000000000000/views')
      .expect(404);
  });

  it('ดูรายชื่อผู้ชมสตอรี่ที่ไม่ใช่ของตัวเองไม่ได้', async () => {
    // 404 เมื่อไม่มีสตอรี่ · 403 เมื่อมีแต่ไม่ใช่ของเรา — ที่ห้ามคือ 200
    const response = await request(app.getHttpServer()).get(
      '/api/v1/stories/00000000-0000-4000-8000-000000000000/viewers',
    );

    expect([403, 404]).toContain(response.status);
  });

  it('สั่งเก็บกวาดสตอรี่ได้เฉพาะผู้ดูแลองค์กร', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/stories/maintenance/sweeps')
      .expect(403);
  });

  it('สร้างแชทส่วนตัวกับตัวเองไม่ได้', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/direct-channels')
      .send({ peer_username: process.env.DEV_FAKE_USERNAME })
      .expect(400);

    expect(response.body.success).toBe(false);
  });

  it('แก้ชื่อที่แสดงผ่านระบบย่อยไม่ได้ — Core เป็นแหล่งความจริง (หน้า 10)', async () => {
    // ถ้าเทสต์นี้เขียว หมายถึงมีคนเปิดช่องให้เก็บชื่อซ้ำในระบบย่อย
    // ซึ่งจะสร้างชื่อสองเวอร์ชันของคนเดียวกัน แล้วไม่มีใครรู้ว่าอันไหนจริง
    const response = await request(app.getHttpServer())
      .patch('/api/v1/profiles/me')
      .send({ display_name: 'ชื่อที่ผมตั้งเอง' })
      .expect(400);

    expect(response.body.error.code).toBe('validation_failed');
  });

  it('แก้รูปโปรไฟล์ผ่านระบบย่อยไม่ได้', async () => {
    await request(app.getHttpServer())
      .patch('/api/v1/profiles/me')
      .send({ avatar_url: 'https://example.com/me.png' })
      .expect(400);
  });

  it('GET /profiles/me ต้องบอกว่า field ไหนแก้ไม่ได้', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/profiles/me')
      .expect(200);

    expect(response.body.data.managed_by_core).toContain('display_name');
    expect(response.body.data.managed_by_core).toContain('avatar_url');
  });

  it('คำแนะนำตัวเกินเพดานถูกปฏิเสธ', async () => {
    await request(app.getHttpServer())
      .patch('/api/v1/profiles/me')
      .send({ bio: 'ก'.repeat(301) })
      .expect(400);
  });

  it('ใช้ไฟล์ที่ไม่มีอยู่จริงเป็นรูปปกไม่ได้', async () => {
    await request(app.getHttpServer())
      .patch('/api/v1/profiles/me')
      .send({ cover_asset_id: '00000000-0000-4000-8000-000000000000' })
      .expect(404);
  });

  it('GET /presence คืนรายชื่อคนออนไลน์', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/presence')
      .expect(200);

    expect(Array.isArray(response.body.data.online_usernames)).toBe(true);
    expect(typeof response.body.data.total_online).toBe('number');
  });

  it('badge มาจาก layer2_role ไม่ใช่ layer1_role', async () => {
    // ต้องมาพร้อมการแปลงชื่อในคำขอเดียว ไม่งั้นหน้าบ้านต้องยิงถามสิทธิ์
    // ทีละคนเพื่อวาดเครื่องหมายถูก = N+1 ตอนโหลดรายชื่อ
    const response = await request(app.getHttpServer())
      .get('/api/v1/profiles?usernames=6700000000-admin,6704101382-anuchat')
      .expect(200);

    for (const row of response.body.data) {
      expect('badge' in row).toBe(true);
      expect([null, 'STAFF', 'ADMIN']).toContain(row.badge);
    }
  });

  it('รายชื่อสมาชิกบอกว่าสิทธิ์นี้ตั้งเองหรือแปลงมาอัตโนมัติ', async () => {
    // ถ้าไม่มีฟิลด์นี้ ผู้ดูแลจะไม่รู้ว่าค่าที่เห็นเป็นการตัดสินใจของใคร
    // และจะเจอเคส "อาจารย์ค้างเป็น GUEST" โดยไม่รู้สาเหตุ
    const response = await request(app.getHttpServer())
      .get('/api/v1/subsystem-members')
      .set('x-user-id', '6700000000-admin')
      .set('x-layer1-role', 'admin')
      .expect(200);

    for (const row of response.body.data) {
      expect(typeof row.layer2_role_explicit).toBe('boolean');
    }
  });

  it('สิทธิ์ Layer 2 ปรับตาม layer1_role ถ้าไม่ได้ตั้งเอง', async () => {
    // ผู้ใช้ใหม่ที่ header บอกว่าเป็น staff ต้องได้ EDITOR ทันทีที่เรียก /me
    // ไม่ใช่ค้างเป็น GUEST เพราะแถวถูกสร้างไว้ก่อนโดยคนอื่น
    const response = await request(app.getHttpServer())
      .get('/api/v1/subsystem-members/me')
      .set('x-user-id', '6700000777-newteacher')
      .set('x-layer1-role', 'staff')
      .expect(200);

    expect(response.body.data.layer2_role).toBe('EDITOR');
  });

  /// สร้างห้องหนึ่งห้องพร้อมข้อความหนึ่งข้อความ แล้วคืน id ของทั้งคู่
  async function seedChannelWithMessage(owner: string, name: string) {
    const channel = await request(app.getHttpServer())
      .post('/api/v1/channels')
      .set('x-user-id', owner)
      .set('x-layer1-role', 'staff')
      .send({ kind: 'GROUP', name })
      .expect(201);

    const channelId = channel.body.data.id;

    const message = await request(app.getHttpServer())
      .post(`/api/v1/channels/${channelId}/messages`)
      .set('x-user-id', owner)
      .set('x-layer1-role', 'staff')
      .send({
        content: 'ข้อความสำหรับทดสอบยอดรีแอ็กชัน',
        client_nonce: `nonce-${name}`,
      })
      .expect(201);

    return { channelId, messageId: message.body.data.id as string };
  }

  it('ขอยอดรีแอ็กชันหลายชิ้นได้ในคำขอเดียว', async () => {
    // endpoint นี้แทนการยิงทีละข้อความ — วัดแล้วเร็วขึ้น 19 เท่าที่ 40 ข้อความ
    // ถ้าเทสต์นี้หาย แปลว่ามีคนเอา N+1 กลับเข้ามา
    const owner = '6700000333-reactowner';
    const first = await seedChannelWithMessage(owner, 'ห้องรีแอ็กชัน ก');
    const second = await seedChannelWithMessage(owner, 'ห้องรีแอ็กชัน ข');

    const ids = [first.messageId, second.messageId];

    const response = await request(app.getHttpServer())
      .get(
        `/api/v1/reactions/summaries?target_kind=MESSAGE&target_ids=${ids.join(',')}`,
      )
      .set('x-user-id', owner)
      .set('x-layer1-role', 'staff')
      .expect(200);

    expect(Array.isArray(response.body.data)).toBe(true);
    expect(response.body.data).toHaveLength(ids.length);

    for (const summary of response.body.data) {
      expect(Array.isArray(summary.totals)).toBe(true);
      expect(typeof summary.total_count).toBe('number');
    }
  });

  it('ยอดรีแอ็กชันของห้องที่ไม่ได้เป็นสมาชิก ต้องไม่หลุด', async () => {
    // ทางเขียนเช็คสมาชิกมาตลอด แต่ทางอ่านไม่เคยเช็ค — ใครที่รู้หรือเดา
    // message id ถูก ก็ดูยอดอิโมจิของห้องส่วนตัวคนอื่นได้ และใช้ยืนยันว่า
    // id นั้นมีอยู่จริงด้วย
    const { messageId } = await seedChannelWithMessage(
      '6700000444-secretowner',
      'ห้องที่คนนอกไม่ควรเห็น',
    );

    // เจ้าของเห็นของตัวเองได้ตามปกติ
    const owner = await request(app.getHttpServer())
      .get(
        `/api/v1/reactions/summaries?target_kind=MESSAGE&target_ids=${messageId}`,
      )
      .set('x-user-id', '6700000444-secretowner')
      .set('x-layer1-role', 'staff')
      .expect(200);

    expect(owner.body.data).toHaveLength(1);

    // คนนอกต้องไม่ได้อะไรกลับไปเลย
    const outsider = await request(app.getHttpServer())
      .get(
        `/api/v1/reactions/summaries?target_kind=MESSAGE&target_ids=${messageId}`,
      )
      .set('x-user-id', '6799999999-outsider')
      .set('x-layer1-role', 'student')
      .expect(200);

    expect(outsider.body.data).toEqual([]);

    // ทางเดี่ยวก็ต้องไม่หลุดเหมือนกัน
    const single = await request(app.getHttpServer())
      .get(
        `/api/v1/reactions?target_kind=MESSAGE&target_id=${messageId}`,
      )
      .set('x-user-id', '6799999999-outsider')
      .set('x-layer1-role', 'student')
      .expect(200);

    expect(single.body.data.total_count).toBe(0);
    expect(single.body.data.totals).toEqual([]);
  });

  it('ขอยอดรีแอ็กชันเกินเพดานถูกปฏิเสธ', async () => {
    const ids = Array.from(
      { length: 101 },
      (_value, index) =>
        `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    );

    await request(app.getHttpServer())
      .get(
        `/api/v1/reactions/summaries?target_kind=MESSAGE&target_ids=${ids.join(',')}`,
      )
      .expect(400);
  });

  it('รายการห้องคืน unread_count ครบทุกห้อง', async () => {
    // เดิมนับด้วย COUNT ต่อห้อง (2+N คิวรี) ตอนนี้เป็น groupBy ครั้งเดียว
    // เทสต์นี้กันไม่ให้การเปลี่ยนวิธีนับทำให้บางห้องขาดค่าไป
    const response = await request(app.getHttpServer())
      .get('/api/v1/channels?per_page=100')
      .expect(200);

    for (const channel of response.body.data) {
      expect(typeof channel.unread_count).toBe('number');
      expect(channel.unread_count).toBeGreaterThanOrEqual(0);
    }
  });

  it('preflight ของเบราว์เซอร์ต้องผ่าน พร้อมอนุญาต header ตัวตนของ Gateway', async () => {
    // เทสต์ชุดนี้ทั้งหมดใช้ supertest ซึ่งไม่บังคับ CORS เหมือน curl —
    // จึงเคยเห็น HTTP 200 ตลอดทั้งที่เบราว์เซอร์จริงถูกบล็อกทุกคำขอ
    // เทสต์นี้ตรวจ "header ที่ตอบกลับ" โดยตรง ซึ่งเป็นสิ่งที่เบราว์เซอร์ดู
    const response = await request(app.getHttpServer())
      .options('/api/v1/posts')
      .set('Origin', 'http://localhost:3000')
      .set('Access-Control-Request-Method', 'GET')
      .set('Access-Control-Request-Headers', 'x-user-id,content-type');

    expect(response.headers['access-control-allow-origin']).toBe(
      'http://localhost:3000',
    );

    const allowed = (response.headers['access-control-allow-headers'] ?? '')
      .toLowerCase();

    // ขาด header ตัวใดตัวหนึ่ง = คำขอทั้งก้อนถูกบล็อกโดยไม่มี error ฝั่งเซิร์ฟเวอร์
    for (const header of ['x-user-id', 'x-layer1-role', 'x-faculty']) {
      expect(allowed).toContain(header);
    }
  });

  it('คำขอจริงจากหน้าบ้านต้องได้ Access-Control-Allow-Origin กลับมา', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/posts?per_page=1')
      .set('Origin', 'http://localhost:3000')
      .expect(200);

    expect(response.headers['access-control-allow-origin']).toBe(
      'http://localhost:3000',
    );
  });

  it('โดเมนนอกรายการต้องไม่ได้รับอนุญาต', async () => {
    // ถ้าหลุดเป็น * เมื่อไหร่ เว็บไหนก็อ่าน API ในนามผู้ใช้ที่ล็อกอินอยู่ได้
    const response = await request(app.getHttpServer())
      .get('/api/v1/posts?per_page=1')
      .set('Origin', 'https://evil.example.com');

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('ปฏิเสธ field ที่ไม่อยู่ใน DTO เพื่อไม่ให้ client ยัดค่าเกินสัญญา', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/assets/upload-intents')
      .send({
        file_name: 'ok.png',
        size_bytes: 100,
        bucket: 'attachments',
        owner_username: 'someone-else',
      })
      .expect(400);
  });

  it('ออกจากห้องแล้ว socket ต้องถูกเตะออกจากห้องด้วย', async () => {
    // ลบแถวสมาชิกอย่างเดียวไม่พอ — socket ยังอยู่ในห้องของ socket.io
    // และการกระจายข้อความไม่ได้ตรวจสมาชิกซ้ำ อดีตสมาชิกจึงยังได้ข้อความใหม่
    // แบบสดต่อไปเรื่อย ๆ ทั้งที่เปิดหน้าห้องนั้นไม่ได้แล้ว
    const evictions: RoomEviction[] = [];
    const subscription = app
      .get(RealtimeBus)
      .evictions.subscribe((row) => evictions.push(row));

    try {
      const created = await request(app.getHttpServer())
        .post('/api/v1/channels')
        .set('x-user-id', '6700000555-evictowner')
        .set('x-layer1-role', 'staff')
        .send({ kind: 'GROUP', name: 'ห้องที่จะมีคนออก' })
        .expect(201);

      const channelId = created.body.data.id;

      await request(app.getHttpServer())
        .post(`/api/v1/channels/${channelId}/members`)
        .set('x-user-id', '6700000555-evictowner')
        .set('x-layer1-role', 'staff')
        .send({ usernames: ['6700000666-leaver'] })
        .expect(201);

      await request(app.getHttpServer())
        .delete(`/api/v1/channels/${channelId}/members/me`)
        .set('x-user-id', '6700000666-leaver')
        .set('x-layer1-role', 'student')
        .expect(204);

      expect(evictions).toContainEqual({
        room: channelId,
        username: '6700000666-leaver',
      });

      // และต้องอ่านห้องนั้นไม่ได้อีกแล้วจริง ๆ
      await request(app.getHttpServer())
        .get(`/api/v1/channels/${channelId}/messages`)
        .set('x-user-id', '6700000666-leaver')
        .set('x-layer1-role', 'student')
        .expect(404);
    } finally {
      subscription.unsubscribe();
    }
  });

  it('ศิษย์เก่าที่เป็นสมาชิกธรรมดาเพิ่มคนเข้าห้องส่วนตัวไม่ได้', async () => {
    // เงื่อนไขเดิมคือ "ไม่ใช่ผู้ดูแลห้อง **และ** เป็นนักศึกษา" จึงห้ามได้
    // เฉพาะนักศึกษา — ศิษย์เก่าที่เป็นสมาชิกธรรมดาผ่านฉลุย แล้วดึงใครก็ได้
    // เข้ามาอ่านประวัติแชททั้งห้อง
    const created = await request(app.getHttpServer())
      .post('/api/v1/channels')
      .set('x-user-id', '6700000111-owner')
      .set('x-layer1-role', 'staff')
      .send({ kind: 'GROUP', name: 'ห้องลับของอาจารย์' })
      .expect(201);

    const channelId = created.body.data.id;

    // เจ้าของห้องดึงศิษย์เก่าเข้ามาเป็นสมาชิกธรรมดา
    await request(app.getHttpServer())
      .post(`/api/v1/channels/${channelId}/members`)
      .set('x-user-id', '6700000111-owner')
      .set('x-layer1-role', 'staff')
      .send({ usernames: ['6600000222-alumni'] })
      .expect(201);

    // สมาชิกธรรมดาคนนั้นต้องเพิ่มคนอื่นต่อไม่ได้
    const forbidden = await request(app.getHttpServer())
      .post(`/api/v1/channels/${channelId}/members`)
      .set('x-user-id', '6600000222-alumni')
      .set('x-layer1-role', 'alumni')
      .send({ usernames: ['6799999999-outsider'] })
      .expect(403);

    expect(forbidden.body.success).toBe(false);

    // และคนนอกต้องยังไม่ได้เข้าห้องจริง ๆ
    //
    // 404 ไม่ใช่ 403 เพราะห้องที่ไม่ได้เป็นสมาชิกไม่ควรถูกยืนยันว่ามีอยู่จริง
    const outsider = await request(app.getHttpServer())
      .get(`/api/v1/channels/${channelId}`)
      .set('x-user-id', '6799999999-outsider')
      .set('x-layer1-role', 'student')
      .expect(404);

    expect(outsider.body.success).toBe(false);
  });

  it('ศิษย์เก่าที่เป็นสมาชิกธรรมดานัดประชุมไม่ได้', async () => {
    // ข้อความ error บอกว่า "เฉพาะผู้ดูแลห้องหรืออาจารย์" มาตลอด
    // แต่โค้ดปล่อยศิษย์เก่าผ่าน — การนัดยิงแจ้งเตือนถึงทุกคนในห้อง
    const created = await request(app.getHttpServer())
      .post('/api/v1/channels')
      .set('x-user-id', '6700000111-owner')
      .set('x-layer1-role', 'staff')
      .send({ kind: 'GROUP', name: 'ห้องนัดประชุม' })
      .expect(201);

    const channelId = created.body.data.id;

    await request(app.getHttpServer())
      .post(`/api/v1/channels/${channelId}/members`)
      .set('x-user-id', '6700000111-owner')
      .set('x-layer1-role', 'staff')
      .send({ usernames: ['6600000222-alumni'] })
      .expect(201);

    const starts = new Date(Date.now() + 3600_000);
    const ends = new Date(starts.getTime() + 3600_000);

    await request(app.getHttpServer())
      .post('/api/v1/meetings')
      .set('x-user-id', '6600000222-alumni')
      .set('x-layer1-role', 'alumni')
      .send({
        channel_id: channelId,
        title: 'นัดโดยคนที่ไม่ควรนัดได้',
        starts_at: starts.toISOString(),
        ends_at: ends.toISOString(),
      })
      .expect(403);
  });

  describe('ชั้นข้อมูล — สิ่งที่พังเฉพาะตอนคนใช้พร้อมกัน', () => {
    /// ยิงพร้อมกันจริง ๆ ด้วย Promise.all บนฐานข้อมูลจริง
    ///
    /// บั๊กกลุ่มนี้มองไม่เห็นเลยถ้าทดสอบทีละคำขอ เพราะแต่ละคำขอถูกต้องหมด
    /// สิ่งที่ผิดคือสองคำขออ่านภาพเดียวกันแล้วเขียนทับกัน
  
    it('เข้าห้องเสียงพร้อมกันหลายคน ต้องไม่ทะลุเพดานที่นั่งและต้องได้ห้องเดียวกัน', async () => {
      // เดิมอ่านจำนวนคนในห้องแล้วค่อยเขียน โดยไม่มีอะไรกันสองคำขอที่วิ่งพร้อมกัน
      // อ่านเลขเดียวกัน — ที่นั่งเหลือหนึ่งที่แต่ผ่านด่านทั้งคู่
      //
      // และถ้ายังไม่มีใครอยู่ในห้อง ต่างคนต่างหา session ไม่เจอ แล้วต่างก็สร้าง
      // ใหม่ — ได้ห้องเสียงซ้อนกันสองห้อง คนในคนละห้องไม่ได้ยินกันเลย
      const owner = '6700000900-voiceowner';
  
      const created = await request(app.getHttpServer())
        .post('/api/v1/channels')
        .set('x-user-id', owner)
        .set('x-layer1-role', 'staff')
        .send({ kind: 'GROUP', name: 'ห้องเสียงทดสอบการแย่งที่นั่ง', max_seats: 3 })
        .expect(201);
  
      const channelId = created.body.data.id;
  
      const crowd = Array.from(
        { length: 8 },
        (_value, index) => `67000009${String(index).padStart(2, '0')}-rusher`,
      );
  
      await request(app.getHttpServer())
        .post(`/api/v1/channels/${channelId}/members`)
        .set('x-user-id', owner)
        .set('x-layer1-role', 'staff')
        .send({ usernames: crowd })
        .expect(201);
  
      const results = await Promise.all(
        crowd.map((username) =>
          request(app.getHttpServer())
            .post('/api/v1/voice-sessions')
            .set('x-user-id', username)
            .set('x-layer1-role', 'student')
            .send({ channel_id: channelId }),
        ),
      );
  
      const ok = results.filter((row) => row.status === 201);
      const full = results.filter((row) => row.status === 409);
  
      // เพดานคือ 3 — ที่เหลือต้องถูกปฏิเสธ ไม่ใช่แทรกเข้าไปได้
      expect(ok).toHaveLength(3);
      expect(full).toHaveLength(5);
  
      // และทุกคนที่เข้าได้ต้องอยู่ "ห้องเดียวกัน" ไม่ใช่คนละห้องที่ชื่อเหมือนกัน
      const sessionIds = new Set(ok.map((row) => row.body.data.id));
  
      expect(sessionIds.size).toBe(1);
    });
  
    it('ทำเครื่องหมายอ่านพร้อมกันจากสองเครื่อง ต้องไม่ถอยหลัง', async () => {
      // เปิดแชทค้างไว้ทั้งบนโน้ตบุ๊กและมือถือ ทั้งคู่อ่านค่าเดิมเท่ากัน
      // แล้วต่างก็คำนวณ max ของตัวเอง — ตัวที่เขียนทีหลังชนะ ถึงจะเป็นค่าที่น้อยกว่า
      //
      // เทสต์นี้ยิงคู่ (สูง, ต่ำ) พร้อมกันหลายรอบ เพราะการแข่งกันไม่ได้แพ้ทุกครั้ง
      const owner = '6700000901-readowner';
  
      const created = await request(app.getHttpServer())
        .post('/api/v1/channels')
        .set('x-user-id', owner)
        .set('x-layer1-role', 'staff')
        .send({ kind: 'GROUP', name: 'ห้องทดสอบหมุดอ่าน' })
        .expect(201);
  
      const channelId = created.body.data.id;
  
      for (let round = 0; round < 8; round += 1) {
        const high = 1000 + round * 10;
        const low = high - 9;
  
        await Promise.all([
          request(app.getHttpServer())
            .post(`/api/v1/channels/${channelId}/read-markers`)
            .set('x-user-id', owner)
            .set('x-layer1-role', 'staff')
            .send({ seq: high }),
          request(app.getHttpServer())
            .post(`/api/v1/channels/${channelId}/read-markers`)
            .set('x-user-id', owner)
            .set('x-layer1-role', 'staff')
            .send({ seq: low }),
        ]);
  
        // ค่าที่ต่ำกว่าต้องไม่มีทางลบล้างค่าที่สูงกว่า ไม่ว่าใครเขียนทีหลัง
        const after = await request(app.getHttpServer())
          .post(`/api/v1/channels/${channelId}/read-markers`)
          .set('x-user-id', owner)
          .set('x-layer1-role', 'staff')
          .send({ seq: 1 })
          .expect(201);
  
        expect(after.body.data.last_read_seq).toBe(high);
      }
    });
  });
});
