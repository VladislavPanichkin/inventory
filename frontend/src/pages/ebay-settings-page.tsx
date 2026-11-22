import { AlertTriangle, FlaskConical, Info, Link2, Unlink } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EbayListings } from "@/components/ebay-listings";
import { PageHeader } from "@/components/page-header";
import { ErrorState, LoadingRows, errorMessage } from "@/components/states";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useMe } from "@/hooks/use-auth";
import { useConnectSampleEbay, useDisconnectEbay, useEbayConnection } from "@/hooks/use-ebay";
import { formatDate, formatDateTime } from "@/lib/format";
import type { EbayConnectionStatus } from "@/lib/types";
import { EBAY_CONNECT_URL } from "@/services/ebay";

/** Outcome codes the backend appends when redirecting back from eBay (?error=…). */
export const CONNECT_ERROR_MESSAGES: Record<string, string> = {
  not_configured: "eBay API credentials are not configured on the server.",
  session_expired: "Your session expired during the eBay login. Please connect again.",
  declined: "eBay access was not granted. Connect again and choose “Agree” on eBay's page.",
  invalid_state: "The response from eBay could not be verified (the link expired or was already used). Please try again.",
  ebay_unavailable: "eBay is temporarily unavailable. Please try again in a few minutes.",
  ebay_rejected: "eBay rejected the connection. Check the app credentials (client ID/secret) and RuName.",
  demo: "eBay is switched off for the demo account.",
  unexpected: "Something went wrong while connecting eBay. Please try again.",
};

const STATUS_BADGE: Record<EbayConnectionStatus, ReactNode> = {
  CONNECTED: <Badge variant="success">Connected</Badge>,
  NOT_CONNECTED: <Badge variant="muted">Not connected</Badge>,
  DISCONNECTED: <Badge variant="muted">Disconnected</Badge>,
  REAUTH_REQUIRED: <Badge variant="destructive">Reconnect required</Badge>,
};

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

