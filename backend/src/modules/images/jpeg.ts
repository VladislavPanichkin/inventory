/**
 * Minimal JPEG inspection: confirms the bytes really are a JPEG (not just a file named
 * .jpg) and reads the pixel dimensions from the frame header. No decoding, no dependency.
 */
export interface JpegInfo {
  width: number;
  height: number;
}

/** Start-of-frame markers that carry dimensions (C0–CF except C4 DHT, C8 JPG, CC DAC). */
function isStartOfFrame(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

export function readJpegInfo(bytes: Uint8Array): JpegInfo | null {
  // SOI marker
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;

  let offset = 2;
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) return null; // every segment starts with 0xFF
    let marker = bytes[offset + 1]!;
    // Skip fill bytes (0xFF padding before a marker).
    while (marker === 0xff && offset + 2 < bytes.length) {
      offset += 1;
      marker = bytes[offset + 1]!;
    }
    offset += 2;

    // Standalone markers without a length (RSTn, TEM); SOI/EOI shouldn't appear here.
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) continue;
    if (marker === 0xd9 || marker === 0xda) return null; // reached image data without a frame header

    if (offset + 1 >= bytes.length) return null;
    const length = (bytes[offset]! << 8) | bytes[offset + 1]!;
    if (length < 2 || offset + length > bytes.length) return null;

    if (isStartOfFrame(marker)) {
      if (length < 7) return null;
      const height = (bytes[offset + 3]! << 8) | bytes[offset + 4]!;
      const width = (bytes[offset + 5]! << 8) | bytes[offset + 6]!;
      return width > 0 && height > 0 ? { width, height } : null;
    }
    offset += length;
  }
  return null;
}
