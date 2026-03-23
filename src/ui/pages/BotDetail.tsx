import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useBot, useBotStatus, useStartBot, useStopBot, useUpdateBotConfig, useForceTick, useBotLogs } from "../hooks/useBots";
import { useTrades } from "../hooks/useTrades";
import { cn } from "../lib/utils";

interface ConfigFormState {
  platform: string;
  tickIntervalMs: number;
  spreadWidth: number;
  orderSize: number;
  maxInventory: number;
  levels: number;
  maxMarkets: number;
  minVolume: number;
}

function configToFormState(config: any): ConfigFormState {
  return {
    platform: config?.platform ?? "polymarket",
    tickIntervalMs: config?.tickIntervalMs ?? 60000,
    spreadWidth: config?.spreadWidth ?? 0.04,
    orderSize: config?.orderSize ?? 50,
    maxInventory: config?.maxInventory ?? 500,
    levels: config?.levels ?? 3,
    maxMarkets: config?.maxMarkets ?? 5,
    minVolume: config?.minVolume ?? 0,
  };
}

export function BotDetail() {
  const { id } = useParams<{ id: string }>();
  const botId = Number(id);
  const { data: bot, isLoading } = useBot(botId);
  const { data: status } = useBotStatus(botId);
  const { data: botTrades } = useTrades(20);
  const startBot = useStartBot();
  const stopBot = useStopBot();
  const updateConfig = useUpdateBotConfig(botId);
  const forceTick = useForceTick(botId);
  const { data: logs } = useBotLogs(botId);

  const [formState, setFormState] = useState<ConfigFormState>(() =>
    configToFormState(bot?.config)
  );
  const [marketIds, setMarketIds] = useState<string[]>(() =>
    Array.isArray((bot?.config as any)?.marketIds)
      ? (bot?.config as any).marketIds
      : []
  );
  const [newMarketId, setNewMarketId] = useState("");

  // Reset form when server data changes
  useEffect(() => {
    if (bot?.config) {
      setFormState(configToFormState(bot.config));
      setMarketIds(
        Array.isArray((bot.config as any)?.marketIds)
          ? (bot.config as any).marketIds
          : []
      );
    }
  }, [bot?.config]);

  const isDirty = useMemo(() => {
    if (!bot?.config) return false;
    const orig = configToFormState(bot.config);
    const origMarketIds: string[] = Array.isArray((bot.config as any)?.marketIds)
      ? (bot.config as any).marketIds
      : [];
    if (
      formState.platform !== orig.platform ||
      formState.tickIntervalMs !== orig.tickIntervalMs ||
      formState.spreadWidth !== orig.spreadWidth ||
      formState.orderSize !== orig.orderSize ||
      formState.maxInventory !== orig.maxInventory ||
      formState.levels !== orig.levels ||
      formState.maxMarkets !== orig.maxMarkets ||
      formState.minVolume !== orig.minVolume
    ) {
      return true;
    }
    if (marketIds.length !== origMarketIds.length) return true;
    return marketIds.some((mid, i) => mid !== origMarketIds[i]);
  }, [formState, marketIds, bot?.config]);

  if (isLoading) {
    return <div className="p-6 text-muted-foreground">Loading...</div>;
  }

  if (!bot) {
    return <div className="p-6 text-muted-foreground">Bot not found.</div>;
  }

  const filteredTrades = botTrades?.filter(
    (t: any) => t.bot_instance_id === botId
  );

  function handleFieldChange<K extends keyof ConfigFormState>(
    key: K,
    value: ConfigFormState[K]
  ) {
    setFormState((prev) => ({ ...prev, [key]: value }));
  }

  function handleAddMarketId() {
    const trimmed = newMarketId.trim();
    if (!trimmed || marketIds.includes(trimmed)) return;
    setMarketIds((prev) => [...prev, trimmed]);
    setNewMarketId("");
  }

  function handleRemoveMarketId(idToRemove: string) {
    setMarketIds((prev) => prev.filter((mid) => mid !== idToRemove));
  }

  function handleSave() {
    updateConfig.mutate({
      ...bot.config,
      ...formState,
      marketIds,
    });
  }

  const inputClass =
    "w-full px-3 py-1.5 text-sm rounded-md border bg-background";

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
          {bot.status === "running" && (
            <button
              className="px-4 py-2 text-sm rounded-md border hover:bg-muted"
              onClick={() => forceTick.mutate()}
              disabled={forceTick.isPending}
            >
              {forceTick.isPending ? "Ticking..." : "Trigger Tick"}
            </button>
          )}
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

      {bot.errorMessage && (
        <div className="rounded-lg border border-red-300 bg-red-50 dark:bg-red-950/20 dark:border-red-800 p-4">
          <p className="text-sm font-medium text-red-800 dark:text-red-400">Persistent Error</p>
          <p className="text-sm text-red-700 dark:text-red-300 mt-1 font-mono break-all">
            {bot.errorMessage}
          </p>
        </div>
      )}

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

        {/* Configuration form card */}
        <div className="rounded-lg border bg-card p-4 space-y-4">
          <h2 className="font-semibold">Configuration</h2>

          <div className="grid md:grid-cols-2 gap-4">
            <label className="block space-y-1">
              <span className="text-sm font-medium">Platform</span>
              <select
                value={formState.platform}
                onChange={(e) => handleFieldChange("platform", e.target.value)}
                className={inputClass}
              >
                <option value="polymarket">polymarket</option>
                <option value="kalshi">kalshi</option>
              </select>
            </label>

            <label className="block space-y-1">
              <span className="text-sm font-medium">Tick Interval (ms)</span>
              <input
                type="number"
                step="1000"
                min="1000"
                value={formState.tickIntervalMs}
                onChange={(e) =>
                  handleFieldChange("tickIntervalMs", Number(e.target.value))
                }
                className={inputClass}
              />
            </label>

            <label className="block space-y-1">
              <span className="text-sm font-medium">Spread Width</span>
              <input
                type="number"
                step="0.01"
                value={formState.spreadWidth}
                onChange={(e) =>
                  handleFieldChange("spreadWidth", Number(e.target.value))
                }
                className={inputClass}
              />
            </label>

            <label className="block space-y-1">
              <span className="text-sm font-medium">Order Size</span>
              <input
                type="number"
                step="1"
                value={formState.orderSize}
                onChange={(e) =>
                  handleFieldChange("orderSize", Number(e.target.value))
                }
                className={inputClass}
              />
            </label>

            <label className="block space-y-1">
              <span className="text-sm font-medium">Max Inventory</span>
              <input
                type="number"
                step="1"
                value={formState.maxInventory}
                onChange={(e) =>
                  handleFieldChange("maxInventory", Number(e.target.value))
                }
                className={inputClass}
              />
            </label>

            <label className="block space-y-1">
              <span className="text-sm font-medium">Levels</span>
              <input
                type="number"
                step="1"
                min="1"
                value={formState.levels}
                onChange={(e) =>
                  handleFieldChange("levels", Number(e.target.value))
                }
                className={inputClass}
              />
            </label>

            <label className="block space-y-1">
              <span className="text-sm font-medium">Max Markets</span>
              <input
                type="number"
                step="1"
                min="1"
                value={formState.maxMarkets}
                onChange={(e) =>
                  handleFieldChange("maxMarkets", Number(e.target.value))
                }
                className={inputClass}
              />
            </label>

            <label className="block space-y-1">
              <span className="text-sm font-medium">Min Volume</span>
              <input
                type="number"
                step="1"
                min="0"
                value={formState.minVolume}
                onChange={(e) =>
                  handleFieldChange("minVolume", Number(e.target.value))
                }
                className={inputClass}
              />
            </label>
          </div>

          {/* Market IDs chip UI */}
          <div className="space-y-2">
            <p className="text-sm font-medium">Market IDs</p>

            {marketIds.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No market IDs configured.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {marketIds.map((mid) => (
                  <span
                    key={mid}
                    className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-md bg-muted"
                  >
                    <span
                      className="font-mono truncate max-w-[200px]"
                      title={mid}
                    >
                      {mid}
                    </span>
                    <button
                      onClick={() => handleRemoveMarketId(mid)}
                      className="text-muted-foreground hover:text-destructive ml-1"
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
                disabled={!newMarketId.trim()}
                className="px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                Add
              </button>
            </div>
          </div>

          {/* Save button row */}
          <div className="flex justify-end pt-2">
            <button
              onClick={handleSave}
              disabled={updateConfig.isPending || !isDirty}
              className="bg-primary text-primary-foreground px-4 py-2 text-sm rounded-md hover:opacity-90 disabled:opacity-50"
            >
              {updateConfig.isPending ? "Saving..." : "Save"}
            </button>
          </div>

          {updateConfig.isError && (
            <p className="text-xs text-destructive">Failed to update config.</p>
          )}
        </div>
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

      {/* Recent Logs */}
      <div className="rounded-lg border bg-card p-4 space-y-3">
        <h2 className="font-semibold">Recent Logs</h2>
        {logs?.length ? (
          <div className="max-h-80 overflow-y-auto space-y-1">
            {logs.map((log: any) => (
              <div
                key={log.id}
                className={cn(
                  "flex items-start gap-3 py-1.5 px-2 rounded text-xs font-mono",
                  log.action.includes("error")
                    ? "bg-red-50 dark:bg-red-950/20 text-red-700 dark:text-red-400"
                    : "text-muted-foreground"
                )}
              >
                <span className="shrink-0 text-muted-foreground">
                  {new Date(log.createdAt).toLocaleTimeString()}
                </span>
                <span
                  className={cn(
                    "shrink-0 w-28",
                    log.action.includes("error") &&
                      "text-red-600 dark:text-red-400 font-semibold"
                  )}
                >
                  {log.action}
                </span>
                <span
                  className="truncate"
                  title={JSON.stringify(log.details)}
                >
                  {log.details && Object.keys(log.details).length > 0
                    ? Object.entries(log.details)
                        .map(
                          ([k, v]) =>
                            `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`
                        )
                        .join(" ")
                    : ""}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">No logs yet.</div>
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
