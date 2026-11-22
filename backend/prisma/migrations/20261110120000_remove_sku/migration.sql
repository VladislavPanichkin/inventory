-- Remove the internal product SKU and the copied eBay seller SKU (Custom label).
-- Products are identified by their UUID; eBay orders are matched by legacy item ID only.

-- DropIndex
DROP INDEX "ebay_listings_ebaySku_idx";

-- DropIndex
DROP INDEX "products_sku_key";

-- AlterTable
ALTER TABLE "ebay_listings" DROP COLUMN "ebaySku";

-- AlterTable
ALTER TABLE "products" DROP COLUMN "sku";
