/**
 * Sample inventory shown to the demo account. Restored at every demo sign-in.
 *
 * The eBay item and order IDs are deliberately not numeric: real eBay IDs are digits only,
 * so a sample row can never match (or block) a real listing or order.
 */
export interface DemoProduct {
  name: string;
  description: string;
  price: string;
  condition: string;
  status: "AVAILABLE" | "RESERVED" | "SOLD" | "ARCHIVED";
  /** Days before "now" the item was added, so sorting by date looks natural. */
  addedDaysAgo: number;
  /** Sample eBay listing shown on the item (no real eBay page behind it). */
  ebayItemId?: string;
  /** Sample sale; only for SOLD items. */
  sale?: { orderId: string; lineItemId: string; soldDaysAgo: number };
  /**
   * Sample photo: `<file>.jpg` and `<file>_thumb.jpg` in backend/assets/demo-photos.
   * `credit` is shown in the item's description (the licenses require attribution);
   * sources are listed in that folder's CREDITS.md.
   */
  photo?: { file: string; credit: string };
}

const commons = (author: string, license: string) => `${author}, ${license}, via Wikimedia Commons`;

/** Seller name of the simulated eBay account the demo visitor can "connect". */
export const DEMO_SELLER_USERNAME = "sample_seller";

/**
 * A listing of the simulated eBay account that is not in the sample inventory yet, so the
 * visitor can add it. (The sample items above that carry an eBay item ID and are still for
 * sale are listings of the same account, shown as already in the inventory.)
 */
export interface DemoListing {
  itemId: string;
  title: string;
  price: string;
  quantityAvailable: number;
  photo: { file: string; credit: string };
}

export const DEMO_NEW_LISTINGS: DemoListing[] = [
  {
    itemId: "DEMO-2001",
    title: "Canon AE-1 with FD 50mm f/1.8, tested and working",
    price: "189.00",
    quantityAvailable: 1,
    photo: { file: "canon-ae1", credit: commons("RRT877", "CC0") },
  },
  {
    itemId: "DEMO-2002",
    title: "Nintendo Game Boy DMG-01 (1989), grey, working",
    price: "95.00",
    quantityAvailable: 1,
    photo: { file: "game-boy", credit: commons("Evan-Amos", "public domain") },
  },
  {
    itemId: "DEMO-2003",
    title: "Technics SL-1200 MK2 turntable, direct drive",
    price: "540.00",
    quantityAvailable: 1,
    photo: { file: "technics-sl1200", credit: commons("Adrian DuMay", "CC BY 2.0") },
  },
  {
    itemId: "DEMO-2004",
    title: "Sony Walkman TPS-L2 (1979), blue, serviced",
    price: "780.00",
    quantityAvailable: 1,
    photo: { file: "sony-walkman", credit: commons("Anna Gerdén", "CC BY-SA 3.0") },
  },
];

export const DEMO_PRODUCTS: DemoProduct[] = [
  {
    name: "Leica M3 rangefinder with 35mm lens (1957)",
    description: "Double-stroke, serviced 2024. Clean finder.",
    photo: { file: "leica-m3", credit: commons("Sebastian Stabinger", "CC BY 3.0") },
    price: "1450.00",
    condition: "Used – Very Good",
    status: "AVAILABLE",
    addedDaysAgo: 21,
    ebayItemId: "DEMO-1001",
  },
  {
    name: "Omega Seamaster 300 (ref. 165.024)",
    description: "Original dial, no box or papers.",
    photo: { file: "omega-seamaster", credit: commons("Clyde94", "CC BY-SA 4.0") },
    price: "3200.00",
    condition: "Used – Good",
    status: "AVAILABLE",
    addedDaysAgo: 19,
    ebayItemId: "DEMO-1002",
  },
  {
    name: "Braun SK 4 record player",
    description: "Dieter Rams design, working, lid has minor scratches.",
    photo: { file: "braun-sk4", credit: commons("Alf van Beem", "CC0") },
    price: "890.00",
    condition: "Used – Good",
    status: "SOLD",
    addedDaysAgo: 18,
    ebayItemId: "DEMO-1003",
    sale: { orderId: "DEMO-ORDER-1001", lineItemId: "DEMO-LINE-1001", soldDaysAgo: 2 },
  },
  {
    name: "Olivetti Valentine typewriter, red",
    description: "Complete with case. New ribbon.",
    photo: { file: "olivetti-valentine", credit: commons("Maksym Kozlenko", "CC BY-SA 4.0") },
    price: "420.00",
    condition: "Used – Very Good",
    status: "AVAILABLE",
    addedDaysAgo: 15,
    ebayItemId: "DEMO-1004",
  },
  {
    name: "Hasselblad 500C/M with 80mm Planar",
    description: "A12 back included. Light shutter wear.",
    photo: { file: "hasselblad-500cm", credit: commons("デニス モジョ", "CC BY 2.0") },
    price: "2100.00",
    condition: "Used – Good",
    status: "RESERVED",
    addedDaysAgo: 12,
    ebayItemId: "DEMO-1005",
  },
  {
    name: "Vintage gooseneck desk lamp",
    description: "Rewired, original steel shade.",
    photo: { file: "desk-lamp", credit: commons("DogsRNice", "CC BY-SA 4.0") },
    price: "260.00",
    condition: "Used – Fair",
    status: "AVAILABLE",
    addedDaysAgo: 10,
  },
  {
    name: "Nikon F2 Photomic, black",
    description: "Meter works, light seals replaced.",
    photo: { file: "nikon-f2", credit: commons("Thomas Altfather Good", "CC BY-SA 4.0") },
    price: "540.00",
    condition: "Used – Very Good",
    status: "SOLD",
    addedDaysAgo: 9,
    ebayItemId: "DEMO-1006",
    sale: { orderId: "DEMO-ORDER-1002", lineItemId: "DEMO-LINE-1002", soldDaysAgo: 5 },
  },
  {
    name: "Rolleiflex 2.8F twin-lens reflex",
    description: "Haze-free taking lens.",
    photo: { file: "rolleiflex", credit: commons("Sputniktilt", "CC BY-SA 3.0") },
    price: "1750.00",
    condition: "Used – Excellent",
    status: "AVAILABLE",
    addedDaysAgo: 6,
  },
  {
    name: "Swiss pocket watch, silver, key-wound",
    description: "Not running; for parts or repair. With case.",
    photo: { file: "pocket-watch", credit: commons("Joe Haupt", "CC BY-SA 2.0") },
    price: "75.00",
    condition: "For parts",
    status: "ARCHIVED",
    addedDaysAgo: 30,
  },
  {
    name: "Polaroid SX-70 Alpha 1",
    description: "Tested with a fresh film pack.",
    photo: { file: "polaroid-sx70", credit: commons("Thomas Backa", "CC0") },
    price: "310.00",
    condition: "Used – Good",
    status: "AVAILABLE",
    addedDaysAgo: 3,
  },
];
