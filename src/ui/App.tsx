import { BrowserRouter, Routes, Route, NavLink } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Dashboard } from "./pages/Dashboard";
import { BotDetail } from "./pages/BotDetail";
import { Positions } from "./pages/Positions";
import { Trades } from "./pages/Trades";
import { Markets } from "./pages/Markets";
import { Analytics } from "./pages/Analytics";
import { PromptTester } from "./pages/PromptTester";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 10_000, retry: 1 },
  },
});

function NavItem({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `px-3 py-1.5 text-sm rounded-md transition-colors ${
          isActive
            ? "bg-primary text-primary-foreground"
            : "text-muted-foreground hover:text-foreground"
        }`
      }
    >
      {children}
    </NavLink>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <div className="min-h-screen bg-background">
          {/* Nav */}
          <header className="border-b">
            <div className="flex items-center gap-4 px-6 h-14">
              <NavLink to="/" className="font-bold text-lg mr-4">
                Trade Bot
              </NavLink>
              <nav className="flex gap-1">
                <NavItem to="/">Dashboard</NavItem>
                <NavItem to="/positions">Positions</NavItem>
                <NavItem to="/trades">Trades</NavItem>
                <NavItem to="/markets">Markets</NavItem>
                <NavItem to="/analytics">Analytics</NavItem>
                <NavItem to="/prompt-tester">Prompt Tester</NavItem>
              </nav>
            </div>
          </header>

          {/* Content */}
          <main>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/bots/:id" element={<BotDetail />} />
              <Route path="/positions" element={<Positions />} />
              <Route path="/trades" element={<Trades />} />
              <Route path="/markets" element={<Markets />} />
              <Route path="/analytics" element={<Analytics />} />
              <Route path="/prompt-tester" element={<PromptTester />} />
            </Routes>
          </main>
        </div>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
