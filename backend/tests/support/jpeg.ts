/**
 * Builds a structurally valid JPEG header (SOI, APP0/JFIF, optional COM padding, SOF0 with
 * the given dimensions, EOI). It carries no real picture data, which is all the server-side
 * checks need: they read the frame header, they don't decode pixels.
 */
export function makeJpeg(width: number, height: number, totalBytes = 0): Uint8Array {
  const parts: number[] = [];
  parts.push(0xff, 0xd8); // SOI
  // APP0 "JFIF\0", version 1.1, no density units, 1x1, no thumbnail
  parts.push(0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00);

  const sof = [
    0xff, 0xc0, 0x00, 0x11, 0x08,
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
  ];
  const eoi = [0xff, 0xd9];

  // Pad with comment segments (max 65533 payload bytes each) to reach the requested size.
  let remaining = totalBytes - (parts.length + sof.length + eoi.length);
  while (remaining > 4) {
    const payload = Math.min(remaining - 4, 65_533);
    const length = payload + 2;
    parts.push(0xff, 0xfe, (length >> 8) & 0xff, length & 0xff);
    for (let i = 0; i < payload; i++) parts.push(0x20);
    remaining -= payload + 4;
  }

  return new Uint8Array([...parts, ...sof, ...eoi]);
}

/** The first bytes of a PNG file: a real image format, but not an accepted one. */
export const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]);
