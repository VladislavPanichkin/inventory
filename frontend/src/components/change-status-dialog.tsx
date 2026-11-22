import { useEffect, useId, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { PRODUCT_STATUS_LABELS } from "@/components/status-badge";
import { errorMessage } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { useChangeProductStatus } from "@/hooks/use-products";
import { PRODUCT_STATUSES, type Product, type ProductStatus } from "@/lib/types";

interface ChangeStatusDialogProps {
  product: Pick<Product, "id" | "name" | "status">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Manual status correction. Mirrors the backend rule: leaving SOLD requires a reason. */
export function ChangeStatusDialog({ product, open, onOpenChange }: ChangeStatusDialogProps) {
  const options = PRODUCT_STATUSES.filter((s) => s !== product.status);
  const [status, setStatus] = useState<ProductStatus>(options[0]!);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const mutation = useChangeProductStatus();
  const ids = { status: useId(), reason: useId() };
  const reasonRequired = product.status === "SOLD";

  useEffect(() => {
    if (open) {
      setStatus(PRODUCT_STATUSES.filter((s) => s !== product.status)[0]!);
      setReason("");
      setError(null);
    }
  }, [open, product.status]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (reasonRequired && !reason.trim()) {
      setError("A reason is required when changing the status of a sold product.");
      return;
    }
    mutation.mutate(
      { id: product.id, status, reason: reason.trim() || undefined },
      {
        onSuccess: () => {
          toast.success(`Status changed to ${PRODUCT_STATUS_LABELS[status]}`);
          onOpenChange(false);
        },
        onError: (err) => setError(errorMessage(err)),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Change status</DialogTitle>
            <DialogDescription>
              {product.name} is currently <strong>{PRODUCT_STATUS_LABELS[product.status]}</strong>. Manual changes
              are recorded in the status history.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-2">
            <Label htmlFor={ids.status}>New status</Label>
            <NativeSelect id={ids.status} value={status} onChange={(e) => setStatus(e.target.value as ProductStatus)}>
              {options.map((s) => (
                <option key={s} value={s}>
                  {PRODUCT_STATUS_LABELS[s]}
                </option>
              ))}
            </NativeSelect>
          </div>

          <div className="grid gap-2">
            <Label htmlFor={ids.reason}>Reason {reasonRequired ? "(required)" : "(optional)"}</Label>
            <Textarea
              id={ids.reason}
              value={reason}
              maxLength={500}
              onChange={(e) => setReason(e.target.value)}
              placeholder={reasonRequired ? "Why is this sold item changing status?" : "e.g. reserved for a local buyer"}
              aria-invalid={Boolean(error) || undefined}
            />
          </div>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Saving…" : "Change status"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
