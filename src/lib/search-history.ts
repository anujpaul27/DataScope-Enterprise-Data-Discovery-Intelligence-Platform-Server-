import { db } from "../db";
import { searchHistory } from "../db/schema";
import type { FilterInput } from "./records-query";

// ---------------------------------------------------------------------------
// Phase 6: remember what people searched for (PDF section 8 + analytics in section 9).
//
// Rules, so the table stays useful and small:
//   * only a REAL search is stored: a text search or at least one filter
//   * only page 1 (turning pages is not a new search)
//   * the same search by the same user within 60 s is stored once (tab focus refetches,
//     the "next page" prefetch and quick re-typing would otherwise flood the table)
//   * it never slows the response down: it runs after res.json() and errors are only logged
// ---------------------------------------------------------------------------

interface SearchRecord {
  userId: string;
  datasetId: string;
  page: number;
  q: string | undefined;
  filters: FilterInput[];
  sort: { field: string; direction: "asc" | "desc" }[];
  resultCount: number;
  durationMs: number;
}

const DEDUPE_MS = 60_000;
const MAX_TRACKED = 5_000;
const lastSeen = new Map<string, number>();

export function recordSearch(input: SearchRecord): void {
  const isRealSearch = Boolean(input.q) || input.filters.length > 0;
  if (!isRealSearch || input.page !== 1) return;

  const key = `${input.userId}|${input.datasetId}|${JSON.stringify([input.q ?? "", input.filters, input.sort])}`;
  const now = Date.now();
  const previous = lastSeen.get(key);
  if (previous !== undefined && now - previous < DEDUPE_MS) return;

  lastSeen.set(key, now);
  if (lastSeen.size > MAX_TRACKED) {
    for (const [k, t] of lastSeen) if (now - t >= DEDUPE_MS) lastSeen.delete(k);
  }

  void (async () => {
    try {
      await db.insert(searchHistory).values({
        userId: input.userId,
        datasetId: input.datasetId,
        globalSearch: input.q ?? null,
        conditions: input.filters,
        sort: input.sort,
        resultCount: input.resultCount,
        durationMs: input.durationMs,
      });
    } catch (err) {
      console.error("Could not save search history:", err);
    }
  })();
}
