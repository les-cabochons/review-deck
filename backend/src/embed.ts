import { join } from "node:path";
import { env, type FeatureExtractionPipeline, pipeline } from "@huggingface/transformers";

/** Same model as the Node CLI, quantized: a quarter of the size, so cold starts load faster. */
export const MODEL = "Xenova/all-MiniLM-L6-v2";
const BATCH = 32;

let extractor: Promise<FeatureExtractionPipeline> | null = null;

/** The model ships inside the package (backend/build.mjs puts it in models/), so nothing is downloaded at runtime. */
function load(): Promise<FeatureExtractionPipeline> {
  env.allowRemoteModels = false;
  env.localModelPath = join(process.env.MODEL_DIR ?? join(import.meta.dirname, "..", "models"), "/");
  extractor ??= pipeline("feature-extraction", MODEL, { dtype: "q8" }).catch((e) => {
    extractor = null;
    throw e;
  }) as Promise<FeatureExtractionPipeline>;
  return extractor;
}

export async function warm(): Promise<void> {
  await load();
}

/** Unit-normalized vectors, rounded to 4 decimals to keep responses small. */
export async function embed(texts: string[]): Promise<number[][]> {
  const run = await load();
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const vectors = (await run(texts.slice(i, i + BATCH), { pooling: "mean", normalize: true })).tolist() as number[][];
    for (const v of vectors) out.push(v.map((x) => Math.round(x * 1e4) / 1e4));
  }
  return out;
}
