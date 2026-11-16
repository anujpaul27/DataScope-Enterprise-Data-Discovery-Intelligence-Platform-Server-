import fs from "node:fs";
import path from "node:path";
import { and, asc, eq, sql, type SQL } from "drizzle-orm";
import { db, pool } from "./index";
import { datasetFields, datasetRecords, datasets } from "./schema";
import { buildRecordsQuery, type FieldMeta } from "../lib/records-query";

// ---------------------------------------------------------------------------
// Search benchmark (PDF section 14: "submit measurable results").
//
//   npm run db:bench                        -> dataset "customers", 5 runs per case
//   npm run db:bench -- --dataset=orders --runs=9
//
// It runs the SAME SQL the API runs (it calls buildRecordsQuery), inside
// EXPLAIN (ANALYZE, BUFFERS), twice:
//   "indexes"    = PostgreSQL free to use all indexes
//   "no indexes" = index and bitmap scans switched off for that one transaction (SET LOCAL),
//                  i.e. what the query would cost without the Phase 6 indexes
// and compares the three search approaches of the PDF on the `name` field.
// The result is printed AND saved in bench-results/ so you can paste it in the report.
// ---------------------------------------------------------------------------

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? (hit.split("=")[1] ?? fallback) : fallback;
}
const SLUG = arg("dataset", "customers");
const RUNS = Math.max(3, Number(arg("runs", "5")) || 5);
const KEEP_FTS = process.argv.includes("--keep-fts");

type PlanNode = {
  "Node Type": string;
  "Index Name"?: string;
  Plans?: PlanNode[];
};
type ExplainRoot = { Plan: PlanNode; "Planning Time": number; "Execution Time": number };

function collect(node: PlanNode, types: Set<string>, indexes: Set<string>): void {
  types.add(node["Node Type"]);
  if (node["Index Name"]) indexes.add(node["Index Name"]);
  for (const child of node.Plans ?? []) collect(child, types, indexes);
}

async function runExplain(statement: SQL, useIndexes: boolean): Promise<ExplainRoot> {
  return db.transaction(async (tx) => {
    if (!useIndexes) {
      await tx.execute(sql`set local enable_bitmapscan = off`);
      await tx.execute(sql`set local enable_indexscan = off`);
      await tx.execute(sql`set local enable_indexonlyscan = off`);
    }
    const res = await tx.execute<{ "QUERY PLAN": ExplainRoot[] }>(
      sql`explain (analyze, buffers, format json) ${statement}`,
    );
    const root = res.rows[0]?.["QUERY PLAN"]?.[0];
    if (!root) throw new Error("EXPLAIN returned no plan");
    return root;
  });
}

interface Measure {
  medianMs: number;
  minMs: number;
  maxMs: number;
  nodes: string;
  indexes: string;
}

async function measure(statement: SQL, useIndexes: boolean): Promise<Measure> {
  await runExplain(statement, useIndexes); // warm-up run (fills the cache), not counted
  const times: number[] = [];
  const types = new Set<string>();
  const indexes = new Set<string>();
  for (let i = 0; i < RUNS; i++) {
    const root = await runExplain(statement, useIndexes);
    times.push(root["Execution Time"]);
    collect(root.Plan, types, indexes);
  }
  times.sort((a, b) => a - b);
  return {
    medianMs: times[Math.floor(times.length / 2)] ?? 0,
    minMs: times[0] ?? 0,
    maxMs: times[times.length - 1] ?? 0,
    nodes: [...types].filter((t) => /Scan|Sort|Limit|Aggregate/.test(t)).join(" > "),
    indexes: [...indexes].join(", ") || "-",
  };
}

const fmt = (n: number) => (n < 10 ? n.toFixed(2) : n < 100 ? n.toFixed(1) : Math.round(n).toString());

