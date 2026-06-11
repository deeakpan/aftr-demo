"use client";

import { useCallback, useState } from "react";
import Cropper, { type Area } from "react-easy-crop";
import { getCroppedCoverFile } from "@/lib/crop-image";
import {
  MARKET_COVER_ASPECT,
  MARKET_COVER_RATIO_LABEL,
} from "@/lib/market-cover";

type MarketCoverCropperProps = {
  imageSrc: string;
  fileName: string;
  onConfirm: (file: File) => void;
  onCancel: () => void;
};

export function MarketCoverCropper({
  imageSrc,
  fileName,
  onConfirm,
  onCancel,
}: MarketCoverCropperProps) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const onCropComplete = useCallback((_area: Area, pixels: Area) => {
    setCroppedAreaPixels(pixels);
  }, []);

  const handleConfirm = async () => {
    if (!croppedAreaPixels) return;
    setBusy(true);
    setError("");
    try {
      const file = await getCroppedCoverFile(imageSrc, croppedAreaPixels, fileName);
      onConfirm(file);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not crop image.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay-scrim)] p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div
        className="flex w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-[var(--border)] px-4 py-3">
          <h3 className="text-sm font-semibold text-[var(--foreground)]">Crop cover image</h3>
          <p className="mt-0.5 text-xs text-[var(--muted)]">
            Use the recommended {MARKET_COVER_RATIO_LABEL} ratio — this is exactly how the banner
            appears on market cards.
          </p>
        </div>

        <div className="relative h-[min(52vh,360px)] w-full bg-black">
          <Cropper
            image={imageSrc}
            crop={crop}
            zoom={zoom}
            aspect={MARKET_COVER_ASPECT}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={onCropComplete}
            objectFit="horizontal-cover"
          />
        </div>

        <div className="space-y-3 border-b border-[var(--border)] px-4 py-3">
          <label className="flex items-center gap-3 text-xs text-[var(--muted)]">
            <span className="shrink-0">Zoom</span>
            <input
              type="range"
              min={1}
              max={3}
              step={0.05}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="w-full accent-[var(--accent)]"
            />
          </label>
          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-xs font-semibold text-[var(--foreground)] hover:border-[var(--accent)] disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleConfirm()}
            disabled={busy || !croppedAreaPixels}
            className="rounded-full bg-[var(--accent)] px-4 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? "Saving…" : "Use cropped image"}
          </button>
        </div>
      </div>
    </div>
  );
}
