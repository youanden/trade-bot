import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";

export function useBots() {
  return useQuery({ queryKey: ["bots"], queryFn: api.listBots });
}

export function useBot(id: number) {
  return useQuery({ queryKey: ["bots", id], queryFn: () => api.getBot(id) });
}

export function useBotStatus(id: number) {
  return useQuery({
    queryKey: ["bots", id, "status"],
    queryFn: () => api.getBotStatus(id),
    refetchInterval: 5000,
  });
}

export function useCreateBot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.createBot,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["bots"] }),
  });
}

export function useStartBot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.startBot(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["bots"] }),
  });
}

export function useStopBot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.stopBot(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["bots"] }),
  });
}

export function useUpdateBotConfig(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (config: Record<string, unknown>) =>
      api.updateBotConfig(id, config),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["bots", id] }),
  });
}
