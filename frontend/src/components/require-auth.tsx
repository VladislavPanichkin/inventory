import { Navigate, Outlet, useLocation } from "react-router";
import { ErrorState, LoadingRows } from "@/components/states";
import { useMe } from "@/hooks/use-auth";

/** Route guard: renders child routes only for an authenticated admin. */
export function RequireAuth() {
  const location = useLocation();
  const { data: admin, isPending, isError, error, refetch } = useMe();

  if (isPending) {
    return (
      <div className="mx-auto max-w-md p-8">
        <LoadingRows rows={3} label="Checking session" />
      </div>
    );
  }
  if (isError) {
    return (
      <div className="mx-auto max-w-md p-8">
        <ErrorState error={error} onRetry={() => refetch()} title="Server unreachable" />
      </div>
    );
  }
  if (!admin) {
    const next = location.pathname + location.search;
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
  }
  return <Outlet />;
}

/** Only allow same-app relative paths as post-login redirect targets (prevents open redirects). */
export function safeRedirectTarget(next: string | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/";
  return next;
}
