// Entry point of the example package. Copy this folder to start a new package, or delete it.
import { slugWords } from "./lib/impl.js";

/** Turns free text into a URL-safe slug. */
export function slugify(text: string): string {
  return slugWords(text).join("-");
}
