import type { DatasetField } from "@/features/datasets/types";
import { serializeFilters, toFilterPayload, type FilterPayload } from "@/features/explorer/lib/filters";
import { serializeSort } from "@/features/explorer/lib/sort";
import type { SearchCondition, SortRule } from "@/store/slices/searchConfigSlice";
import type { SavedView, SavedViewConfig } from "../types";

/** Columns a view stores: [] when the user is simply on the dataset defaults. */
export function columnsToSave(visibleKeys: string[], fields: DatasetField[]): string[] {
  const defaults = fields.filter((f) => f.isVisibleByDefault).map((f) => f.key);
  return sameList(visibleKeys, defaults) ? [] : visibleKeys;
}

/** What the Explorer is showing right now, in the shape the API stores. */
export function currentConfig(args: {
  q: string;
  filters: SearchCondition[];
  sort: SortRule[];
  visibleKeys: string[];
  fields: DatasetField[];
}): SavedViewConfig {
  return {
    globalSearch: args.q.trim() || null,
    conditions: toFilterPayload(args.filters),
    sort: args.sort,
    visibleColumns: columnsToSave(args.visibleKeys, args.fields),
  };
}

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

// jsonb does not keep key order, so conditions from the server are compared field by field.
const filterKey = (c: FilterPayload) => [c.field, c.op, c.value, c.valueTo ?? ""].join("\u0001");

/** True when the Explorer shows exactly what the saved view describes (ignoring paging). */
export function isSameConfig(view: SavedViewConfig, now: SavedViewConfig, fields: DatasetField[]): boolean {
  // a view saved with [] means "default columns": compare in the same normalised form
  const viewColumns = columnsToSave(
    fields.filter((f) => view.visibleColumns.length === 0 ? f.isVisibleByDefault : view.visibleColumns.includes(f.key)).map((f) => f.key),
    fields,
  );
  return (
    (view.globalSearch ?? "") === (now.globalSearch ?? "") &&
    sameList(view.conditions.map(filterKey), now.conditions.map(filterKey)) &&
    sameList(view.sort.map((s) => `${s.field}:${s.direction}`), now.sort.map((s) => `${s.field}:${s.direction}`)) &&
    sameList(viewColumns, now.visibleColumns)
  );
}

/** URL parameters (q / filters / sort) that reproduce the view in the Explorer. */
export function viewToUrlState(view: SavedView): { q: string; filters: string; sort: string } {
  return {
    q: view.globalSearch ?? "",
    filters: serializeFilters(
      view.conditions.map((c, i) => ({
        id: `view-${i}`,
        field: c.field,
        operator: c.op,
        value: c.value,
        valueTo: c.valueTo,
      })),
    ),
    sort: serializeSort(view.sort),
  };
}

/** Columns to apply for a view: its own list (only keys that still exist), or the defaults. */
export function viewColumns(view: SavedViewConfig, fields: DatasetField[]): string[] {
  const keys = new Set(fields.map((f) => f.key));
  const own = view.visibleColumns.filter((k) => keys.has(k));
  if (own.length > 0) return fields.filter((f) => own.includes(f.key)).map((f) => f.key);
  return fields.filter((f) => f.isVisibleByDefault).map((f) => f.key);
}
