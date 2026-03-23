import { useState, useEffect, useRef } from "react";

export type PriceOverride = { yesPrice: number; noPrice: number };

/** Connects to the SSE /api/markets/stream endpoint and returns a live map of price overrides keyed by market ID. */
export function useMarketStream(): Map<number, PriceOverride> {
  const [overrides, setOverrides] = useState<Map<number, PriceOverride>>(
    new Map()
  );
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const es = new EventSource("/api/markets/stream");
    esRef.current = es;

    es.addEventListener("snapshot", (evt) => {
      const data: Array<{ id: number; yesPrice: number; noPrice: number }> =
        JSON.parse(evt.data);
      const next = new Map<number, PriceOverride>();
      for (const item of data) {
        next.set(item.id, { yesPrice: item.yesPrice, noPrice: item.noPrice });
      }
      setOverrides(next);
    });

    es.addEventListener("tick", (evt) => {
      const item: { id: number; yesPrice: number; noPrice: number } =
        JSON.parse(evt.data);
      setOverrides((prev) => {
        const next = new Map(prev);
        next.set(item.id, { yesPrice: item.yesPrice, noPrice: item.noPrice });
        return next;
      });
    });

    es.onerror = () => {
      es.close();
    };

    return () => {
      es.close();
    };
  }, []);

  return overrides;
}
