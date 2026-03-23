import { useTrades } from "../hooks/useTrades";
import { cn, formatCurrency } from "../lib/utils";

export function Trades() {
  const { data: trades, isLoading } = useTrades(100);

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Trade History</h1>

      {isLoading ? (
        <div className="text-muted-foreground">Loading...</div>
      ) : !trades?.length ? (
        <div className="text-muted-foreground">No trades yet.</div>
      ) : (
        <div className="rounded-lg border overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50 text-left text-muted-foreground">
                <th className="p-3">Time</th>
                <th className="p-3">Market</th>
                <th className="p-3">Price</th>
                <th className="p-3">Size</th>
                <th className="p-3">Fee</th>
                <th className="p-3">PnL</th>
                <th className="p-3">Reason</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((t: any) => (
                <tr key={t.id} className="border-b last:border-0">
                  <td className="p-3 whitespace-nowrap">
                    {new Date(t.executed_at).toLocaleString()}
                  </td>
                  <td className="p-3">{t.market_id}</td>
                  <td className="p-3">{formatCurrency(t.filled_price)}</td>
                  <td className="p-3">{t.filled_size}</td>
                  <td className="p-3">
                    {t.fee != null ? formatCurrency(t.fee) : "—"}
                  </td>
                  <td
                    className={cn(
                      "p-3",
                      t.pnl > 0 && "text-green-500",
                      t.pnl < 0 && "text-red-500"
                    )}
                  >
                    {t.pnl != null ? formatCurrency(t.pnl) : "—"}
                  </td>
                  <td className="p-3 text-muted-foreground max-w-48 truncate">
                    {t.trade_reason ?? "—"}
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
