import { useState } from "react";
import { useParams } from "react-router-dom";
import { useBot, useBotStatus, useStartBot, useStopBot, useUpdateBotConfig } from "../hooks/useBots";
import { useTrades } from "../hooks/useTrades";
import { cn } from "../lib/utils";

export function BotDetail() {
  const { id } = useParams<{ id: string }>();
  const botId = Number(id);
  const { data: bot, isLoading } = useBot(botId);
  const { data: status } = useBotStatus(botId);
  const { data: botTrades } = useTrades(20);
  const startBot = useStartBot();
  const stopBot = useStopBot();
  const updateConfig = useUpdateBotConfig(botId);
  const [newMarketId, setNewMarketId] = useState("");

  if (isLoading) {
    return <div className="p-6 text-muted-foreground">Loading...</div>;
  }

  if (!bot) {
    return <div className="p-6 text-muted-foreground">Bot not found.</div>;
  }

  const filteredTrades = botTrades?.filter(
    (t: any) => t.bot_instance_id === botId
  );

  const marketIds: string[] = Array.isArray((bot.config as any)?.marketIds)
    ? (bot.config as any).marketIds
    : [];

  function handleAddMarketId() {
    const trimmed = newMarketId.trim();
    if (!trimmed || marketIds.includes(trimmed)) return;
    updateConfig.mutate(
      { marketIds: [...marketIds, trimmed] },
      { onSuccess: () => setNewMarketId("") }
    );
  }

  function handleRemoveMarketId(idToRemove: string) {
    updateConfig.mutate({
      marketIds: marketIds.filter((id) => id !== idToRemove),
    });
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{bot.name}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Type: {bot.bot_type} &middot; ID: {bot.id}
          </p>
        </div>
        <div className="flex gap-2">
          {bot.status !== "running" ? (
            <button
              className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:opacity-90"
              onClick={() => startBot.mutate(botId)}
              disabled={startBot.isPending}
            >
              Start
            </button>
          ) : (
            <button
              className="px-4 py-2 text-sm rounded-md bg-destructive/10 text-destructive hover:bg-destructive/20"
              onClick={() => stopBot.mutate(botId)}
              disabled={stopBot.isPending}
            >
              Stop
            </button>
          )}
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Status card */}
        <div className="rounded-lg border bg-card p-4 space-y-3">
          <h2 className="font-semibold">Live Status</h2>
          {status ? (
            <div className="space-y-2 text-sm">
              <Row label="Running" value={status.running ? "Yes" : "No"} />
              <Row label="Tick Count" value={String(status.tickCount)} />
              <Row
                label="Last Tick"
                value={
                  status.lastTick
                    ? new Date(status.lastTick).toLocaleString()
                    : "—"
                }
              />
              <Row
                label="Error"
                value={status.error ?? "None"}
                error={!!status.error}
              />
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">
              No live status — bot may not be running.
            </div>
          )}
        </div>

        {/* Config card */}
        <div className="rounded-lg border bg-card p-4 space-y-3">
          <h2 className="font-semibold">Configuration</h2>
          <pre className="text-xs bg-muted/50 rounded p-3 overflow-auto max-h-48">
            {JSON.stringify(bot.config, null, 2)}
          </pre>
        </div>
      </div>

      {/* Market IDs */}
      <div className="rounded-lg border bg-card p-4 space-y-3">
        <h2 className="font-semibold">Market IDs</h2>

        {marketIds.length === 0 ? (
          <p className="text-sm text-muted-foreground">No market IDs configured.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {marketIds.map((mid) => (
              <span
                key={mid}
                className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-md bg-muted"
              >
                <span className="font-mono truncate max-w-[200px]" title={mid}>
                  {mid}
                </span>
                <button
                  onClick={() => handleRemoveMarketId(mid)}
                  className="text-muted-foreground hover:text-destructive ml-1"
                  disabled={updateConfig.isPending}
                >
                  x
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="flex gap-2">
          <input
            type="text"
            value={newMarketId}
            onChange={(e) => setNewMarketId(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAddMarketId()}
            placeholder="Enter market ID..."
            className="flex-1 px-3 py-1.5 text-sm rounded-md border bg-background"
          />
          <button
            onClick={handleAddMarketId}
            disabled={updateConfig.isPending || !newMarketId.trim()}
            className="px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            Add
          </button>
        </div>

        {updateConfig.isError && (
          <p className="text-xs text-destructive">Failed to update config.</p>
        )}
      </div>

      {/* Recent trades */}
      <div className="rounded-lg border bg-card p-4 space-y-3">
        <h2 className="font-semibold">Recent Trades</h2>
        {filteredTrades?.length ? (
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="pb-2 pr-4">Time</th>
                  <th className="pb-2 pr-4">Price</th>
                  <th className="pb-2 pr-4">Size</th>
                  <th className="pb-2 pr-4">PnL</th>
                  <th className="pb-2">Reason</th>
                </tr>
              </thead>
              <tbody>
                {filteredTrades.map((t: any) => (
                  <tr key={t.id} className="border-b last:border-0">
                    <td className="py-2 pr-4">
                      {new Date(t.executed_at).toLocaleString()}
                    </td>
                    <td className="py-2 pr-4">${t.filled_price}</td>
                    <td className="py-2 pr-4">{t.filled_size}</td>
                    <td
                      className={cn(
                        "py-2 pr-4",
                        t.pnl > 0 && "text-green-500",
                        t.pnl < 0 && "text-red-500"
                      )}
                    >
                      {t.pnl != null ? `$${t.pnl.toFixed(2)}` : "—"}
                    </td>
                    <td className="py-2 text-muted-foreground">
                      {t.trade_reason ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">No trades yet.</div>
        )}
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  error,
}: {
  label: string;
  value: string;
  error?: boolean;
}) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn(error && "text-red-500")}>{value}</span>
    </div>
  );
}
