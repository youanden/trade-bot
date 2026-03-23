import { useState } from "react";
import { Link } from "react-router-dom";
import {
  useBots,
  useStartBot,
  useStopBot,
  useCreateBot,
} from "../hooks/useBots";
import { cn } from "../lib/utils";

const BOT_TYPES = [
  "copy-trader",
  "cross-arb",
  "logical-arb",
  "llm-assessor",
  "weather-arb",
  "market-maker",
  "ladder-straddle",
  "deep-research",
];

export function Dashboard() {
  const { data: bots, isLoading } = useBots();
  const startBot = useStartBot();
  const stopBot = useStopBot();
  const createBot = useCreateBot();
  const [showCreate, setShowCreate] = useState(false);
  const [newBotType, setNewBotType] = useState(BOT_TYPES[0]);
  const [newBotName, setNewBotName] = useState("");
  const [newBotPlatform, setNewBotPlatform] = useState<string>("polymarket");
  const [newBotConfig, setNewBotConfig] = useState<string>("");
  const [configError, setConfigError] = useState<string>("");

  const handleCreate = () => {
    if (!newBotName.trim()) return;
    const config: Record<string, unknown> = {};
    if (newBotPlatform !== "none") {
      config.platform = newBotPlatform;
    }
    if (newBotConfig.trim()) {
      try {
        const parsed = JSON.parse(newBotConfig);
        Object.assign(config, parsed);
        setConfigError("");
      } catch {
        setConfigError("Invalid JSON — please fix before submitting.");
        return;
      }
    }
    createBot.mutate(
      { botType: newBotType, name: newBotName.trim(), config },
      {
        onSuccess: () => {
          setShowCreate(false);
          setNewBotName("");
          setNewBotConfig("");
          setNewBotPlatform("polymarket");
          setConfigError("");
        },
      }
    );
  };

  const statusCounts = {
    running: bots?.filter((b: any) => b.status === "running").length ?? 0,
    stopped: bots?.filter((b: any) => b.status === "stopped").length ?? 0,
    error: bots?.filter((b: any) => b.status === "error").length ?? 0,
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Bot Dashboard</h1>
        <button
          className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:opacity-90"
          onClick={() => setShowCreate(!showCreate)}
        >
          {showCreate ? "Cancel" : "New Bot"}
        </button>
      </div>

      {/* Status summary */}
      <div className="grid gap-4 grid-cols-3">
        <StatusCard label="Running" value={statusCounts.running} color="green" />
        <StatusCard label="Stopped" value={statusCounts.stopped} color="muted" />
        <StatusCard label="Errors" value={statusCounts.error} color="red" />
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="rounded-lg border bg-card p-4 space-y-3">
          <h3 className="font-semibold">Create Bot</h3>
          <div className="flex gap-3">
            <select
              className="flex-1 rounded-md border bg-background px-3 py-2 text-sm"
              value={newBotType}
              onChange={(e) => setNewBotType(e.target.value)}
            >
              {BOT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <input
              className="flex-1 rounded-md border bg-background px-3 py-2 text-sm"
              placeholder="Bot name"
              value={newBotName}
              onChange={(e) => setNewBotName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            />
            <button
              className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
              onClick={handleCreate}
              disabled={createBot.isPending || !newBotName.trim() || !!configError}
            >
              Create
            </button>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Platform</p>
            <select
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              value={newBotPlatform}
              onChange={(e) => setNewBotPlatform(e.target.value)}
            >
              <option value="polymarket">polymarket</option>
              <option value="kalshi">kalshi</option>
              <option value="none">none (cross-arb — operates on both)</option>
            </select>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Config (JSON)</p>
            <textarea
              className="w-full rounded-md border bg-background px-3 py-2 text-sm font-mono"
              rows={3}
              placeholder={`{"tickIntervalMs": 60000, "maxPositionSize": 100}`}
              value={newBotConfig}
              onChange={(e) => {
                setNewBotConfig(e.target.value);
                if (configError) setConfigError("");
              }}
            />
            {configError && (
              <p className="text-xs text-red-500">{configError}</p>
            )}
          </div>
        </div>
      )}

      {/* Bot list */}
      {isLoading ? (
        <div className="text-muted-foreground">Loading bots...</div>
      ) : !bots?.length ? (
        <div className="text-center py-12 text-muted-foreground">
          No bots configured. Click "New Bot" to create one.
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {bots.map((bot: any) => (
            <BotCard
              key={bot.id}
              bot={bot}
              onStart={() => startBot.mutate(bot.id)}
              onStop={() => stopBot.mutate(bot.id)}
              isStarting={startBot.isPending}
              isStopping={stopBot.isPending}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function StatusCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: "green" | "red" | "muted";
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div
        className={cn(
          "text-2xl font-bold mt-1",
          color === "green" && "text-green-500",
          color === "red" && "text-red-500"
        )}
      >
        {value}
      </div>
    </div>
  );
}

function BotCard({
  bot,
  onStart,
  onStop,
  isStarting,
  isStopping,
}: {
  bot: any;
  onStart: () => void;
  onStop: () => void;
  isStarting: boolean;
  isStopping: boolean;
}) {
  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold truncate">{bot.name}</h3>
        <span
          className={cn(
            "text-xs px-2 py-0.5 rounded-full font-medium shrink-0",
            bot.status === "running" && "bg-green-500/10 text-green-500",
            bot.status === "error" && "bg-red-500/10 text-red-500",
            bot.status === "stopped" && "bg-muted text-muted-foreground"
          )}
        >
          {bot.status}
        </span>
      </div>

      <div className="space-y-1 text-sm text-muted-foreground">
        <div>Type: {bot.bot_type}</div>
        {bot.heartbeat && (
          <div>
            Last heartbeat:{" "}
            {new Date(bot.heartbeat).toLocaleTimeString()}
          </div>
        )}
        {bot.error_message && (
          <div className="text-red-500 text-xs truncate">
            {bot.error_message}
          </div>
        )}
      </div>

      <div className="flex gap-2 pt-1">
        {bot.status !== "running" ? (
          <button
            className="text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
            onClick={onStart}
            disabled={isStarting}
          >
            Start
          </button>
        ) : (
          <button
            className="text-xs px-3 py-1.5 rounded-md bg-destructive/10 text-destructive hover:bg-destructive/20 disabled:opacity-50"
            onClick={onStop}
            disabled={isStopping}
          >
            Stop
          </button>
        )}
        <Link
          to={`/bots/${bot.id}`}
          className="text-xs px-3 py-1.5 rounded-md border hover:bg-accent"
        >
          Details
        </Link>
      </div>
    </div>
  );
}
