import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMarkets } from "../hooks/useMarkets";
import { cn, formatCurrency, formatPercent } from "../lib/utils";
import { api } from "../lib/api";

export function Markets() {
  const [search, setSearch] = useState("");
  const { data: markets, isLoading } = useMarkets(200);
  const qc = useQueryClient();
  const sync = useMutation({
    mutationFn: () => api.syncMarkets(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["markets"] }),
  });
  const seed = useMutation({
    mutationFn: () => api.seedMarkets(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["markets"] }),
  });

  const filtered = search
    ? markets?.filter((m: any) =>
        m.title.toLowerCase().includes(search.toLowerCase())
      )
    : markets;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Markets</h1>
        <div className="flex items-center gap-2">
          <input
            className="rounded-md border bg-background px-3 py-2 text-sm w-64"
            placeholder="Search markets..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button
            className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            disabled={sync.isPending}
            onClick={() => sync.mutate()}
          >
            {sync.isPending ? "Syncing..." : "Sync Markets"}
          </button>
          {sync.data && "error" in sync.data && sync.data.error && (
            <span className="text-xs text-destructive">{sync.data.error}</span>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="text-muted-foreground">Loading...</div>
      ) : !filtered?.length ? (
        <div className="text-muted-foreground flex flex-col items-start">
          {search ? (
            "No markets match your search."
          ) : (
            <>
              <span>No markets synced yet.</span>
              <button
                className="rounded-md bg-secondary px-3 py-2 text-sm text-secondary-foreground hover:bg-secondary/90 disabled:opacity-50 mt-2"
                disabled={seed.isPending}
                onClick={() => seed.mutate()}
              >
                {seed.isPending ? "Seeding..." : "Seed Dev Data"}
              </button>
              {seed.data && seed.data.seeded > 0 && (
                <span className="text-xs text-muted-foreground mt-1">
                  Seeded {seed.data.seeded} markets
                </span>
              )}
            </>
          )}
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((m: any) => (
            <div key={m.id} className="rounded-lg border bg-card p-4 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-sm font-medium leading-tight line-clamp-2">
                  {m.title}
                </h3>
                <span
                  className={cn(
                    "text-xs px-2 py-0.5 rounded-full shrink-0",
                    m.platform === "polymarket"
                      ? "bg-purple-500/10 text-purple-500"
                      : "bg-blue-500/10 text-blue-500"
                  )}
                >
                  {m.platform}
                </span>
              </div>
              <div className="flex gap-4 text-sm">
                {m.yesPrice != null && (
                  <span className="text-green-500">
                    YES {formatPercent(m.yesPrice)}
                  </span>
                )}
                {m.noPrice != null && (
                  <span className="text-red-500">
                    NO {formatPercent(m.noPrice)}
                  </span>
                )}
              </div>
              {m.volume != null && (
                <span className="text-xs text-muted-foreground">
                  Vol: {m.volume.toLocaleString()}
                </span>
              )}
              <div className="text-xs text-muted-foreground">
                {m.category && <span>{m.category} &middot; </span>}
                {m.status}
                {m.end_date && (
                  <span>
                    {" "}
                    &middot; Ends {new Date(m.end_date).toLocaleDateString()}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
