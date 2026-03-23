import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";

export function useTrades(limit?: number) {
  return useQuery({
    queryKey: ["trades", limit],
    queryFn: () => api.listTrades(limit),
  });
}
