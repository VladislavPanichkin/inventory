import { AlertTriangle, Archive, Boxes, CircleCheck, Database, Info, Server, ShoppingBag, Tag, XCircle } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { PageHeader } from "@/components/page-header";
import { ErrorState } from "@/components/states";
import { SaleStatusBadge } from "@/components/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useMe } from "@/hooks/use-auth";
import { useHealth } from "@/hooks/use-health";
import { useDashboardSummary } from "@/hooks/use-sales-dashboard";
import { formatDateTime, formatMoney, formatRelative } from "@/lib/format";
import type { DashboardSummary, DashboardWarning } from "@/lib/types";

function StatCard({ label, value, icon, to }: { label: string; value: number | undefined; icon: ReactNode; to: string }) {
  return (
    <Link to={to} className="rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <Card className="gap-2 py-4 transition-colors hover:bg-accent/40">
        <CardContent className="flex items-center justify-between px-4">
          <div>
            <p className="text-sm text-muted-foreground">{label}</p>
            {value === undefined ? (
              <Skeleton className="mt-1 h-8 w-12" />
            ) : (
              <p className="text-2xl font-semibold tabular-nums">{value}</p>
            )}
          </div>
          <span className="text-muted-foreground">{icon}</span>
        </CardContent>
      </Card>
    </Link>
  );
}

const WARNING_ICON = { info: Info, warning: AlertTriangle, error: XCircle } as const;

function Warnings({ warnings }: { warnings: DashboardWarning[] }) {
  if (warnings.length === 0) return null;
  return (
    <div className="grid gap-3" aria-label="Synchronization warnings">
      {warnings.map((w) => {
        const Icon = WARNING_ICON[w.severity];
        return (
          <Alert key={w.code} variant={w.severity === "error" ? "destructive" : w.severity === "warning" ? "warning" : "default"}>
            <Icon />
            <AlertTitle>{w.severity === "info" ? "Notice" : w.severity === "error" ? "Action required" : "Warning"}</AlertTitle>
            <AlertDescription>{w.message}</AlertDescription>
          </Alert>
        );
      })}
    </div>
  );
}

const CONNECTION_LABEL: Record<DashboardSummary["ebay"]["connectionStatus"], ReactNode> = {
  CONNECTED: <Badge variant="success">Connected</Badge>,
  NOT_CONNECTED: <Badge variant="muted">Not connected</Badge>,
  DISCONNECTED: <Badge variant="muted">Disconnected</Badge>,
  REAUTH_REQUIRED: <Badge variant="destructive">Reconnect required</Badge>,
};

function Row({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="flex items-center gap-3 text-sm">
        <span className="text-muted-foreground">{icon}</span>
        {label}
      </div>
      <div className="flex items-center gap-2 text-right text-sm">{children}</div>
    </div>
  );
}

function SyncCard({ summary }: { summary: DashboardSummary | undefined }) {
  const health = useHealth();
  const isDemo = useMe().data?.role === "DEMO";
  return (
    <Card>
      <CardHeader>
        <CardTitle>eBay & system status</CardTitle>
        <CardDescription>Connection and synchronization health.</CardDescription>
      </CardHeader>
      <CardContent className="divide-y">
        <Row icon={<ShoppingBag className="size-4" />} label="eBay account">
          {summary ? CONNECTION_LABEL[summary.ebay.connectionStatus] : <Skeleton className="h-5 w-24" />}
          {summary?.ebay.sellerUsername && <span className="text-muted-foreground">{summary.ebay.sellerUsername}</span>}
          {isDemo && <span className="text-muted-foreground">(simulated)</span>}
        </Row>
        <Row icon={<CircleCheck className="size-4" />} label="Last successful sync">
          {isDemo ? (
            <span className="text-muted-foreground">—</span>
          ) : summary ? (
            <span title={formatDateTime(summary.sync.lastSuccessfulSyncAt)}>
              {formatRelative(summary.sync.lastSuccessfulSyncAt)}
            </span>
          ) : (
            <Skeleton className="h-5 w-24" />
          )}
        </Row>
        <Row icon={<Server className="size-4" />} label="API server">
          {health.isError ? <Badge variant="destructive">Unreachable</Badge> : <Badge variant="success">Online</Badge>}
        </Row>
        <Row icon={<Database className="size-4" />} label="Database">
          {health.data?.checks.database.status === "down" ? (
            <Badge variant="destructive">Unavailable</Badge>
          ) : health.data ? (
            <Badge variant="success">Connected</Badge>
          ) : (
            <Skeleton className="h-5 w-20" />
          )}
        </Row>
      </CardContent>
    </Card>
  );
}

function RecentSales({ summary }: { summary: DashboardSummary | undefined }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between">
        <div className="grid gap-1.5">
          <CardTitle>Recent sales</CardTitle>
          <CardDescription>Latest eBay sales.</CardDescription>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link to="/sales">View all</Link>
        </Button>
      </CardHeader>
      <CardContent>
        {!summary ? (
          <div className="space-y-2">
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </div>
        ) : summary.recentSales.length === 0 ? (
          <p className="text-sm text-muted-foreground">No sales recorded yet.</p>
        ) : (
          <ul className="divide-y">
            {summary.recentSales.map((sale) => (
              <li key={sale.id} className="flex items-center justify-between gap-4 py-3">
                <div className="min-w-0">
                  <Link to={`/products/${sale.product.id}`} className="block truncate text-sm font-medium hover:underline">
                    {sale.product.name}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {formatDateTime(sale.soldAt)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-sm tabular-nums">{formatMoney(sale.soldPrice, sale.currency)}</span>
                  <SaleStatusBadge status={sale.saleStatus} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export function DashboardPage() {
  const summary = useDashboardSummary();
  const data = summary.data;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <PageHeader title="Dashboard" description="Overview of your inventory and eBay synchronization." />

      {summary.isError && (
        <ErrorState
          error={summary.error}
          onRetry={() => summary.refetch()}
          title={data ? "Showing last known data. Refresh failed" : "Could not load dashboard"}
        />
      )}
      {data && <Warnings warnings={data.warnings} />}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Total products" value={data?.products.total} icon={<Boxes className="size-5" />} to="/products?status=ALL" />
        <StatCard label="Available" value={data?.products.available} icon={<Tag className="size-5" />} to="/products?status=AVAILABLE" />
        <StatCard label="Sold" value={data?.products.sold} icon={<ShoppingBag className="size-5" />} to="/products?status=SOLD" />
        <StatCard label="Archived" value={data?.products.archived} icon={<Archive className="size-5" />} to="/products?status=ARCHIVED" />
      </div>

      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <RecentSales summary={data} />
        <SyncCard summary={data} />
      </div>
    </div>
  );
}
