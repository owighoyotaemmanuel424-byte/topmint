// Helpers for turning untrusted query strings into validated values.
//
// Next.js hands `req.query` values as strings, or as arrays when a key appears
// more than once (`?page=1&page=2`). Nothing from that object is trusted: every
// value is flattened, type-checked and bounded before it reaches Prisma.

export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// Repeated keys collapse to their first value so `?type=A&type=B` cannot produce
// an array that later reaches a Prisma `where` clause.
export function flattenQuery(raw) {
  const flat = {};
  if (!raw || typeof raw !== 'object') return flat;
  for (const [key, value] of Object.entries(raw)) {
    if (Array.isArray(value)) {
      if (value.length) flat[key] = value[0];
    } else if (value !== undefined && value !== null) {
      flat[key] = value;
    }
  }
  return flat;
}

// Returns the fallback when the parameter was absent. Returns null when it was
// present but not a whole number within range, so the caller can answer 400
// instead of silently clamping to something the customer did not ask for.
export function positiveInt(value, { fallback, max }) {
  if (value === undefined || value === '') return fallback;
  const text = String(value);
  if (!/^\d+$/.test(text)) return null;
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > max) return null;
  return parsed;
}

/**
 * Parse a `YYYY-MM-DD` query value into a UTC Date.
 *
 * `end` selects the inclusive end of the day, so a `to=2026-03-01` filter
 * includes anything recorded during 1 March rather than stopping at midnight.
 * Impossible calendar dates (2026-02-31) are rejected instead of being rolled
 * forward by `Date`.
 *
 * @returns {Date|null} null when the value is not a real calendar date.
 */
export function parseDay(value, { end = false } = {}) {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  if (date.toISOString().slice(0, 10) !== value) return null;
  if (end) date.setUTCHours(23, 59, 59, 999);
  return date;
}
