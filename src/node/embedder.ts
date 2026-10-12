import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Embedder } from "../score/index.js";
import { ROOT } from "./fixtures.js";

const CACHE_DIR = join(ROOT, ".cache");

/**
 * Local sentence embeddings via transformers.js (ONNX on CPU). The model is
 * downloaded once from the Hugging Face hub into .cache/models, then runs offline.
 * Vectors are memoized on disk by model + text hash.
 */
export class TransformersEmbedder implements Embedder {
  private extractor: ((texts: string[], opts: object) => Promise<{ tolist(): number[][] }>) | null = null;
  private readonly cacheFile: string;
  private readonly cache: Record<string, number[]>;

  constructor(private readonly model: string) {
    mkdirSync(CACHE_DIR, { recursive: true });
    this.cacheFile = join(CACHE_DIR, `embeddings-${model.replace(/\W+/g, "_")}.json`);
    this.cache = existsSync(this.cacheFile) ? JSON.parse(readFileSync(this.cacheFile, "utf8")) : {};
  }

  async embed(texts: string[]): Promise<number[][]> {
    const keys = texts.map((t) => createHash("sha1").update(t).digest("hex"));
    const missing = texts.filter((_, i) => !this.cache[keys[i]]);
    if (missing.length > 0) {
      const extractor = await this.load();
      const vectors = (await extractor(missing, { pooling: "mean", normalize: true })).tolist();
      let k = 0;
      texts.forEach((_, i) => {
        if (!this.cache[keys[i]]) this.cache[keys[i]] = vectors[k++].map((x) => Math.round(x * 1e6) / 1e6);
      });
      writeFileSync(this.cacheFile, JSON.stringify(this.cache));
    }
    return keys.map((k) => this.cache[k]);
  }

  private async load() {
    if (!this.extractor) {
      const { env, pipeline } = await import("@huggingface/transformers");
      env.cacheDir = join(CACHE_DIR, "models");
      this.extractor = (await pipeline("feature-extraction", this.model, { dtype: "fp32" })) as unknown as typeof this.extractor;
    }
    return this.extractor!;
  }
}
