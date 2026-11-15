import {
  BRANDS,
  CATEGORY_NAMES,
  COMPANY_PREFIX,
  COMPANY_SUFFIX,
  COUNTRIES,
  CUSTOMER_STATUS_WEIGHTS,
  EMAIL_DOMAINS,
  FIRST_NAMES,
  LAST_NAMES,
  ORDER_STATUS_WEIGHTS,
  PAYMENT_WEIGHTS,
  PLAN_REVENUE_MULTIPLIER,
  PLAN_WEIGHTS,
  PRODUCT_ADJECTIVES,
  PRODUCT_CATEGORIES,
  PRODUCT_STATUS_WEIGHTS,
} from "./data";
import { Rng, int, isoDate, pick, round2, weighted } from "./random";

const DAY_MS = 86_400_000;

// What every generator returns: the jsonb payload + the record timestamps.
export interface GeneratedRecord {
  data: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const pad = (n: number, width: number): string => String(n).padStart(width, "0");

// ---------------------------------------------------------------------------
// Customers
// Signup dates are spread over the last 3 years, with MORE recent signups than
// old ones, so the "data growth" chart and "last 30 days" filters look real.
// ---------------------------------------------------------------------------
export function makeCustomer(rng: Rng, index: number, now: Date): GeneratedRecord {
  const first = pick(rng, FIRST_NAMES);
  const last = pick(rng, LAST_NAMES);
  const [country, , cities] = weighted(
    rng,
    COUNTRIES.map((c) => [c, c[1]] as const),
  );
  const plan = weighted(rng, PLAN_WEIGHTS);

  const daysAgo = Math.floor(1095 * (1 - Math.sqrt(rng())));
  const createdAt = new Date(now.getTime() - daysAgo * DAY_MS - int(rng, 0, DAY_MS - 1));
  const activeSpan = Math.max(now.getTime() - createdAt.getTime(), 1);
  const lastActive = new Date(createdAt.getTime() + Math.floor(rng() * activeSpan));

  // exponential-like revenue: many small customers, few big ones
  const baseRevenue = -Math.log(1 - rng()) * 8000;
  const revenue = round2(baseRevenue * PLAN_REVENUE_MULTIPLIER[plan]);

  const emailSlug = `${first}.${last}`.toLowerCase().replace(/[^a-z.]/g, "");

  return {
    data: {
      customerId: `CUST-${pad(index + 1, 6)}`,
      name: `${first} ${last}`,
      email: `${emailSlug}${index + 1}@${pick(rng, EMAIL_DOMAINS)}`,
      company: `${pick(rng, COMPANY_PREFIX)} ${pick(rng, COMPANY_SUFFIX)}`,
      country,
      city: pick(rng, cities),
      status: weighted(rng, CUSTOMER_STATUS_WEIGHTS),
      plan,
      revenue,
      signupDate: isoDate(createdAt),
      lastActive: isoDate(lastActive),
      isVerified: rng() < 0.82,
    },
    createdAt,
    updatedAt: lastActive,
  };
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------
export function makeProduct(rng: Rng, index: number, now: Date): GeneratedRecord {
  const category = pick(rng, CATEGORY_NAMES);
  const noun = pick(rng, PRODUCT_CATEGORIES[category]);
  const brand = pick(rng, BRANDS);
  const name = `${brand} ${pick(rng, PRODUCT_ADJECTIVES)} ${noun}`;

  const daysAgo = int(rng, 30, 1500);
  const createdAt = new Date(now.getTime() - daysAgo * DAY_MS);

  return {
    data: {
      sku: `SKU-${pad(index + 1, 5)}`,
      name,
      category,
      brand,
      price: round2(5 + Math.pow(rng(), 2) * 495),
      stock: int(rng, 0, 900),
      rating: round2(2.5 + rng() * 2.5),
      status: weighted(rng, PRODUCT_STATUS_WEIGHTS),
      releaseDate: isoDate(createdAt),
    },
    createdAt,
    updatedAt: createdAt,
  };
}

// ---------------------------------------------------------------------------
// Orders (need the customer + product they point to)
// ---------------------------------------------------------------------------
export interface CustomerRef {
  recordId: number; // dataset_records.id
  customerId: string; // "CUST-000001"
  name: string;
  createdAt: Date;
}

export interface ProductRef {
  recordId: number;
  sku: string;
  name: string;
  price: number;
}

export function makeOrder(
  rng: Rng,
  index: number,
  now: Date,
  customer: CustomerRef,
  product: ProductRef,
): GeneratedRecord {
  const quantity = int(rng, 1, 5);
  const span = Math.max(now.getTime() - customer.createdAt.getTime(), 1);
  const orderDate = new Date(customer.createdAt.getTime() + Math.floor(rng() * span));

  return {
    data: {
      orderNumber: `ORD-${pad(index + 1, 7)}`,
      // customerName/productName are copied here on purpose: the table can show
      // them without a JOIN, which keeps big list queries fast.
      customerName: customer.name,
      productName: product.name,
      quantity,
      total: round2(product.price * quantity),
      status: weighted(rng, ORDER_STATUS_WEIGHTS),
      paymentMethod: weighted(rng, PAYMENT_WEIGHTS),
      orderDate: isoDate(orderDate),
      customerId: customer.customerId,
      productSku: product.sku,
    },
    createdAt: orderDate,
    updatedAt: orderDate,
  };
}
