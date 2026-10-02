"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { Avatar, type Me } from "./ProfileMenu";

const SIZE = 256; // pixels: the picture is cropped to a centred square this big before uploading

/** Load a picked file and turn it into a small square picture (WebP, or JPEG where WebP isn't available). */
async function squareImage(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("That file isn't a picture we can read."));
      i.src = url;
    });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("This browser can't resize pictures.");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, SIZE, SIZE);
    const blob = (type: string, quality: number) =>
      new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
    const webp = await blob("image/webp", 0.85);
    const out = webp?.type === "image/webp" ? webp : await blob("image/jpeg", 0.9);
    if (!out) throw new Error("Couldn't prepare the picture.");
    return out;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Your profile picture with Change / Remove, on the profile page. */
export default function AvatarUpload({ me, uploaded }: { me: Me; uploaded: boolean }) {
  const id = useId();
  const router = useRouter();
  const [busy, setBusy] = useState<"upload" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  async function pick(file: File | undefined) {
    if (!file || busy) return;
    setError(null);
    if (!file.type.startsWith("image/")) return setError("Pick a picture file (JPG, PNG, WebP…).");
    if (file.size > 15 * 1024 * 1024) return setError("That picture is over 15 MB. Pick a smaller one.");
    setBusy("upload");
    try {
      const image = await squareImage(file);
      setPreview(URL.createObjectURL(image));
      const res = await fetch("/api/avatar", { method: "POST", headers: { "Content-Type": image.type }, body: image });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Couldn't upload it. Try again.");
      router.refresh();
    } catch (e) {
      setPreview(null);
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (busy) return;
    setBusy("remove");
    setError(null);
    const res = await fetch("/api/avatar", { method: "DELETE" }).catch(() => null);
    if (res?.ok) {
      setPreview(null);
      router.refresh();
    } else setError("Couldn't remove it. Try again.");
    setBusy(null);
  }

  return (
    <div className="avatar-upload">
      <Avatar me={preview ? { ...me, avatar: preview } : me} size={72} />
      <div>
        <div className="avatar-actions">
          <label htmlFor={`${id}-file`} className="journal-csv" data-busy={busy === "upload" || undefined}>
            {busy === "upload" && <span className="btn-spinner" aria-hidden />}
            {busy === "upload" ? "Uploading…" : "Change photo"}
          </label>
          <input
            id={`${id}-file`}
            className="sr-only"
            type="file"
            accept="image/*"
            disabled={busy !== null}
            onChange={(e) => {
              void pick(e.target.files?.[0]);
              e.target.value = ""; // picking the same file again still works
            }}
          />
          {uploaded && (
            <button type="button" className="link-button" onClick={remove} disabled={busy !== null}>
              {busy === "remove" ? "Removing…" : "Remove photo"}
            </button>
          )}
        </div>
        <p className="login-hint">
          {uploaded ? "Shown in your account menu." : "Any picture works; it gets cropped to a square."}
        </p>
        {error && (
          <p className="login-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
