"use client";

import { useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Upload } from "lucide-react";
import { usePlayerContext } from "./player-context";

interface PendingUpload {
  file: File;
  durationMs: number;
  title: string;
  artist: string;
}

export default function UploadButton() {
  const { uploadLocalFile } = usePlayerContext();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<PendingUpload | null>(null);
  const [saving, setSaving] = useState(false);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    const durationMs = await readAudioDuration(file);
    const guessedTitle = file.name.replace(/\.[^.]+$/, "");
    setPending({ file, durationMs, title: guessedTitle, artist: "" });
  };

  const confirm = async () => {
    if (!pending) return;
    setSaving(true);
    try {
      await uploadLocalFile(pending.file, {
        title: pending.title || pending.file.name,
        artist: pending.artist || "Unknown Artist",
        durationMs: pending.durationMs,
      });
      setPending(null);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <button
        onClick={() => inputRef.current?.click()}
        className="flex shrink-0 items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-2.5 text-xs text-white/70 backdrop-blur-md transition hover:bg-white/10"
        title="내 파일 업로드"
      >
        <Upload className="h-3.5 w-3.5" />
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0])}
      />

      <AnimatePresence>
        {pending && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
            onClick={() => !saving && setPending(null)}
          >
            <motion.div
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.98 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-sm rounded-2xl border border-white/10 bg-neutral-900 p-5"
            >
              <h2 className="mb-4 text-sm font-semibold text-white">파일 추가</h2>
              <label className="mb-3 block text-xs text-white/50">
                제목
                <input
                  value={pending.title}
                  onChange={(e) => setPending({ ...pending, title: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:outline-none"
                />
              </label>
              <label className="mb-5 block text-xs text-white/50">
                아티스트
                <input
                  value={pending.artist}
                  onChange={(e) => setPending({ ...pending, artist: e.target.value })}
                  placeholder="Unknown Artist"
                  className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none"
                />
              </label>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setPending(null)}
                  className="rounded-full px-4 py-1.5 text-xs text-white/60 hover:text-white"
                >
                  취소
                </button>
                <button
                  onClick={confirm}
                  disabled={saving}
                  className="rounded-full bg-white px-4 py-1.5 text-xs font-medium text-black disabled:opacity-50"
                >
                  {saving ? "추가 중…" : "추가"}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function readAudioDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const audio = document.createElement("audio");
    audio.preload = "metadata";
    audio.onloadedmetadata = () => {
      resolve(audio.duration * 1000 || 0);
      URL.revokeObjectURL(audio.src);
    };
    audio.onerror = () => resolve(0);
    audio.src = URL.createObjectURL(file);
  });
}
