import { describe, expect, it, vi } from "vitest";
import { backoffDelay, withRetry } from "../../src/common/retry.js";

class Retryable extends Error {}

describe("withRetry", () => {
  it("retries retryable errors with exponential backoff, then succeeds", async () => {
    const sleeps: number[] = [];
    const op = vi.fn().mockRejectedValueOnce(new Retryable()).mockRejectedValueOnce(new Retryable()).mockResolvedValue("ok");

    const result = await withRetry(op, {
      retries: 3,
      baseDelayMs: 100,
      isRetryable: (e) => e instanceof Retryable,
      sleep: async (ms) => void sleeps.push(ms),
      random: () => 1,
    });

    expect(result).toBe("ok");
    expect(op).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([100, 200]);
  });

  it("does not retry non-retryable errors", async () => {
    const op = vi.fn().mockRejectedValue(new Error("fatal"));
    await expect(withRetry(op, { retries: 3, baseDelayMs: 1, isRetryable: () => false, sleep: async () => {} })).rejects.toThrow("fatal");
    expect(op).toHaveBeenCalledTimes(1);
  });

  it("gives up after the configured retries", async () => {
    const op = vi.fn().mockRejectedValue(new Retryable());
    await expect(withRetry(op, { retries: 2, baseDelayMs: 1, isRetryable: () => true, sleep: async () => {} })).rejects.toBeInstanceOf(Retryable);
    expect(op).toHaveBeenCalledTimes(3);
  });
});

describe("backoffDelay", () => {
  it("grows exponentially, is capped and jittered within [half, full]", () => {
    expect(backoffDelay(0, 100, 10_000, () => 0)).toBe(50);
    expect(backoffDelay(3, 100, 10_000, () => 1)).toBe(800);
    expect(backoffDelay(20, 100, 1_000, () => 1)).toBe(1_000);
  });
});
