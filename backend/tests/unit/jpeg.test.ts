import { describe, expect, it } from "vitest";
import { readJpegInfo } from "../../src/modules/images/jpeg.js";
import { makeJpeg, PNG_BYTES } from "../support/jpeg.js";

describe("readJpegInfo", () => {
  it("reads dimensions from the frame header", () => {
    expect(readJpegInfo(makeJpeg(2048, 1536))).toEqual({ width: 2048, height: 1536 });
    expect(readJpegInfo(makeJpeg(600, 450))).toEqual({ width: 600, height: 450 });
  });

  it("skips other segments (comments/padding) before the frame header", () => {
    const padded = makeJpeg(800, 600, 200_000);
    expect(padded.byteLength).toBeGreaterThan(199_000);
    expect(readJpegInfo(padded)).toEqual({ width: 800, height: 600 });
  });

  it("supports progressive JPEGs (SOF2)", () => {
    const progressive = makeJpeg(1024, 768);
    progressive[progressive.indexOf(0xc0, 20)] = 0xc2;
    expect(readJpegInfo(progressive)).toEqual({ width: 1024, height: 768 });
  });

  it("rejects non-JPEG data, truncated files and empty input", () => {
    expect(readJpegInfo(PNG_BYTES)).toBeNull();
    expect(readJpegInfo(new TextEncoder().encode("<script>alert(1)</script>"))).toBeNull();
    expect(readJpegInfo(makeJpeg(100, 100).slice(0, 24))).toBeNull();
    expect(readJpegInfo(new Uint8Array())).toBeNull();
    // Looks like a JPEG start but has no frame header.
    expect(readJpegInfo(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))).toBeNull();
  });

  it("rejects zero dimensions", () => {
    expect(readJpegInfo(makeJpeg(0, 100))).toBeNull();
  });
});
