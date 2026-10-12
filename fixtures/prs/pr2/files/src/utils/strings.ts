export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function capitalize(input: string): string {
  if (input.length === 0) return input;
  return input[0].toUpperCase() + input.slice(1);
}

/** Shortens `input` so it is at most `max` characters, adding an ellipsis. */
export function truncate(input: string, max: number): string {
  if (input.length <= max) return input;
  return input.slice(0, max) + "…";
}

export function isBlank(input: string | null | undefined): boolean {
  return input === null || input === undefined || input.trim().length === 0;
}

/** Lowercases, trims and collapses internal whitespace so search queries compare consistently. */
export function normalizeQuery(input: string): string {
  return input.trim().toLowerCase().replace(/\s+/g, " ");
}
