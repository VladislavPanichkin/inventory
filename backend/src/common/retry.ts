/**
 * Retries an async operation with exponential backoff and jitter.
 * Only errors for which `isRetryable` returns true are retried.
 */
export interface RetryOptions {
  /** Additional attempts after the first one. */
  retries: number;
  baseDelayMs: number;
  maxDelayMs?: number;
  isRetryable: (error: unknown) => boolean;
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

export const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function backoffDelay(attempt: number, baseDelayMs: number, maxDelayMs: number, random: () => number): number {
  const exponential = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
  // "Equal jitter": half fixed, half random, so retries from parallel callers spread out.
  return Math.round(exponential / 2 + (random() * exponential) / 2);
}

export async function withRetry<T>(operation: (attempt: number) => Promise<T>, options: RetryOptions): Promise<T> {
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;
  const maxDelayMs = options.maxDelayMs ?? 30_000;

  for (let attempt = 0; ; attempt++) {
    try {
      return await operation(attempt);
    } catch (error) {
      if (attempt >= options.retries || !options.isRetryable(error)) throw error;
      await sleep(backoffDelay(attempt, options.baseDelayMs, maxDelayMs, random));
    }
  }
}
