let counter = 0;

/** Short, process-unique id for correlating a request across logs and errors. */
export function createRequestId(): string {
  counter = (counter + 1) % 0x10000;
  return `${Date.now().toString(36)}-${counter.toString(36).padStart(3, "0")}`;
}
