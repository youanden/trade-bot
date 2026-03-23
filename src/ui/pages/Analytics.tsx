import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { formatCurrency } from "../lib/utils";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

export function Analytics() {
  const { data: summary, isLoading } = useQuery({
    queryKey: ["analytics", "summary"],
    queryFn: () =>
      fetch("/api/analytics/summary").then((r) => r.json()) as Promise<any>,
  });

  const { data: pnlSeries } = useQuery({
    queryKey: ["analytics", "pnl-series"],
    queryFn: () =>
      fetch("/api/analytics/pnl-series").then((r) => r.json()) as Promise<
        Array<{ date: string; pnl: number }>
      >,
  });

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Analytics</h1>

      {isLoading ? (
        <div className="text-muted-foreground">Loading...</div>
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <MetricCard
              label="Total Trades"
              value={String(summary?.trades?.totalTrades ?? 0)}
            />
            <MetricCard
              label="Total PnL"
              value={formatCurrency(summary?.trades?.totalPnl ?? 0)}
              positive={(summary?.trades?.totalPnl ?? 0) > 0}
            />
            <MetricCard
              label="Open Positions"
              value={String(summary?.positions?.openPositions ?? 0)}
            />
            <MetricCard
              label="Unrealized PnL"
              value={formatCurrency(summary?.positions?.unrealizedPnl ?? 0)}
              positive={(summary?.positions?.unrealizedPnl ?? 0) > 0}
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-lg border bg-card p-4">
              <h2 className="font-semibold mb-3">Trade Stats</h2>
              <div className="space-y-2 text-sm">
                <Row
                  label="Total Fees"
                  value={formatCurrency(summary?.trades?.totalFees ?? 0)}
                />
                <Row
                  label="Total Exposure"
                  value={formatCurrency(
                    summary?.positions?.totalExposure ?? 0
                  )}
                />
              </div>
            </div>
            <div className="rounded-lg border bg-card p-4">
              <h2 className="font-semibold mb-3">Cumulative PnL</h2>
              {pnlSeries && pnlSeries.length > 0 ? (
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={pnlSeries}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.1} />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 11 }}
                      tickFormatter={(d: string) => d.slice(5)}
                    />
                    <YAxis
                      tick={{ fontSize: 11 }}
                      tickFormatter={(v: number) => `$${v.toFixed(0)}`}
                    />
                    <Tooltip
                      formatter={(value: number) => [
                        `$${value.toFixed(2)}`,
                        "PnL",
                      ]}
                      labelFormatter={(label: string) => `Date: ${label}`}
                    />
                    <Line
                      type="monotone"
                      dataKey="pnl"
                      stroke={
                        (pnlSeries[pnlSeries.length - 1]?.pnl ?? 0) >= 0
                          ? "#22c55e"
                          : "#ef4444"
                      }
                      strokeWidth={2}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-32 flex items-center justify-center text-sm text-muted-foreground">
                  PnL chart will appear after trades are recorded.
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function MetricCard({
  label,
  value,
  positive,
}: {
  label: string;
  value: string;
  positive?: boolean;
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div
        className={`text-xl font-bold mt-1 ${
          positive === true
            ? "text-green-500"
            : positive === false
              ? "text-red-500"
              : ""
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  );
}