async function main() {
  const [ds] = await db.select().from(datasets).where(eq(datasets.slug, SLUG)).limit(1);
  if (!ds) throw new Error(`No dataset with slug "${SLUG}". Run npm run db:seed first.`);

  const fields: FieldMeta[] = await db
    .select({
      key: datasetFields.key,
      type: datasetFields.type,
      isSearchable: datasetFields.isSearchable,
      isFilterable: datasetFields.isFilterable,
      isSortable: datasetFields.isSortable,
    })
    .from(datasetFields)
    .where(eq(datasetFields.datasetId, ds.id))
    .orderBy(asc(datasetFields.position));

  const rowCount = (
    await db.execute<{ n: number }>(
      sql`select count(*)::int as n from dataset_records where dataset_id = ${ds.id}`,
    )
  ).rows[0]?.n ?? 0;
  const version = (await db.execute<{ v: string }>(sql`select version() as v`)).rows[0]?.v ?? "?";
  const indexRows = (
    await db.execute<{ indexname: string; size: string }>(sql`
      select indexname, pg_size_pretty(pg_relation_size(('public.' || indexname)::regclass)) as size
      from pg_indexes where tablename = 'dataset_records' order by indexname
    `)
  ).rows;

  // A real name from the data, so the search terms always find something.
  const sample = (
    await db.execute<{ name: string | null }>(sql`
      select data->>'name' as name from dataset_records
      where dataset_id = ${ds.id} and data->>'name' is not null
      offset 500 limit 1
    `)
  ).rows[0]?.name;
  const word = (sample ?? "anna").split(/\s+/)[0] ?? "anna";
  const term = word.replace(/[^A-Za-z]/g, "").slice(0, 5).toLowerCase() || "ann";
  const infix = term.length >= 4 ? term.slice(1, 4) : term;

  console.log(`Dataset "${ds.name}": ${rowCount.toLocaleString("en-US")} records, ${RUNS} timed runs per case`);
  console.log(`Search terms: "${term}" (word start) and "${infix}" (inside a word)\n`);

  // ----- Part 1: the real API queries --------------------------------------
  const scenarios: { name: string; query: Record<string, string> }[] = [
    { name: "Page 1, no search (default order)", query: { page: "1", pageSize: "25" } },
    { name: `Global search "${term}"`, query: { q: term } },
    { name: `Global search "${infix}" (3 letters, inside words)`, query: { q: infix } },
    {
      name: "Filter status = Active",
      query: { filters: JSON.stringify([{ field: "status", op: "eq", value: "Active" }]) },
    },
    {
      name: "Combined: Active + Germany + revenue > 10000 + last 365 days",
      query: {
        filters: JSON.stringify([
          { field: "status", op: "eq", value: "Active" },
          { field: "country", op: "eq", value: "Germany" },
          { field: "revenue", op: "gt", value: "10000" },
          { field: "signupDate", op: "last_days", value: "365" },
        ]),
      },
    },
    { name: "Sort revenue desc, page 1", query: { sort: "revenue:desc" } },
    { name: "Sort revenue asc, page 1", query: { sort: "revenue:asc" } },
    { name: "Sort revenue desc, page 200 (offset 4,975)", query: { sort: "revenue:desc", page: "200" } },
  ];

  const lines: string[] = [];
  const pageTable: string[] = [];
  const countTable: string[] = [];
  pageTable.push("| Case | with indexes (ms) | no indexes (ms) | speed-up | index used |");
  pageTable.push("|---|---:|---:|---:|---|");
  countTable.push("| Case | count with indexes (ms) | count no indexes (ms) |");
  countTable.push("|---|---:|---:|");

  for (const sc of scenarios) {
    let built;
    try {
      built = buildRecordsQuery({ pageSize: "25", ...sc.query }, fields);
    } catch (err) {
      pageTable.push(`| ${sc.name} | skipped (${(err as Error).message}) | | | |`);
      continue;
    }
    const where = and(eq(datasetRecords.datasetId, ds.id), ...built.where)!;
    const order = sql.join(built.orderBy, sql`, `);
    const pageSql = sql`
      select dataset_records.id, ${built.select} as data
      from dataset_records where ${where}
      order by ${order} limit ${built.pageSize} offset ${built.offset}`;
    const countSql = sql`
      select count(*) from (select 1 from dataset_records where ${where} limit 1000001) capped`;

    const withIdx = await measure(pageSql, true);
    const noIdx = await measure(pageSql, false);
    const cWith = await measure(countSql, true);
    const cNo = await measure(countSql, false);
    const speedUp = noIdx.medianMs / Math.max(withIdx.medianMs, 0.001);
    pageTable.push(
      `| ${sc.name} | ${fmt(withIdx.medianMs)} | ${fmt(noIdx.medianMs)} | ${speedUp.toFixed(1)}x | ${withIdx.indexes} |`,
    );
    countTable.push(`| ${sc.name} | ${fmt(cWith.medianMs)} | ${fmt(cNo.medianMs)} |`);
    console.log(`${sc.name}: ${fmt(withIdx.medianMs)} ms with indexes (${withIdx.nodes}), ${fmt(noIdx.medianMs)} ms without`);
  }

  // ----- Part 2: the three search approaches on ONE field ------------------
  const approachTable: string[] = [];
  approachTable.push("| Approach | Query | rows found | median (ms) | plan |");
  approachTable.push("|---|---|---:|---:|---|");

  await db.execute(
    sql`create index if not exists bench_fts_name_idx on dataset_records using gin (to_tsvector('simple', coalesce(data->>'name','')))`,
  );
  await db.execute(sql`analyze dataset_records`);

  const nameExpr = sql.raw(`(dataset_records.data->>'name')`);
  const ftsExpr = sql.raw(`to_tsvector('simple', coalesce(dataset_records.data->>'name',''))`);
  const approaches: { label: string; query: string; cond: SQL; indexes: boolean }[] = [
    { label: "Trigram (ILIKE + GIN)", query: `name ILIKE '%${term}%'`, cond: sql`${nameExpr} ilike ${`%${term}%`}`, indexes: true },
    { label: "Trigram (ILIKE + GIN)", query: `name ILIKE '%${infix}%'`, cond: sql`${nameExpr} ilike ${`%${infix}%`}`, indexes: true },
    { label: "Full-text (tsvector + GIN)", query: `to_tsquery('${term}:*')  (word start)`, cond: sql`${ftsExpr} @@ to_tsquery('simple', ${term + ":*"})`, indexes: true },
    { label: "Full-text (tsvector + GIN)", query: `to_tsquery('${infix}:*')  (inside a word)`, cond: sql`${ftsExpr} @@ to_tsquery('simple', ${infix + ":*"})`, indexes: true },
    { label: "No index (sequential scan)", query: `name ILIKE '%${term}%'`, cond: sql`${nameExpr} ilike ${`%${term}%`}`, indexes: false },
  ];
  for (const a of approaches) {
    const selectRows = sql`select count(*)::int as n from dataset_records where dataset_id = ${ds.id} and ${a.cond}`;
    const found = (await db.execute<{ n: number }>(selectRows)).rows[0]?.n ?? 0;
    const m = await measure(
      sql`select id from dataset_records where dataset_id = ${ds.id} and ${a.cond} order by id limit 25`,
      a.indexes,
    );
    approachTable.push(`| ${a.label} | \`${a.query}\` | ${found.toLocaleString("en-US")} | ${fmt(m.medianMs)} | ${m.nodes} |`);
  }
  if (!KEEP_FTS) await db.execute(sql`drop index if exists bench_fts_name_idx`);

  // ----- report ---------------------------------------------------------------
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  lines.push(`# Search benchmark: ${ds.name}`);
  lines.push("");
  lines.push(`- Date: ${new Date().toISOString()}`);
  lines.push(`- Records in this dataset: ${rowCount.toLocaleString("en-US")}`);
  lines.push(`- Timed runs per case: ${RUNS} (median reported, one warm-up run discarded)`);
  lines.push(`- PostgreSQL: ${version}`);
  lines.push(`- Node.js: ${process.version}`);
  lines.push(`- Measured with EXPLAIN (ANALYZE): execution time inside PostgreSQL, without network or JSON time.`);
  lines.push(`- "no indexes" = enable_indexscan / enable_bitmapscan / enable_indexonlyscan off (SET LOCAL).`);
  lines.push("");
  lines.push("## Page query (the rows shown in the table)");
  lines.push("");
  lines.push(...pageTable);
  lines.push("");
  lines.push("## Capped count query (the total shown under the table)");
  lines.push("");
  lines.push(...countTable);
  lines.push("");
  lines.push(`## Search approaches on the "name" field`);
  lines.push("");
  lines.push(...approachTable);
  lines.push("");
  lines.push("## Index sizes (dataset_records)");
  lines.push("");
  lines.push("| Index | Size |");
  lines.push("|---|---:|");
  for (const r of indexRows) lines.push(`| ${r.indexname} | ${r.size} |`);
  lines.push("");

  const dir = path.join(process.cwd(), "bench-results");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `search-bench-${SLUG}-${stamp}.md`);
  fs.writeFileSync(file, lines.join("\n"));
  console.log(`\n${lines.join("\n")}\n\nSaved: ${file}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
