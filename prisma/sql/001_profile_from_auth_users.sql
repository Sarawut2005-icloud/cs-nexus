-- CS Nexus · M1 — ผูก Profile เข้ากับ auth.users
--
-- Prisma ไม่ได้จัดการ schema `auth` ของ Supabase จึงต้องเขียนส่วนนี้ด้วยมือ
-- รันไฟล์นี้ "หลัง" prisma migrate deploy ครั้งแรก (ใน Supabase SQL Editor
-- หรือ psql ก็ได้) และรันได้ซ้ำโดยไม่พัง
--
-- เงื่อนไขก่อนรัน: DATABASE_URL ต้องชี้ไปที่ Postgres ตัวเดียวกับที่ Supabase Auth
-- ใช้อยู่ ไม่ใช่ฐานข้อมูลแยก — ไม่งั้น FK ข้ามฐานข้อมูลนี้ทำไม่ได้ (สเปก D1)

-- 1) ลบโปรไฟล์เมื่อบัญชีถูกลบ และกันแถว Profile ที่ไม่มีบัญชีจริงรองรับ
alter table public."Profile"
  drop constraint if exists "Profile_id_fkey";

alter table public."Profile"
  add constraint "Profile_id_fkey"
  foreign key (id) references auth.users (id) on delete cascade;

-- 2) สร้างโปรไฟล์อัตโนมัติเมื่อมีบัญชีใหม่
--
-- studentId ที่มาจากฟอร์มสมัครเองยัง "ไม่ถือว่ายืนยันแล้ว" (studentIdVerified = false)
-- และถ้ารหัสนั้นมีคนใช้ไปแล้ว จะไม่ให้ทับกัน — ใส่ค่าชั่วคราวไว้แทน เพื่อไม่ให้
-- unique constraint ทำให้การสมัครล้มทั้งรายการ (§9-V1)
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  claimed_id text := nullif(trim(new.raw_user_meta_data ->> 'student_id'), '');
  resolved_id text;
begin
  if claimed_id is null
     or exists (select 1 from public."Profile" p where p."studentId" = claimed_id)
  then
    resolved_id := 'PENDING-' || new.id::text;
  else
    resolved_id := claimed_id;
  end if;

  insert into public."Profile" (id, "studentId", name, "studentIdVerified", "updatedAt")
  values (
    new.id,
    resolved_id,
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
      split_part(coalesce(new.email, 'ผู้ใช้'), '@', 1)
    ),
    false,
    now()
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- 3) เติมโปรไฟล์ให้บัญชีที่สมัครไว้ก่อนติดตั้ง trigger
insert into public."Profile" (id, "studentId", name, "studentIdVerified", "updatedAt")
select
  u.id,
  'PENDING-' || u.id::text,
  coalesce(
    nullif(trim(u.raw_user_meta_data ->> 'full_name'), ''),
    split_part(coalesce(u.email, 'ผู้ใช้'), '@', 1)
  ),
  false,
  now()
from auth.users u
where not exists (select 1 from public."Profile" p where p.id = u.id)
on conflict (id) do nothing;
