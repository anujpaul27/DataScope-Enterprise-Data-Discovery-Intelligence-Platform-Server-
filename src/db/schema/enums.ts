import { pgEnum } from "drizzle-orm/pg-core";

// Data type of a dataset column. The Explorer uses this to decide which
// filter UI to show (text box, number range, date range, dropdown, toggle).
export const fieldTypeEnum = pgEnum("field_type", [
  "text",
  "number",
  "date",
  "boolean",
  "select",
]);

// How much a user can do on one dataset.
export const permissionLevelEnum = pgEnum("permission_level", [
  "read",
  "write",
  "manage",
]);
