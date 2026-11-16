// Word lists and option values used by the generators.
// The same constants feed dataset_fields.options, so filters and data never disagree.

export const FIRST_NAMES = [
  "Aisha", "Liam", "Noah", "Emma", "Olivia", "Mohammed", "Sofia", "Lucas",
  "Hana", "Arjun", "Priya", "Chen", "Mei", "Yuki", "Carlos", "Maria",
  "Ahmed", "Fatima", "Ivan", "Elena", "Jonas", "Lena", "Pierre", "Chloe",
  "Omar", "Layla", "Rahul", "Anika", "Tariq", "Nadia", "Sven", "Ingrid",
  "David", "Sarah", "Daniel", "Grace", "Kofi", "Amara", "Mateo", "Valentina",
] as const;

export const LAST_NAMES = [
  "Khan", "Smith", "Müller", "Garcia", "Rossi", "Silva", "Kim", "Nguyen",
  "Patel", "Hossain", "Rahman", "Ivanov", "Dubois", "Schmidt", "Fischer",
  "Weber", "Tanaka", "Sato", "Wang", "Li", "Brown", "Johnson", "Martin",
  "Lopez", "Hernandez", "Costa", "Ali", "Ahmed", "Das", "Roy",
  "Andersson", "Nielsen", "Kowalski", "Novak", "Popescu", "Okafor", "Mensah",
  "Cohen", "Haddad", "Singh",
] as const;

export const COMPANY_PREFIX = [
  "Nova", "Apex", "Blue", "Quantum", "Summit", "Vertex", "Pioneer", "Orbit",
  "Nimbus", "Atlas", "Helix", "Zenith", "Cobalt", "Ember", "Lumen", "Prime",
] as const;

export const COMPANY_SUFFIX = [
  "Systems", "Labs", "Logistics", "Industries", "Solutions", "Foods",
  "Retail", "Dynamics", "Partners", "Group", "Networks", "Trading",
] as const;

export const EMAIL_DOMAINS = [
  "example.com", "mail.example.org", "corp.example.net", "demo.example.io",
] as const;

// country -> cities
export const COUNTRIES: ReadonlyArray<readonly [string, number, readonly string[]]> = [
  ["United States", 22, ["New York", "Austin", "Chicago", "San Francisco", "Seattle"]],
  ["Germany", 12, ["Berlin", "Munich", "Hamburg", "Frankfurt"]],
  ["United Kingdom", 10, ["London", "Manchester", "Bristol", "Leeds"]],
  ["India", 10, ["Mumbai", "Bengaluru", "Delhi", "Pune"]],
  ["Bangladesh", 6, ["Dhaka", "Chattogram", "Khulna", "Sylhet"]],
  ["France", 7, ["Paris", "Lyon", "Marseille", "Toulouse"]],
  ["Canada", 6, ["Toronto", "Vancouver", "Montreal", "Calgary"]],
  ["Australia", 5, ["Sydney", "Melbourne", "Brisbane", "Perth"]],
  ["Japan", 5, ["Tokyo", "Osaka", "Kyoto", "Nagoya"]],
  ["Brazil", 5, ["Sao Paulo", "Rio de Janeiro", "Brasilia", "Salvador"]],
  ["Netherlands", 4, ["Amsterdam", "Rotterdam", "Utrecht"]],
  ["Singapore", 3, ["Singapore"]],
  ["United Arab Emirates", 3, ["Dubai", "Abu Dhabi"]],
  ["South Africa", 2, ["Johannesburg", "Cape Town"]],
];

export const COUNTRY_NAMES: string[] = COUNTRIES.map(([name]) => name);

// ---- Customers --------------------------------------------------------------
export const CUSTOMER_STATUSES = ["Active", "Inactive", "Pending", "Suspended"] as const;
export const CUSTOMER_STATUS_WEIGHTS: ReadonlyArray<readonly [string, number]> = [
  ["Active", 52],
  ["Inactive", 25],
  ["Pending", 15],
  ["Suspended", 8],
];

export const PLANS = ["Free", "Pro", "Business", "Enterprise"] as const;
export const PLAN_WEIGHTS: ReadonlyArray<readonly [string, number]> = [
  ["Free", 40],
  ["Pro", 35],
  ["Business", 18],
  ["Enterprise", 7],
];
// Revenue is multiplied by this so bigger plans earn more (more realistic data).
export const PLAN_REVENUE_MULTIPLIER: Record<string, number> = {
  Free: 0.1,
  Pro: 0.8,
  Business: 1.5,
  Enterprise: 4,
};

// ---- Products ---------------------------------------------------------------
export const PRODUCT_CATEGORIES: Record<string, readonly string[]> = {
  Electronics: ["Speaker", "Headphones", "Monitor", "Keyboard", "Webcam", "Charger"],
  "Home & Kitchen": ["Blender", "Kettle", "Cookware Set", "Air Fryer", "Lamp", "Vacuum"],
  Fashion: ["Jacket", "Sneakers", "Backpack", "Watch", "Sunglasses", "Scarf"],
  Books: ["Notebook", "Planner", "Cookbook", "Atlas", "Journal"],
  Sports: ["Yoga Mat", "Dumbbell Set", "Water Bottle", "Tent", "Bicycle Helmet"],
  Beauty: ["Face Cream", "Perfume", "Hair Dryer", "Shaving Kit", "Lip Balm"],
  Toys: ["Puzzle", "Building Blocks", "Board Game", "RC Car", "Doll House"],
  Office: ["Desk Chair", "Standing Desk", "Stapler", "Whiteboard", "Desk Organizer"],
};
export const CATEGORY_NAMES = Object.keys(PRODUCT_CATEGORIES);

export const PRODUCT_ADJECTIVES = [
  "Premium", "Compact", "Classic", "Smart", "Eco", "Pro", "Ultra", "Essential",
  "Deluxe", "Portable", "Modern", "Heritage",
] as const;

export const BRANDS = [
  "Aurora", "Kestrel", "Meridian", "Solace", "Tandem", "Veloce", "Wren", "Yonder",
] as const;

export const PRODUCT_STATUSES = ["Available", "Out of Stock", "Discontinued"] as const;
export const PRODUCT_STATUS_WEIGHTS: ReadonlyArray<readonly [string, number]> = [
  ["Available", 80],
  ["Out of Stock", 12],
  ["Discontinued", 8],
];

// ---- Orders -----------------------------------------------------------------
export const ORDER_STATUSES = [
  "Pending", "Paid", "Shipped", "Delivered", "Cancelled", "Refunded",
] as const;
export const ORDER_STATUS_WEIGHTS: ReadonlyArray<readonly [string, number]> = [
  ["Pending", 8],
  ["Paid", 14],
  ["Shipped", 14],
  ["Delivered", 52],
  ["Cancelled", 8],
  ["Refunded", 4],
];

export const PAYMENT_METHODS = ["Credit Card", "PayPal", "Bank Transfer", "Cash on Delivery"] as const;
export const PAYMENT_WEIGHTS: ReadonlyArray<readonly [string, number]> = [
  ["Credit Card", 50],
  ["PayPal", 25],
  ["Bank Transfer", 15],
  ["Cash on Delivery", 10],
];
