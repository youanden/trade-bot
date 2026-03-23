import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";

export function useMarkets(limit?: number) {
  return useQuery({
    queryKey: ["markets", limit],
    queryFn: () => api.listMarkets(limit),
    refetchInterval: 30_000,
  });
}
