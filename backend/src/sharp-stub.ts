// Stands in for sharp in the bundle (see backend/build.mjs). transformers.js only needs it to be truthy at load.
export default function sharp(): never {
  throw new Error("Image processing is not available in the embedding function");
}
