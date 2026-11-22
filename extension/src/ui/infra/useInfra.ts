import * as React from "react";
import type { ReviewModel } from "../../review/engine";
import { type InfraReading, readInfra, touchesTerraform } from "../../review/infra";

export interface InfraState {
  /** The comparison changes Terraform files: the page shows the Infra tab and the Overview card. */
  present: boolean;
  /** Null while the files or the parser load, and after a failure. */
  reading: InfraReading | null;
  error: string | null;
}

const ABSENT: InfraState = { present: false, reading: null, error: null };

/** What the comparison on show changes in Terraform, read once its files are in. Nothing loads for a PR without any. */
export function useInfra(review: ReviewModel | null): InfraState {
  const changes = review?.changes;
  const contents = review?.contents;
  const [state, setState] = React.useState<InfraState>(ABSENT);
  React.useEffect(() => {
    if (!changes || !contents || !touchesTerraform(changes)) {
      setState(ABSENT);
      return;
    }
    let cancelled = false;
    setState({ present: true, reading: null, error: null });
    readInfra(changes, contents).then(
      (reading) => !cancelled && setState({ present: true, reading, error: null }),
      (e: Error) => {
        console.warn("[review-deck] could not read the Terraform changes", e);
        if (!cancelled) setState({ present: true, reading: null, error: e.message });
      },
    );
    return () => {
      cancelled = true;
    };
    // The preview and the grouped review of one build share these, so the files are read once per comparison.
  }, [changes, contents]);
  return state;
}
