import { useEffect, useRef, useState } from "react";

export function useDebouncedEdgeIds(edgeIds: string[], delayMs: number) {
  const [debouncedEdgeIds, setDebouncedEdgeIds] = useState(edgeIds);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(
      () => setDebouncedEdgeIds(edgeIds),
      delayMs,
    );
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [delayMs, edgeIds]);

  return debouncedEdgeIds;
}
