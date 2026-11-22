import { describe, expect, it } from "vitest";
import { createLogger, REDACTED, redact } from "../../src/common/logger.js";

describe("redact", () => {
  it("masks secret-looking keys at any depth", () => {
    const result = redact({
      refreshToken: "abc",
      nested: { client_secret: "s", Authorization: "Bearer x", ok: 1 },
      list: [{ password: "p", name: "n" }],
    });
    expect(result).toEqual({
      refreshToken: REDACTED,
      nested: { client_secret: REDACTED, Authorization: REDACTED, ok: 1 },
      list: [{ password: REDACTED, name: "n" }],
    });
  });

  it("serialises errors without losing the message", () => {
    const result = redact({ error: new Error("boom") }) as { error: { message: string } };
    expect(result.error.message).toBe("boom");
  });
});

describe("createLogger", () => {
  it("writes JSON lines, respects level and redacts fields", () => {
    const lines: string[] = [];
    const logger = createLogger({ level: "info", sink: (line) => lines.push(line) }).child({ module: "test" });

    logger.debug("hidden");
    logger.info("hello", { accessToken: "should-not-appear" });

    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]!);
    expect(entry).toMatchObject({ level: "info", message: "hello", module: "test", accessToken: REDACTED });
    expect(lines[0]).not.toContain("should-not-appear");
  });
});
