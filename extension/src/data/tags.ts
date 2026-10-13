/**
 * Project tags, managed like GitHub labels. Azure DevOps tags (pull request labels) have only a name,
 * so the color and description live with the extension, keyed by the lowercased name (tags are
 * case-insensitive in Azure DevOps).
 */
export interface TagDef {
  name: string;
  /** "#rrggbb" */
  color: string;
  description: string;
}

/** What's stored per tag, keyed by tagKey(name). `name` keeps the spelling. */
export type TagStyles = Record<string, { name?: string; color: string; description?: string }>;

/** Reads, creates, edits and deletes this project's tags. */
export interface TagStore {
  list(): Promise<TagDef[]>;
  /** Creates the tag (previous null) or updates it; a new name renames it everywhere it's used. */
  save(previous: string | null, tag: TagDef): Promise<void>;
  /** Removes the tag from every pull request (and, in Azure DevOps, every work item) in the project. */
  remove(name: string): Promise<void>;
}

/** GitHub's default label colors. */
export const TAG_COLORS = [
  "#b60205", "#d93f0b", "#fbca04", "#0e8a16", "#006b75", "#1d76db", "#0052cc", "#5319e7",
  "#e99695", "#f9d0c4", "#fef2c0", "#c2e0c6", "#bfdadc", "#c5def5", "#bfd4f2", "#d4c5f9",
];

export const tagKey = (name: string) => name.trim().toLowerCase();

/** A stable color for a tag nobody has colored yet. */
export function defaultTagColor(name: string): string {
  let hash = 0;
  for (const ch of tagKey(name)) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return TAG_COLORS[Math.abs(hash) % TAG_COLORS.length];
}

export function randomTagColor(): string {
  return TAG_COLORS[Math.floor(Math.random() * TAG_COLORS.length)];
}

/** "#abc" or "#aabbcc", normalized to "#aabbcc"; null otherwise. */
export function parseColor(input: string): string | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(input.trim());
  if (!m) return null;
  const hex = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
  return `#${hex.toLowerCase()}`;
}

/** Black or white, whichever reads better on the tag's color. */
export function tagTextColor(color: string): string {
  const hex = parseColor(color) ?? "#808080";
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lum = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const l = 0.2126 * lum(r) + 0.7152 * lum(g) + 0.0722 * lum(b);
  return l > 0.4 ? "#1f2328" : "#ffffff";
}

/**
 * A tag's pill colors. Light themes get the solid color; dark themes get GitHub's dark-mode label:
 * an 18% tint of the color, and text and border lightened until they read on a dark background.
 */
export function tagPillStyle(color: string, dark: boolean): { background: string; color: string; borderColor: string } {
  const hex = parseColor(color) ?? "#808080";
  if (!dark) return { background: hex, color: tagTextColor(hex), borderColor: "rgba(0, 0, 0, 0.12)" };
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const [h, s, l] = toHsl(r, g, b);
  const perceived = (r * 0.2126 + g * 0.7152 + b * 0.0722) / 255;
  const light = l + Math.max(0, 0.6 - perceived) * 100;
  return {
    background: `rgba(${r}, ${g}, ${b}, 0.18)`,
    color: `hsl(${h}, ${s}%, ${light}%)`,
    borderColor: `hsla(${h}, ${s}%, ${light}%, 0.3)`,
  };
}

/** [hue in degrees, saturation %, lightness %] */
function toHsl(r: number, g: number, b: number): [number, number, number] {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (!d) return [0, 0, Math.round(l * 100)];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === rn ? ((gn - bn) / d) % 6 : max === gn ? (bn - rn) / d + 2 : (rn - gn) / d + 4;
  return [Math.round((h * 60 + 360) % 360), Math.round(s * 100), Math.round(l * 100)];
}

/**
 * Every tag the project knows: Azure DevOps' tag names, styled tags (created here but not used yet),
 * and labels seen on pull requests. Sorted by name; the first spelling of a name wins.
 */
export function mergeTags(names: Iterable<string>, styles: TagStyles): TagDef[] {
  const byKey = new Map<string, TagDef>();
  const add = (name: string, style = styles[tagKey(name)]) => {
    const key = tagKey(name);
    if (!key || byKey.has(key)) return;
    byKey.set(key, { name: name.trim(), color: parseColor(style?.color ?? "") ?? defaultTagColor(name), description: style?.description ?? "" });
  };
  for (const name of names) add(name);
  for (const [key, style] of Object.entries(styles)) add(style.name ?? key, style);
  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

/** The stored styles after creating, editing or renaming `tag`. */
export function withTag(styles: TagStyles, previous: string | null, tag: TagDef): TagStyles {
  const next = { ...styles };
  if (previous) delete next[tagKey(previous)];
  next[tagKey(tag.name)] = { name: tag.name.trim(), color: parseColor(tag.color) ?? defaultTagColor(tag.name), description: tag.description.trim() };
  return next;
}

export function withoutTag(styles: TagStyles, name: string): TagStyles {
  const next = { ...styles };
  delete next[tagKey(name)];
  return next;
}

/** Why `name` can't be used for a tag (other than `previous`), or null. */
export function tagNameError(name: string, tags: TagDef[], previous: string | null): string | null {
  const key = tagKey(name);
  if (!key) return "Enter a name.";
  if (name.length > 100) return "Names are at most 100 characters.";
  if (/[,;]/.test(name)) return "Names can't contain commas or semicolons.";
  if (key !== tagKey(previous ?? "") && tags.some((t) => tagKey(t.name) === key)) return "A tag with this name already exists.";
  return null;
}
