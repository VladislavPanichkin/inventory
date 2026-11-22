import { z } from "@hono/zod-openapi";

/**
 * Money travels as a decimal string ("1450.00") end-to-end, never as a float.
 */
export const moneyInputSchema = z
  .union([z.string(), z.number()])
  .transform((value) => (typeof value === "number" ? value.toString() : value.trim()))
  .pipe(
    z
      .string()
      .regex(/^\d{1,10}(\.\d{1,2})?$/, "must be a non-negative amount with at most 2 decimals, e.g. 149.90"),
  )
  .openapi({ type: "string", example: "149.90" });

export const currencySchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, "must be a 3-letter ISO 4217 code")
  .openapi({ example: "EUR" });

/** Formats a Prisma Decimal (or anything with toFixed) as a 2-decimal string. */
export function moneyToString(value: { toFixed(digits: number): string }): string {
  return value.toFixed(2);
}
