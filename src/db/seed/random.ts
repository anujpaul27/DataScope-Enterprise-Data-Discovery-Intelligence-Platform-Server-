// Small seeded random helpers.
// Same seed => exactly the same data every time, so performance tests are
// repeatable and results can be compared between runs.

export type Rng = () => number;

// mulberry32: tiny, fast, good-enough pseudo random generator
export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Integer between min and max (both included). */
export function int(rng: Rng, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

export function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)];
}

/** Pick with weights, e.g. weighted(rng, [["Active", 50], ["Inactive", 20]]). */
export function weighted<T>(rng: Rng, items: ReadonlyArray<readonly [T, number]>): T {
  let total = 0;
  for (const [, w] of items) total += w;
  let r = rng() * total;
  for (const [value, w] of items) {
    r -= w;
    if (r < 0) return value;
  }
  return items[items.length - 1][0];
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** 2025-03-07T... -> "2025-03-07" */
export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
