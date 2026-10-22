// Private to the example package: reachable only through ../index.ts.
export function slugWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 0);
}
