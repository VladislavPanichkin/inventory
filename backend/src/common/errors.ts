import type { ContentfulStatusCode } from "hono/utils/http-status";

/**
 * Application error with an HTTP status and a stable machine-readable code.
 * Thrown from services; translated to the JSON error envelope by the app's error handler.
 */
export class AppError extends Error {
  constructor(
    public readonly status: ContentfulStatusCode,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const notFound = (resource: string, id?: string) =>
  new AppError(404, "NOT_FOUND", id ? `${resource} ${id} not found` : `${resource} not found`);

export const conflict = (message: string, details?: unknown) =>
  new AppError(409, "CONFLICT", message, details);

export const badRequest = (message: string, details?: unknown) =>
  new AppError(400, "BAD_REQUEST", message, details);

export const unauthorized = (message = "Authentication required") =>
  new AppError(401, "UNAUTHORIZED", message);
