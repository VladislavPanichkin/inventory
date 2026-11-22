/**
 * Prepares a photo for upload entirely in the browser:
 *  - decodes whatever the device provides (JPEG, PNG, WebP; iPhones hand over HEIC as JPEG),
 *    honouring the camera's rotation,
 *  - produces a full-size JPEG (longest side ≤ 2048 px) and a thumbnail (≤ 600 px),
 *  - re-encoding drops all embedded metadata, including the GPS location phones add.
 *
 * A 6 MB phone photo becomes roughly 0.5 MB + 50 KB, so uploads are fast on mobile data.
 */
export const FULL_MAX_SIDE = 2048;
export const THUMB_MAX_SIDE = 600;
const FULL_QUALITY = 0.85;
const THUMB_QUALITY = 0.8;

export interface PreparedImage {
  full: Blob;
  thumbnail: Blob;
  width: number;
  height: number;
}

export class ImageDecodeError extends Error {
  constructor(fileName: string) {
    super(`“${fileName}” is not a photo this browser can open.`);
    this.name = "ImageDecodeError";
  }
}

/** Scales (never enlarges) so the longest side is at most `maxSide`. */
export function fitWithin(width: number, height: number, maxSide: number): { width: number; height: number } {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

type Decoded = { source: CanvasImageSource; width: number; height: number; release: () => void };

async function decode(file: File): Promise<Decoded> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
    } catch {
      // Fall through to the <img> decoder (some browsers reject formats here that <img> accepts).
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, release: () => URL.revokeObjectURL(url) };
  } catch {
    URL.revokeObjectURL(url);
    throw new ImageDecodeError(file.name);
  }
}

function render(source: CanvasImageSource, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser cannot process images.");
  // JPEG has no transparency: put transparent PNG/WebP areas on white instead of black.
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(source, 0, 0, width, height);
  return canvas;
}

function toJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("This browser could not encode the photo."))),
      "image/jpeg",
      quality,
    );
  });
}

export async function prepareImage(file: File): Promise<PreparedImage> {
  const decoded = await decode(file);
  try {
    if (decoded.width === 0 || decoded.height === 0) throw new ImageDecodeError(file.name);
    const fullSize = fitWithin(decoded.width, decoded.height, FULL_MAX_SIDE);
    const fullCanvas = render(decoded.source, fullSize.width, fullSize.height);
    // The thumbnail is drawn from the already-reduced canvas: sharper than one big downscale.
    const thumbSize = fitWithin(fullSize.width, fullSize.height, THUMB_MAX_SIDE);
    const thumbCanvas = render(fullCanvas, thumbSize.width, thumbSize.height);
    return {
      full: await toJpeg(fullCanvas, FULL_QUALITY),
      thumbnail: await toJpeg(thumbCanvas, THUMB_QUALITY),
      width: fullSize.width,
      height: fullSize.height,
    };
  } finally {
    decoded.release();
  }
}
