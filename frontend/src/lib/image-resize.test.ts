import { describe, expect, it } from "vitest";
import { fitWithin, FULL_MAX_SIDE, THUMB_MAX_SIDE } from "@/lib/image-resize";

describe("fitWithin", () => {
  it("scales the longest side down to the limit, keeping proportions", () => {
    // 12 MP phone photo, landscape and portrait
    expect(fitWithin(4032, 3024, FULL_MAX_SIDE)).toEqual({ width: 2048, height: 1536 });
    expect(fitWithin(3024, 4032, FULL_MAX_SIDE)).toEqual({ width: 1536, height: 2048 });
    expect(fitWithin(2048, 1536, THUMB_MAX_SIDE)).toEqual({ width: 600, height: 450 });
  });

  it("never enlarges small images", () => {
    expect(fitWithin(800, 600, FULL_MAX_SIDE)).toEqual({ width: 800, height: 600 });
  });

  it("keeps extreme shapes at least one pixel wide", () => {
    expect(fitWithin(10_000, 3, THUMB_MAX_SIDE)).toEqual({ width: 600, height: 1 });
  });
});