export function EbaySettingsPage() {

  const [params, setParams] = useSearchParams();
  const [returnError, setReturnError] = useState<string | null>(null);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [sampleConnectOpen, setSampleConnectOpen] = useState(false);
  // The demo account gets a simulated eBay: same page, sample seller account, no real eBay.
  const simulated = useMe().data?.role === "DEMO";
  const connection = useEbayConnection();
  const disconnect = useDisconnectEbay();
  const connectSample = useConnectSampleEbay();

  // Outcome of the eBay round trip: show it once, then clean the URL.
  useEffect(() => {
    const connected = params.get("connected");
    const error = params.get("error");
    if (!connected && !error) return;
    if (connected) toast.success("eBay account connected");
    if (error) setReturnError(CONNECT_ERROR_MESSAGES[error] ?? CONNECT_ERROR_MESSAGES.unexpected!);
    setParams({}, { replace: true });
  }, [params, setParams]);

  const data = connection.data;
  const canDisconnect = data && (data.connectionStatus === "CONNECTED" || data.connectionStatus === "REAUTH_REQUIRED");
  const connectLabel = data?.connectionStatus === "CONNECTED" ? "Reconnect" : data?.connectionStatus === "REAUTH_REQUIRED" ? "Reconnect eBay" : "Connect eBay account";

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <PageHeader title="eBay" description="Connect your eBay seller account so the app can read your listings and sales." />

      {simulated && (
        <Alert>
          <FlaskConical />
          <AlertTitle>Simulated eBay</AlertTitle>
          <AlertDescription>
            <p>
              The demo works with a sample seller account and sample listings, so you can try connecting and adding
              listings. No real eBay account is involved and nothing here reaches eBay.
            </p>
          </AlertDescription>
        </Alert>
      )}

      {returnError && (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>eBay connection failed</AlertTitle>
          <AlertDescription>
            <p>{returnError}</p>
            <Button variant="outline" size="sm" onClick={() => setReturnError(null)}>
              Dismiss
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {connection.isPending ? (
        <LoadingRows rows={4} label="Loading eBay connection" />
      ) : connection.isError ? (
        <ErrorState error={connection.error} onRetry={() => connection.refetch()} />
      ) : (
        <>
          {!connection.data.configured && (
            <Alert>
              <Info />
              <AlertTitle>eBay credentials not configured</AlertTitle>
              <AlertDescription>
                <p>
                  Add <code>EBAY_CLIENT_ID</code>, <code>EBAY_CLIENT_SECRET</code>, <code>EBAY_RU_NAME</code> and{" "}
                  <code>TOKEN_ENCRYPTION_KEY</code> to <code>backend/.env</code> and restart the backend.
                </p>
              </AlertDescription>
            </Alert>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2">
                Connection {STATUS_BADGE[connection.data.connectionStatus]}
                <Badge variant="outline">
                  {simulated ? "Simulated" : connection.data.environment === "sandbox" ? "Sandbox" : "Production"}
                </Badge>
              </CardTitle>
              <CardDescription>
                The app only accesses eBay from the server. Your eBay password is never seen by this app.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {connection.data.lastErrorMessage && (
                <Alert variant="destructive">
                  <AlertTriangle />
                  <AlertTitle>Action required</AlertTitle>
                  <AlertDescription>{connection.data.lastErrorMessage}</AlertDescription>
                </Alert>
              )}

              <dl className="divide-y">
                <Row label="Seller account">{connection.data.sellerUsername ?? "—"}</Row>
                <Row label="Marketplace">{connection.data.marketplaceId}</Row>
                <Row label="Connected since">{formatDateTime(connection.data.connectedAt)}</Row>
                <Row label="Authorization valid until">{formatDate(connection.data.refreshTokenExpiresAt)}</Row>
              </dl>

              <div className="flex flex-col gap-2 sm:flex-row">
                {simulated ? (
                  connection.data.connectionStatus !== "CONNECTED" && (
                    <Button onClick={() => setSampleConnectOpen(true)}>
                      <Link2 /> Connect eBay account
                    </Button>
                  )
                ) : connection.data.configured ? (
                  <Button asChild>
                    {/* Full-page navigation: the server redirects to eBay's login/consent page. */}
                    <a href={EBAY_CONNECT_URL}>
                      <Link2 /> {connectLabel}
                    </a>
                  </Button>
                ) : (
                  <Button disabled>
                    <Link2 /> Connect eBay account
                  </Button>
                )}
                {canDisconnect && (
                  <Button variant="outline" onClick={() => setDisconnectOpen(true)}>
                    <Unlink /> Disconnect
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          {connection.data.connectionStatus === "CONNECTED" && <EbayListings simulated={simulated} />}

          {simulated && connection.data.connectionStatus === "CONNECTED" && (connection.data.photoCredits?.length ?? 0) > 0 && (
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer">Photo credits for the sample listings</summary>
              <ul className="mt-2 space-y-1">
                {connection.data.photoCredits!.map((credit) => (
                  <li key={credit}>{credit}</li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}

      <ConfirmDialog
        open={sampleConnectOpen}
        onOpenChange={setSampleConnectOpen}
        title="Simulated eBay sign-in"
        description="In the real app, this step sends you to eBay, where you sign in and agree to give the app access; eBay then sends you back here. In the demo, a sample seller account is connected instead."
        confirmLabel="Connect sample account"
        pending={connectSample.isPending}
        onConfirm={() =>
          connectSample.mutate(undefined, {
            onSuccess: () => {
              toast.success("Sample eBay account connected");
              setSampleConnectOpen(false);
            },
            onError: (error) => toast.error(errorMessage(error)),
          })
        }
      />

      <ConfirmDialog
        open={disconnectOpen}
        onOpenChange={setDisconnectOpen}
        title="Disconnect eBay?"
        description={
          simulated
            ? "The sample seller account is disconnected. Products you added from its listings are kept until the next sign-in."
            : "The app will forget its eBay authorization and stop syncing sales. Your products, listing links and sales history are kept. To fully revoke access, also remove the app in your eBay account settings."
        }
        confirmLabel="Disconnect"
        destructive
        pending={disconnect.isPending}
        onConfirm={() =>
          disconnect.mutate(undefined, {
            onSuccess: () => {
              toast.success("eBay disconnected");
              setDisconnectOpen(false);
            },
            onError: (error) => toast.error(errorMessage(error)),
          })
        }
      />
    </div>
  );
}
