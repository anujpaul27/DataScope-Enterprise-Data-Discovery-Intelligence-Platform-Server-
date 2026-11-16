import { or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { badRequest } from "./http-error";
import { likePattern } from "./sql";

// ---------------------------------------------------------------------------
// Phase 5: turns the query string of GET /api/datasets/:id/records into SQL.
//
// SECURITY RULE: the browser never sends a column name that reaches SQL directly.
// Every field key is looked up in the dataset's own `dataset_fields` rows first
// (the whitelist). Only after that is the key written into the statement, and it
// must also match SAFE_KEY. Values are ALWAYS bound parameters, never concatenated.
// ---------------------------------------------------------------------------

export const MAX_PAGE_SIZE = 100;
export const MAX_OFFSET = 500_000; // deeper than this: ask the user to filter instead
export const COUNT_CAP = 1_000_000; // count(*) never scans more than this many rows
const MAX_SORTS = 3;
const MAX_FILTERS = 10;
const MAX_COLUMNS = 60;
const SAFE_KEY = /^[a-zA-Z][a-zA-Z0-9_]{0,39}$/; // same rule as dataset creation

export type FieldType = "text" | "number" | "date" | "boolean" | "select";

export interface FieldMeta {
  key: string;
  type: FieldType;
  isSearchable: boolean;
  isFilterable: boolean;
  isSortable: boolean;
}

// ---------- 1. shape of the query string ----------------------------------

export const OPERATORS = [
  "eq",
  "neq",
  "contains",
  "starts_with",
  "in",
  "gt",
  "gte",
  "lt",
  "lte",
  "between",
  "last_days",
] as const;
export type Operator = (typeof OPERATORS)[number];

const OPS_BY_TYPE: Record<FieldType, readonly Operator[]> = {
  text: ["eq", "neq", "contains", "starts_with", "in"],
  select: ["eq", "neq", "in"],
  number: ["eq", "neq", "gt", "gte", "lt", "lte", "between"],
  date: ["eq", "gt", "gte", "lt", "lte", "between", "last_days"],
  boolean: ["eq"],
};

const filterSchema = z.object({
  field: z.string().max(40),
  op: z.enum(OPERATORS),
  value: z.string().max(200),
  valueTo: z.string().max(200).optional(),
});
export type FilterInput = z.infer<typeof filterSchema>;

/** "revenue:desc,name:asc" -> [{field, direction}] (field names are checked later) */
function parseSort(raw: string | undefined): { field: string; direction: "asc" | "desc" }[] {
  if (!raw) return [];
  const parts = raw.split(",").filter(Boolean);
  if (parts.length > MAX_SORTS) throw badRequest(`You can sort by at most ${MAX_SORTS} columns`);
  return parts.map((p) => {
    const [field, dir = "asc", ...rest] = p.split(":");
    if (!field || rest.length > 0 || (dir !== "asc" && dir !== "desc")) {
      throw badRequest(`Invalid sort "${p}". Use field:asc or field:desc`);
    }
    return { field, direction: dir };
  });
}

function parseFilters(raw: string | undefined): FilterInput[] {
  if (!raw) return [];
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw badRequest("filters must be valid JSON");
  }
  const parsed = z.array(filterSchema).max(MAX_FILTERS).safeParse(json);
  if (!parsed.success) throw badRequest(`filters: up to ${MAX_FILTERS} valid conditions are allowed`);
  return parsed.data;
}

export const recordsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(25),
  q: z.string().trim().max(100).optional(),
  sort: z.string().max(200).optional(),
  filters: z.string().max(4000).optional(),
  // "name,country,revenue": only these keys are returned (smaller payload)
  columns: z.string().max(1000).optional(),
});

export interface RecordsQuery {
  page: number;
  pageSize: number;
  offset: number;
  where: SQL[]; // extra WHERE parts, AND-ed with dataset_id = ... by the route
  orderBy: SQL[];
  select: SQL; // the "data" expression
}

// ---------- 2. SQL helpers ------------------------------------------------

function assertKey(key: string): string {
  // Defence in depth: the key already came from the whitelist.
  if (!SAFE_KEY.test(key)) throw badRequest("Invalid field name");
  return key;
}

/** (data->>'revenue'): raw text of one field. Written as a literal on purpose so
 *  expression indexes added in Phase 6 can match this exact expression. */
const textExpr = (key: string) => sql.raw(`(dataset_records.data->>'${assertKey(key)}')`);

/** Same field, typed for comparisons and sorting. */
function typedExpr(f: FieldMeta): SQL {
  const base = `dataset_records.data->>'${assertKey(f.key)}'`;
  if (f.type === "number") return sql.raw(`((${base})::numeric)`);
  if (f.type === "boolean") return sql.raw(`((${base})::boolean)`);
  return sql.raw(`(${base})`); // text / select / date (ISO dates sort correctly as text)
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function parseValue(f: FieldMeta, raw: string): string | number | boolean {
  if (f.type === "number") {
    const n = Number(raw);
    if (raw.trim() === "" || !Number.isFinite(n)) {
      throw badRequest(`"${raw}" is not a number (field ${f.key})`);
    }
    return n;
  }
  if (f.type === "date") {
    if (!ISO_DATE.test(raw) || Number.isNaN(Date.parse(raw))) {
      throw badRequest(`"${raw}" is not a date, use YYYY-MM-DD (field ${f.key})`);
    }
    return raw;
  }
  if (f.type === "boolean") {
    if (raw !== "true" && raw !== "false") throw badRequest(`${f.key} must be true or false`);
    return raw === "true";
  }
  return raw;
}

function daysAgoIso(days: number, now: Date): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
}

