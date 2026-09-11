'use client';

import { useId, useState } from 'react';
import { ImagePlus, Lock, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useCharacterLimit } from '@/components/ui/dialog-utils/use-character-limit';
import { useImageUpload } from '@/components/ui/dialog-utils/use-image-upload';
import { api } from '@/lib/csmju/api';
import type { MyProfile } from '@/lib/csmju/types';

/// เพดานต้องตรงกับ `bio String? @db.VarChar(300)` ของหลังบ้าน
/// ถ้าไม่ตรง ผู้ใช้จะกดบันทึกแล้วได้ 400 ทั้งที่ตัวนับยังบอกว่าเหลือที่
const BIO_MAX = 300;

/// แก้โปรไฟล์ — **แก้ได้เฉพาะของที่เป็นของระบบย่อยนี้**
///
/// ชื่อที่แสดง รูปโปรไฟล์ คณะ และสิทธิ์ระดับองค์กร เป็นของ Core
/// (Blueprint หน้า 10) จึงแสดงแบบอ่านอย่างเดียวพร้อมไอคอนกุญแจและบอกเหตุผล
///
/// ทำแบบนี้ไม่ใช่เพราะขี้เกียจ — ระบบย่อยที่เปิดให้แก้ชื่อเองจะสร้างชื่อ
/// สองเวอร์ชันของคนเดียวกัน แล้วไม่มีใครรู้ว่าอันไหนจริง รายการ field ที่
/// ล็อกไว้มาจาก `managed_by_core` ที่หลังบ้านส่งมา ไม่ได้ hardcode ที่นี่
/// ฉะนั้นถ้าวันหนึ่ง Core ยอมให้แก้อะไรเพิ่ม หน้านี้จะตามทันเอง
export function EditProfileDialog({
  profile,
  onSaved,
}: {
  profile: MyProfile;
  onSaved: (next: MyProfile) => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { value, characterCount, handleChange, maxLength } = useCharacterLimit({
    maxLength: BIO_MAX,
    initialValue: profile.bio ?? '',
  });

  const cover = useImageUpload();
  const locked = new Set(profile.managed_by_core);

  async function save() {
    setBusy(true);
    setError(null);

    try {
      let coverAssetId: string | undefined;

      // อัปโหลดรูปปกผ่านท่อสามจังหวะก่อน ถ้าผู้ใช้เลือกไฟล์ใหม่
      if (cover.file) {
        const intent = await api.post<{
          asset_id: string;
          upload_url: string;
          upload_method: string;
          upload_headers: Record<string, string>;
        }>('/assets/upload-intents', {
          file_name: cover.file.name,
          size_bytes: cover.file.size,
          bucket: 'attachments',
        });

        const put = await fetch(intent.upload_url, {
          method: intent.upload_method || 'PUT',
          headers: intent.upload_headers ?? {},
          body: cover.file,
        });

        if (!put.ok) {
          throw new Error(`อัปโหลดรูปปกไม่สำเร็จ (HTTP ${put.status})`);
        }

        await api.post(`/assets/${intent.asset_id}/commit`);
        coverAssetId = intent.asset_id;
      }

      const next = await api.patch<MyProfile>('/profiles/me', {
        bio: value,
        ...(coverAssetId ? { cover_asset_id: coverAssetId } : {}),
      });

      onSaved(next);
      setOpen(false);
    } catch (caught) {
      // ข้อความจากหลังบ้านบอกสาเหตุจริง เช่น "รูปปกต้องเป็นไฟล์รูปภาพ"
      setError(caught instanceof Error ? caught.message : 'บันทึกไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          แก้ไขโปรไฟล์
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="border-b border-border px-6 py-4 text-base">
            แก้ไขโปรไฟล์
          </DialogTitle>
        </DialogHeader>

        <DialogDescription className="sr-only">
          แก้คำแนะนำตัวและรูปปกของคุณในระบบย่อยนี้
        </DialogDescription>

        <div className="max-h-[70vh] overflow-y-auto">
          <CoverPicker defaultImage={profile.cover_url} upload={cover} />

          <div className="px-6 pb-6 pt-4">
            <div className="space-y-4">
              {/* ─── ส่วนที่ Core เป็นเจ้าของ — อ่านอย่างเดียว ─── */}
              <div className="rounded-lg border border-border bg-muted/40 p-3">
                <p className="flex items-center gap-1.5 text-xs font-medium">
                  <Lock className="size-3.5 shrink-0 text-muted-foreground" />
                  ข้อมูลจากระบบกลาง CSMJU2030 — แก้ที่นี่ไม่ได้
                </p>

                <div className="mt-2.5 space-y-2.5">
                  <div className="space-y-1">
                    <Label
                      htmlFor={`${id}-display-name`}
                      className="text-xs text-muted-foreground"
                    >
                      ชื่อที่แสดง
                    </Label>
                    <Input
                      id={`${id}-display-name`}
                      value={profile.display_name}
                      readOnly
                      disabled
                      className="bg-background"
                    />
                  </div>

                  <div className="space-y-1">
                    <Label
                      htmlFor={`${id}-username`}
                      className="text-xs text-muted-foreground"
                    >
                      รหัสผู้ใช้ (Shared Identity)
                    </Label>
                    <Input
                      id={`${id}-username`}
                      value={profile.username}
                      readOnly
                      disabled
                      className="bg-background font-mono text-xs"
                    />
                  </div>
                </div>

                <p className="mt-2.5 text-[11px] leading-relaxed text-muted-foreground">
                  ถ้าชื่อไม่ถูกต้อง ต้องแก้ที่ระบบกลาง แล้วระบบนี้จะซิงก์ตาม
                  ภายใน 6 ชั่วโมง — ถ้าเก็บชื่อซ้ำไว้ที่นี่ มันจะล้าสมัยทันที
                  ที่ระบบกลางแก้
                  {locked.size > 0 && (
                    <>
                      {' '}
                      (field ที่ล็อก: {[...locked].join(', ')})
                    </>
                  )}
                </p>
              </div>

              {/* ─── ส่วนที่เป็นของระบบย่อยนี้ — แก้ได้ ─── */}
              <div className="space-y-2">
                <Label htmlFor={`${id}-bio`}>คำแนะนำตัว</Label>
                <Textarea
                  id={`${id}-bio`}
                  placeholder="เล่าสั้น ๆ ว่าคุณสนใจอะไร กำลังทำโปรเจกต์อะไรอยู่"
                  value={value}
                  maxLength={BIO_MAX}
                  onChange={handleChange}
                  aria-describedby={`${id}-bio-count`}
                  rows={4}
                />
                <p
                  id={`${id}-bio-count`}
                  className="text-right text-xs text-muted-foreground"
                  role="status"
                  aria-live="polite"
                >
                  เหลือ{' '}
                  <span className="tabular-nums">
                    {maxLength - characterCount}
                  </span>{' '}
                  ตัวอักษร
                </p>
              </div>

              {error && (
                <p className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                  {error}
                </p>
              )}
            </div>
          </div>
        </div>

        <DialogFooter className="border-t border-border px-6 py-4">
          <DialogClose asChild>
            <Button type="button" variant="outline" disabled={busy}>
              ยกเลิก
            </Button>
          </DialogClose>

          <Button type="button" onClick={() => void save()} disabled={busy}>
            {busy ? 'กำลังบันทึก…' : 'บันทึก'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CoverPicker({
  defaultImage,
  upload,
}: {
  defaultImage: string | null;
  upload: ReturnType<typeof useImageUpload>;
}) {
  // แยกออกมาเป็นตัวแปรของตัวเอง ไม่อ่านทะลุ object ตอน render
  //
  // `upload.fileInputRef` ทำให้ตัววิเคราะห์ของ React Compiler คิดว่าเรากำลัง
  // อ่าน ref ระหว่าง render ทั้งที่แค่ส่งตัว ref object ต่อให้ `ref=` ซึ่งเป็น
  // การใช้งานที่ถูกต้องที่สุดของมัน
  const {
    previewUrl,
    fileInputRef,
    handleThumbnailClick,
    handleFileChange,
    handleRemove,
  } = upload;

  const [hideDefault, setHideDefault] = useState(false);
  const current = previewUrl ?? (!hideDefault ? defaultImage : null);

  return (
    <div className="h-32">
      <div className="relative flex size-full items-center justify-center overflow-hidden bg-muted">
        {current && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={current}
            alt={previewUrl ? 'รูปปกที่เลือกไว้' : 'รูปปกปัจจุบัน'}
            className="size-full object-cover"
          />
        )}

        <div className="absolute inset-0 flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={handleThumbnailClick}
            className="grid size-10 place-items-center rounded-full bg-black/60 text-white transition-colors hover:bg-black/80"
            aria-label={current ? 'เปลี่ยนรูปปก' : 'เพิ่มรูปปก'}
          >
            <ImagePlus className="size-4" />
          </button>

          {current && (
            <button
              type="button"
              onClick={() => {
                handleRemove();
                setHideDefault(true);
              }}
              className="grid size-10 place-items-center rounded-full bg-black/60 text-white transition-colors hover:bg-black/80"
              aria-label="เอารูปปกออก"
            >
              <X className="size-4" />
            </button>
          )}
        </div>
      </div>

      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        className="hidden"
        accept="image/png,image/jpeg,image/webp"
        aria-label="เลือกไฟล์รูปปก"
      />
    </div>
  );
}
