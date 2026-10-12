// Web Worker entry (dist/review-worker.js): keeps diffing and the semantic pipeline off the page's main thread.
import { type AnalysisJob, type AnalysisMessage, runJob } from "./analysis";

// The extension compiles against the DOM lib, which types `self` as a Window.
const scope = self as unknown as { onmessage: ((e: MessageEvent<AnalysisJob>) => void) | null; postMessage(message: AnalysisMessage): void };

scope.onmessage = (event) => void runJob(event.data, (message) => scope.postMessage(message));
