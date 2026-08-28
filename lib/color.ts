"use client";

export interface DominantColors {
  primary: string; // "r g b"
  secondary: string;
}

const FALLBACK: DominantColors = { primary: "38 38 38", secondary: "10 10 10" };

/**
 * Samples an album art image down to a tiny canvas and buckets pixels by
 * quantized color to find the two most common non-extreme colors, for the
 * full-screen background gradient. Falls back to a neutral dark gradient if
 * the image can't be read (CORS, load failure, etc.) — this is a nice-to-have,
 * never worth blocking playback over.
 */
export async function extractDominantColors(imageUrl: string): Promise<DominantColors> {
  try {
    const img = await loadImage(imageUrl);
    const size = 32;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return FALLBACK;

    ctx.drawImage(img, 0, 0, size, size);
    const { data } = ctx.getImageData(0, 0, size, size);

    const buckets = new Map<string, { count: number; r: number; g: number; b: number }>();
    const step = 24; // quantization bucket size per channel

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const alpha = data[i + 3];
      if (alpha < 200) continue;

      // Skip near-black / near-white pixels — usually letterboxing, not the art's "color".
      const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
      if (luminance < 20 || luminance > 235) continue;

      const key = `${Math.round(r / step)}-${Math.round(g / step)}-${Math.round(b / step)}`;
      const bucket = buckets.get(key);
      if (bucket) {
        bucket.count++;
        bucket.r += r;
        bucket.g += g;
        bucket.b += b;
      } else {
        buckets.set(key, { count: 1, r, g, b });
      }
    }

    const ranked = [...buckets.values()].sort((a, b) => b.count - a.count);
    if (ranked.length === 0) return FALLBACK;

    const toRgbString = (bucket: (typeof ranked)[number]) =>
      `${Math.round(bucket.r / bucket.count)} ${Math.round(bucket.g / bucket.count)} ${Math.round(bucket.b / bucket.count)}`;

    return {
      primary: toRgbString(ranked[0]),
      secondary: toRgbString(ranked[1] ?? ranked[0]),
    };
  } catch {
    return FALLBACK;
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
