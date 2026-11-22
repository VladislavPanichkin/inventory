import { z } from "@hono/zod-openapi";

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1).openapi({ example: 1 }),
  pageSize: z.coerce.number().int().min(1).max(100).default(20).openapi({ example: 20 }),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export function paginationArgs({ page, pageSize }: PaginationQuery) {
  return { skip: (page - 1) * pageSize, take: pageSize };
}

export function paginationMeta({ page, pageSize }: PaginationQuery, total: number) {
  return { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}
