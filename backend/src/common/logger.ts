/**
 * Minimal structured (JSON-lines) logger with secret redaction.
 * Uses only console, so it works on Node and on edge runtimes.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
  child(fields: Record<string, unknown>): Logger;
}

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const SECRET_KEY_PATTERN =
  /(pass(word)?|secret|token|authorization|cookie|api[-_]?key|private[-_]?key|signature|credential)/i;

export const REDACTED = "[REDACTED]";

/** Recursively replaces values of secret-looking keys. Exported for tests. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== "object") return value;
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));

  const output: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    output[key] = SECRET_KEY_PATTERN.test(key) ? REDACTED : redact(inner, depth + 1);
  }
  return output;
}

export function createLogger(
  options: { level?: LogLevel; base?: Record<string, unknown>; sink?: (line: string, level: LogLevel) => void } = {},
): Logger {
  const minLevel = LEVEL_ORDER[options.level ?? "info"];
  const base = options.base ?? {};
  const sink =
    options.sink ??
    ((line: string, level: LogLevel) => {
      if (level === "error") console.error(line);
      else if (level === "warn") console.warn(line);
      else console.log(line);
    });

  const write = (level: LogLevel, message: string, fields?: Record<string, unknown>) => {
    if (LEVEL_ORDER[level] < minLevel) return;
    const entry = redact({ time: new Date().toISOString(), level, message, ...base, ...fields });
    sink(JSON.stringify(entry), level);
  };

  return {
    debug: (message, fields) => write("debug", message, fields),
    info: (message, fields) => write("info", message, fields),
    warn: (message, fields) => write("warn", message, fields),
    error: (message, fields) => write("error", message, fields),
    child: (fields) => createLogger({ ...options, base: { ...base, ...fields } }),
  };
}