function buildFilter(f: FieldMeta, c: FilterInput, now: Date): SQL {
  if (!OPS_BY_TYPE[f.type].includes(c.op)) {
    throw badRequest(`Operator "${c.op}" cannot be used on ${f.type} field "${f.key}"`);
  }
  const col = typedExpr(f);

  switch (c.op) {
    case "eq":
      return sql`${col} = ${parseValue(f, c.value)}`;
    case "neq":
      // IS DISTINCT FROM keeps rows where the field is missing (plain <> would drop NULLs)
      return sql`${col} is distinct from ${parseValue(f, c.value)}`;
    case "contains":
      return sql`${textExpr(f.key)} ilike ${likePattern(c.value)}`;
    case "starts_with":
      return sql`${textExpr(f.key)} ilike ${likePattern(c.value).slice(1)}`; // "text%"
    case "in": {
      const values = c.value
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean);
      if (values.length === 0 || values.length > 50) throw badRequest(`"in" needs 1 to 50 values`);
      return sql`${col} in (${sql.join(
        values.map((v) => sql`${v}`),
        sql`, `,
      )})`;
    }
    case "gt":
      return sql`${col} > ${parseValue(f, c.value)}`;
    case "gte":
      return sql`${col} >= ${parseValue(f, c.value)}`;
    case "lt":
      return sql`${col} < ${parseValue(f, c.value)}`;
    case "lte":
      return sql`${col} <= ${parseValue(f, c.value)}`;
    case "between": {
      if (c.valueTo === undefined) throw badRequest(`"between" needs valueTo`);
      return sql`${col} between ${parseValue(f, c.value)} and ${parseValue(f, c.valueTo)}`;
    }
    case "last_days": {
      const days = Number(c.value);
      if (!Number.isInteger(days) || days < 1 || days > 3650) {
        throw badRequest("last_days must be a whole number between 1 and 3650");
      }
      return sql`${col} >= ${daysAgoIso(days, now)}`;
    }
  }
}

// ---------- 3. main entry: query string + fields -> SQL parts --------------

export function buildRecordsQuery(
  rawQuery: unknown,
  fields: FieldMeta[],
  now: Date = new Date(),
): RecordsQuery {
  const q = recordsQuerySchema.parse(rawQuery);
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const offset = (q.page - 1) * q.pageSize;
  if (offset > MAX_OFFSET) {
    throw badRequest("That page is too deep. Narrow the results with search or filters.");
  }

  const where: SQL[] = [];

  // Global search: ILIKE over every searchable text-like field (OR).
  if (q.q) {
    const like = likePattern(q.q);
    const searchable = fields.filter(
      (f) => f.isSearchable && (f.type === "text" || f.type === "select"),
    );
    if (searchable.length === 0) throw badRequest("This dataset has no searchable fields");
    const any = or(...searchable.map((f) => sql`${textExpr(f.key)} ilike ${like}`));
    if (any) where.push(any);
  }

  // Field filters (AND).
  for (const c of parseFilters(q.filters)) {
    const f = byKey.get(c.field);
    if (!f || !f.isFilterable) throw badRequest(`Unknown or non-filterable field "${c.field}"`);
    where.push(buildFilter(f, c, now));
  }

  // Multi-column sort + a stable tie-breaker so pages never overlap or skip rows.
  const orderBy: SQL[] = [];
  const seen = new Set<string>();
  for (const s of parseSort(q.sort)) {
    const f = byKey.get(s.field);
    if (!f || !f.isSortable) throw badRequest(`Unknown or non-sortable field "${s.field}"`);
    if (seen.has(s.field)) throw badRequest(`Field "${s.field}" is sorted twice`);
    seen.add(s.field);
    orderBy.push(sql`${typedExpr(f)} ${sql.raw(s.direction)} nulls last`);
  }
  orderBy.push(sql`dataset_records.id asc`);

  // Column projection: only the visible columns travel over the network.
  let select: SQL = sql`dataset_records.data`;
  if (q.columns !== undefined) {
    const keys = [...new Set(q.columns.split(",").map((k) => k.trim()).filter(Boolean))];
    if (keys.length > MAX_COLUMNS) throw badRequest("Too many columns");
    for (const k of keys) if (!byKey.has(k)) throw badRequest(`Unknown column "${k}"`);
    select =
      keys.length === 0
        ? sql`'{}'::jsonb`
        : sql`jsonb_build_object(${sql.join(
            keys.map((k) => {
              const safe = assertKey(k);
              return sql`${sql.raw(`'${safe}'`)}, dataset_records.data->${sql.raw(`'${safe}'`)}`;
            }),
            sql`, `,
          )})`;
  }

  return { page: q.page, pageSize: q.pageSize, offset, where, orderBy, select };
}
