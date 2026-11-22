/**
 * Development seed data. Idempotent: safe to run repeatedly (demo products are
 * matched by their unique demo names, so existing ones are left untouched).
 * Run with `npm run db:seed` (or automatically by `npm run db:reset`).
 *
 * Demo listings use fake eBay item IDs in the 999xxxxxxxxx range, so they can't be
 * confused with real listings.
 */
import { Prisma } from "../src/generated/prisma/client.js";
import { createDatabase } from "../src/infrastructure/database.js";
import { setAdminCredentials } from "../src/modules/authentication/admin-account.js";

try {
  process.loadEnvFile(".env");
} catch {
  /* env provided by the shell */
}

if (process.env.NODE_ENV === "production") {
  console.error("Refusing to seed demo data with NODE_ENV=production.");
  process.exit(1);
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const currency = process.env.DEFAULT_CURRENCY ?? "EUR";
const marketplaceId = process.env.EBAY_MARKETPLACE_ID ?? "EBAY_DE";

type SeedProduct = {
  name: string;
  description: string;
  price: string;
  condition: string;
  status: "AVAILABLE" | "RESERVED" | "SOLD" | "ARCHIVED";
  ebayItemId?: string;
};

const products: SeedProduct[] = [
  { name: "Leica M3 rangefinder body (1957)", description: "Double-stroke, serviced 2024. Clean finder.", price: "1450.00", condition: "Used – Very Good", status: "AVAILABLE", ebayItemId: "999000000001" },
  { name: "Omega Seamaster 300 (ref. 165.024)", description: "Original dial, no box/papers.", price: "3200.00", condition: "Used – Good", status: "AVAILABLE", ebayItemId: "999000000002" },
  { name: "Braun SK 4 record player", description: "Dieter Rams design, working, lid has minor scratches.", price: "890.00", condition: "Used – Good", status: "SOLD", ebayItemId: "999000000003" },
  { name: "Olivetti Valentine typewriter, red", description: "Complete with case. New ribbon.", price: "420.00", condition: "Used – Very Good", status: "AVAILABLE", ebayItemId: "999000000004" },
  { name: "Hasselblad 500C/M with 80mm Planar", description: "A12 back included. Light shutter wear.", price: "2100.00", condition: "Used – Good", status: "RESERVED", ebayItemId: "999000000005" },
  { name: "Vintage Bauhaus desk lamp", description: "Rewired, original brass base.", price: "260.00", condition: "Used – Fair", status: "AVAILABLE" },
  { name: "Nikon F2 Photomic, black", description: "Meter works, light seals replaced.", price: "540.00", condition: "Used – Very Good", status: "AVAILABLE" },
  { name: "Rolleiflex 2.8F twin-lens reflex", description: "Haze-free taking lens.", price: "1750.00", condition: "Used – Excellent", status: "AVAILABLE" },
  { name: "Swiss Army pocket watch, silver", description: "Not running; for parts or repair.", price: "75.00", condition: "For parts", status: "ARCHIVED" },
  { name: "Polaroid SX-70 Alpha 1", description: "Tested with fresh film pack.", price: "310.00", condition: "Used – Good", status: "AVAILABLE" },
];

const DAY_MS = 24 * 60 * 60 * 1000;
const createdAt = new Date(Date.now() - 10 * DAY_MS);

async function main() {
  const db = createDatabase(databaseUrl!);
  try {
    // Development administrator: created once from ADMIN_EMAIL / ADMIN_PASSWORD, never overwritten.
    // Created first, because every product belongs to an account.
    const adminEmail = process.env.ADMIN_EMAIL;
    const adminPassword = process.env.ADMIN_PASSWORD;
    if ((await db.adminUser.count({ where: { role: "ADMIN" } })) > 0) {
      console.log("Administrator already exists (unchanged). Use `npm run admin:set-password` to change it.");
    } else if (adminEmail && adminPassword) {
      const result = await setAdminCredentials(db, adminEmail, adminPassword);
      console.log(`Administrator created: ${result.email}`);
    } else {
      console.log("ADMIN_EMAIL / ADMIN_PASSWORD not set: no administrator, so no demo products were created.");
      return;
    }
    const owner = await db.adminUser.findFirstOrThrow({ where: { role: "ADMIN" }, orderBy: { createdAt: "asc" } });

    for (const item of products) {
      await db.$transaction(async (tx) => {
        const existing = await tx.product.findFirst({ where: { name: item.name, ownerId: owner.id } });

        const product = existing
          ? existing
          : await tx.product.create({
              data: {
                ownerId: owner.id,
                name: item.name,
                description: item.description,
                price: new Prisma.Decimal(item.price),
                currency,
                condition: item.condition,
                status: item.status,
                createdAt: createdAt,
                statusChanges: {
                  // SOLD items start AVAILABLE; the sale below records the AVAILABLE -> SOLD transition.
                  create: {
                    fromStatus: null,
                    toStatus: item.status === "SOLD" ? "AVAILABLE" : item.status,
                    source: "SYSTEM",
                    reason: "Development seed data",
                    createdAt: createdAt,
                  },
                },
              },
            });

        if (item.ebayItemId) {
          await tx.ebayListing.upsert({
            where: { productId: product.id },
            update: {},
            create: {
              productId: product.id,
              ebayItemId: item.ebayItemId,
              marketplaceId,
              title: item.name,
              listingStatus: item.status === "SOLD" ? "ENDED" : "ACTIVE",
              listingUrl: null, // demo items have no real eBay page
            },
          });
        }

        if (item.status === "SOLD") {
          const soldAt = new Date(Date.now() - 2 * DAY_MS);
          const sale = await tx.sale.upsert({
            where: { ebayOrderId_ebayLineItemId: { ebayOrderId: "DEMO-ORDER-0001", ebayLineItemId: "DEMO-LINE-0001" } },
            update: {},
            create: {
              productId: product.id,
              ebayOrderId: "DEMO-ORDER-0001",
              ebayLineItemId: "DEMO-LINE-0001",
              ebayItemId: item.ebayItemId ?? null,
              soldPrice: new Prisma.Decimal(item.price),
              currency,
              soldAt,
            },
          });
          if (!existing) {
            await tx.productStatusChange.create({
              data: {
                productId: product.id,
                fromStatus: "AVAILABLE",
                toStatus: "SOLD",
                source: "EBAY_ORDER",
                reason: "Demo sale",
                saleId: sale.id,
                createdAt: soldAt,
              },
            });
          }
        }
      });
    }

    const counts = await db.product.groupBy({
      by: ["status"],
      _count: { _all: true },
      where: { ownerId: owner.id, name: { in: products.map((p) => p.name) } },
    });
    console.log(
      "Seed complete:",
      counts.map((row) => `${row.status}=${row._count._all}`).join(", "),
    );
  } finally {
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error("Seed failed:", error);
  process.exit(1);
});
