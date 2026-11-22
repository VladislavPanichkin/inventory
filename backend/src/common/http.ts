import { z } from "@hono/zod-openapi";

/**
 * Consistent JSON response envelopes:
 *   success: { "data": ..., "meta"?: {...} }
 *   error:   { "error": { "code": "...", "message": "...", "details"?: ... } }
 */

export const errorResponseSchema = z
  .object({
    error: z.object({
      code: z.string().openapi({ example: "NOT_FOUND" }),
      message: z.string(),
      details: z.unknown().optional(),
      requestId: z.string().optional(),
    }),
  })
  .openapi("ErrorResponse");

export type ErrorResponse = z.infer<typeof errorResponseSchema>;

export const dataEnvelope = <T extends z.ZodType>(schema: T) => z.object({ data: schema });

export const paginationMetaSchema = z
  .object({
    page: z.number().int(),
    pageSize: z.number().int(),
    total: z.number().int(),
    totalPages: z.number().int(),
  })
  .openapi("PaginationMeta");

export const paginatedEnvelope = <T extends z.ZodType>(item: T) =>
  z.object({ data: z.array(item), meta: paginationMetaSchema });

export function errorBody(code: string, message: string, details?: unknown, requestId?: string): ErrorResponse {
  return {
    error: {
      code,
      message,
      ...(details === undefined ? {} : { details }),
      ...(requestId ? { requestId } : {}),
    },
  };
}

/** Standard OpenAPI error responses to spread into route definitions. */
export const commonErrorResponses = {
  500: {
    description: "Unexpected server error",
    content: { "application/json": { schema: errorResponseSchema } },
  },
} as const;
