import { Boxes, LayoutDashboard, LogOut, Package, Receipt, Store, type LucideIcon } from "lucide-react";
import { NavLink, Outlet, useNavigate } from "react-router";
import { ApiStatusIndicator } from "@/components/layout/api-status-indicator";
import { DemoBanner } from "@/components/layout/demo-banner";
import { OfflineBanner } from "@/components/layout/offline-banner";
import { PullToRefresh } from "@/components/layout/pull-to-refresh";
import { RefreshButton } from "@/components/layout/refresh-button";
import { Button } from "@/components/ui/button";
import { useLogout, useMe } from "@/hooks/use-auth";
import { useRefreshAll } from "@/hooks/use-refresh";
import { cn } from "@/lib/utils";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/products", label: "Products", icon: Boxes },
  { to: "/sales", label: "Sales", icon: Receipt },
  { to: "/settings/ebay", label: "eBay", icon: Store },
];

function NavItems({ orientation }: { orientation: "vertical" | "horizontal" }) {
  return (
    <nav aria-label="Main" className={cn("flex gap-1", orientation === "vertical" ? "flex-col" : "flex-row overflow-x-auto")}>
      {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          end={to === "/"}
          className={({ isActive }) =>
            cn(
              "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
              isActive && "bg-accent text-foreground",
            )
          }
        >
          <Icon className="size-4" aria-hidden="true" />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}

function AccountMenu() {
  const { data: admin } = useMe();
  const logout = useLogout();
  const navigate = useNavigate();
  return (
    <div className="flex items-center gap-3">
      <span className="hidden text-sm text-muted-foreground sm:inline">{admin?.email}</span>
      <Button
        variant="ghost"
        size="sm"
        disabled={logout.isPending}
        onClick={() => logout.mutate(undefined, { onSettled: () => navigate("/login", { replace: true }) })}
      >
        <LogOut /> Log out
      </Button>
    </div>
  );
}

export function AppLayout() {
  const { refresh, isRefreshing } = useRefreshAll();
  return (
    // Safe-area insets keep content clear of the notch / home indicator when installed as an app.
    <div className="flex min-h-svh flex-col pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] md:flex-row">
      <aside className="hidden w-60 shrink-0 flex-col gap-6 border-r bg-card p-4 md:flex">
        <div className="flex items-center gap-2 px-2">
          <Package className="size-5" aria-hidden="true" />
          <span className="font-semibold">Inventory Admin</span>
        </div>
        <NavItems orientation="vertical" />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-4 border-b bg-card px-4 pb-2 pt-[calc(0.5rem+env(safe-area-inset-top))] md:px-8">
          <div className="flex items-center gap-2 md:hidden">
            <Package className="size-5" aria-hidden="true" />
            <span className="font-semibold">Inventory</span>
          </div>
          <ApiStatusIndicator />
          <div className="flex items-center gap-1">
            <RefreshButton onRefresh={() => void refresh()} refreshing={isRefreshing} />
            <AccountMenu />
          </div>
        </header>

        <div className="border-b bg-card px-2 py-1 md:hidden">
          <NavItems orientation="horizontal" />
        </div>

        <DemoBanner />
        <OfflineBanner />

        <main className="flex-1 px-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-6 md:px-8">
          <PullToRefresh onRefresh={refresh}>
            <Outlet />
          </PullToRefresh>
        </main>
      </div>
    </div>
  );
}
