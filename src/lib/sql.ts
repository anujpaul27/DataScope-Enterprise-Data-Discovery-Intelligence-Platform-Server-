/** Escapes % _ \ so user text is matched literally inside ILIKE, then wraps it as "%text%". */
export function likePattern(text: string): string {
  return `%${text.replace(/[%_\\]/g, "\\$&")}%`;
}

/** True when PostgreSQL rejected a write because of a UNIQUE constraint (code 23505). */
export function isUniqueViolation(err: unknown): boolean {
  // Drizzle wraps driver errors: the original pg error is on `.cause`.
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code === "23505" || e?.cause?.code === "23505";
}

/** "Sales & CRM 2" -> "sales-crm-2" */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}
