import * as React from "react";

/** Results of `search(query)`, a moment after typing stops; nothing below `minLength` characters. */
export function useSearch<T>(search: (query: string) => Promise<T[]>, query: string, minLength: number) {
  const [results, setResults] = React.useState<T[]>([]);
  const [searching, setSearching] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    let cancelled = false;
    setError(null);
    if (query.trim().length < minLength) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = window.setTimeout(() => {
      search(query)
        .then((found) => !cancelled && setResults(found))
        .catch((e: Error) => !cancelled && setError(e.message))
        .finally(() => !cancelled && setSearching(false));
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [search, query, minLength]);
  return { results, searching, error };
}
