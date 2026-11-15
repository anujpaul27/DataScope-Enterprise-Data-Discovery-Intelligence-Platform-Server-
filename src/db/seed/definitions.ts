import {
  CATEGORY_NAMES,
  COUNTRY_NAMES,
  CUSTOMER_STATUSES,
  ORDER_STATUSES,
  PAYMENT_METHODS,
  PLANS,
  PRODUCT_STATUSES,
} from "./data";

type FieldType = "text" | "number" | "date" | "boolean" | "select";

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  options?: string[];
  isSearchable?: boolean;
  isFilterable?: boolean;
  isSortable?: boolean;
  isVisibleByDefault?: boolean;
}

export interface DatasetDef {
  slug: string;
  name: string;
  description: string;
  category: string;
  dataSource: string;
  fields: FieldDef[];
}

export const CUSTOMERS_SLUG = "customers";
export const PRODUCTS_SLUG = "products";
export const ORDERS_SLUG = "orders";
export const ALL_SLUGS = [CUSTOMERS_SLUG, PRODUCTS_SLUG, ORDERS_SLUG];

export const customersDef: DatasetDef = {
  slug: CUSTOMERS_SLUG,
  name: "Customers",
  description:
    "Generated customer accounts with country, plan, status and lifetime revenue.",
  category: "Sales & CRM",
  dataSource: "Generated (seed script)",
  fields: [
    { key: "customerId", label: "Customer ID", type: "text" },
    { key: "name", label: "Name", type: "text" },
    { key: "email", label: "Email", type: "text" },
    { key: "company", label: "Company", type: "text" },
    { key: "country", label: "Country", type: "select", options: COUNTRY_NAMES },
    { key: "city", label: "City", type: "text", isVisibleByDefault: false },
    { key: "status", label: "Status", type: "select", options: [...CUSTOMER_STATUSES] },
    { key: "plan", label: "Plan", type: "select", options: [...PLANS] },
    { key: "revenue", label: "Revenue (USD)", type: "number" },
    { key: "signupDate", label: "Signup Date", type: "date" },
    { key: "lastActive", label: "Last Active", type: "date", isVisibleByDefault: false },
    { key: "isVerified", label: "Verified", type: "boolean", isVisibleByDefault: false },
  ],
};

export const productsDef: DatasetDef = {
  slug: PRODUCTS_SLUG,
  name: "Products",
  description: "Generated product catalog with category, price, stock and rating.",
  category: "Inventory",
  dataSource: "Generated (seed script)",
  fields: [
    { key: "sku", label: "SKU", type: "text" },
    { key: "name", label: "Name", type: "text" },
    { key: "category", label: "Category", type: "select", options: CATEGORY_NAMES },
    { key: "brand", label: "Brand", type: "text" },
    { key: "price", label: "Price (USD)", type: "number" },
    { key: "stock", label: "Stock", type: "number" },
    { key: "rating", label: "Rating", type: "number" },
    { key: "status", label: "Status", type: "select", options: [...PRODUCT_STATUSES] },
    { key: "releaseDate", label: "Release Date", type: "date", isVisibleByDefault: false },
  ],
};

export const ordersDef: DatasetDef = {
  slug: ORDERS_SLUG,
  name: "Orders",
  description:
    "Generated orders. Each order is linked to one customer and one product.",
  category: "Sales & CRM",
  dataSource: "Generated (seed script)",
  fields: [
    { key: "orderNumber", label: "Order #", type: "text" },
    { key: "customerName", label: "Customer", type: "text" },
    { key: "productName", label: "Product", type: "text" },
    { key: "quantity", label: "Qty", type: "number" },
    { key: "total", label: "Total (USD)", type: "number" },
    { key: "status", label: "Status", type: "select", options: [...ORDER_STATUSES] },
    { key: "paymentMethod", label: "Payment", type: "select", options: [...PAYMENT_METHODS] },
    { key: "orderDate", label: "Order Date", type: "date" },
    { key: "customerId", label: "Customer ID", type: "text", isVisibleByDefault: false },
    { key: "productSku", label: "Product SKU", type: "text", isVisibleByDefault: false },
  ],
};
