import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { cn, formatCurrency } from "../lib/utils";

export function Positions() {
  const { data: positions, isLoading } = useQuery({
    queryKey: ["positions"],
    queryFn: api.listPositions,
  });

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Open Positions</h1>

      {isLoading ? (
        <div className="text-muted-foreground">Loading...</div>
      ) : !positions?.length ? (
        <div className="text-muted-foreground">No open positions.</div>
      ) : (
        <div className="rounded-lg border overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50 text-left text-muted-foreground">
                <th className="p-3">Market</th>
                <th className="p-3">Platform</th>
                <th className="p-3">Outcome</th>
                <th className="p-3">Size</th>
                <th className="p-3">Avg Entry</th>
                <th className="p-3">Current</th>
                <th className="p-3">Unrealized PnL</th>
              </tr>
            </thead>
            <tbody>
              {positions.map((p: any) => (
                <tr key={p.id} className="border-b last:border-0">
                  <td className="p-3">{p.market_id}</td>
                  <td className="p-3">{p.platform}</td>
                  <td className="p-3">
                    <span
                      className={cn(
                        "px-2 py-0.5 rounded text-xs font-medium",
                        p.outcome === "yes"
                          ? "bg-green-500/10 text-green-500"
                          : "bg-red-500/10 text-red-500"
                      )}
                    >
                      {p.outcome.toUpperCase()}
                    </span>
                  </td>
                  <td className="p-3">{p.size}</td>
                  <td className="p-3">{formatCurrency(p.avg_entry)}</td>
                  <td className="p-3">
                    {p.current_price != null
                      ? formatCurrency(p.current_price)
                      : "—"}
                  </td>
                  <td
                    className={cn(
                      "p-3",
                      p.unrealized_pnl > 0 && "text-green-500",
                      p.unrealized_pnl < 0 && "text-red-500"
                    )}
                  >
                    {p.unrealized_pnl != null
                      ? formatCurrency(p.unrealized_pnl)
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
