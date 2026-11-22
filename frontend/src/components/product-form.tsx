import { zodResolver } from "@hookform/resolvers/zod";
import { useId } from "react";
import { useForm, type FieldPath } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ApiError } from "@/lib/api-client";
import type { Product } from "@/lib/types";
import type { ProductInput } from "@/services/products";

/** Client-side rules mirror the backend (which re-validates everything). */
export const productFormSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200, "At most 200 characters"),
  description: z.string().max(5000, "At most 5000 characters"),
  // Accepts "149.90" and "149,90" (German decimal comma).
  price: z
    .string()
    .trim()
    .regex(/^\d{1,10}([.,]\d{1,2})?$/, "Enter a price such as 149.90"),
  currency: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{3}$/, "3-letter currency code, e.g. EUR"),
  condition: z.string().max(100, "At most 100 characters"),
});

export type ProductFormValues = z.infer<typeof productFormSchema>;

export const emptyProductForm: ProductFormValues = {
  name: "",
  description: "",
  price: "",
  currency: "EUR",
  condition: "",
};

export function productToFormValues(product: Product): ProductFormValues {
  return {
    name: product.name,
    description: product.description ?? "",
    price: product.price,
    currency: product.currency,
    condition: product.condition ?? "",
  };
}

export function formValuesToInput(values: ProductFormValues): ProductInput {
  return {
    name: values.name.trim(),
    description: values.description.trim() || null,
    price: values.price.trim().replace(",", "."),
    currency: values.currency.trim().toUpperCase(),
    condition: values.condition.trim() || null,
  };
}

interface ProductFormProps {
  defaultValues: ProductFormValues;
  submitLabel: string;
  onSubmit: (input: ProductInput) => Promise<unknown>;
  onCancel: () => void;
}

export function ProductForm({ defaultValues, submitLabel, onSubmit, onCancel }: ProductFormProps) {
  const form = useForm<ProductFormValues>({ resolver: zodResolver(productFormSchema), defaultValues });
  const { register, handleSubmit, formState, setError } = form;
  const errors = formState.errors;
  const id = useId();

  const submit = handleSubmit(async (values) => {
    try {
      await onSubmit(formValuesToInput(values));
    } catch (error) {
      // Map server-side validation errors back onto fields where possible.
      if (error instanceof ApiError && error.code === "VALIDATION_ERROR" && Array.isArray(error.details)) {
        for (const detail of error.details as { path: string; message: string }[]) {
          if (detail.path in defaultValues) setError(detail.path as FieldPath<ProductFormValues>, { message: detail.message });
        }
      } else {
        setError("root", { message: error instanceof ApiError ? error.message : "Could not save the product" });
      }
    }
  });

  const field = (name: keyof ProductFormValues) => ({
    id: `${id}-${name}`,
    "aria-invalid": errors[name] ? true : undefined,
    "aria-describedby": errors[name] ? `${id}-${name}-error` : undefined,
  });
  const fieldError = (name: keyof ProductFormValues) =>
    errors[name] && (
      <p id={`${id}-${name}-error`} className="text-sm text-destructive">
        {errors[name]?.message}
      </p>
    );

  return (
    <form onSubmit={submit} noValidate className="grid gap-5">
      <div className="grid gap-2">
        <Label htmlFor={`${id}-name`}>Name</Label>
        <Input {...field("name")} {...register("name")} />
        {fieldError("name")}
      </div>

      <div className="grid gap-2">
        <Label htmlFor={`${id}-condition`}>Condition</Label>
        <Input {...field("condition")} {...register("condition")} placeholder="e.g. Used – Very Good" />
        {fieldError("condition")}
      </div>

      <div className="grid gap-5 sm:grid-cols-[1fr_8rem]">
        <div className="grid gap-2">
          <Label htmlFor={`${id}-price`}>Price</Label>
          <Input {...field("price")} {...register("price")} inputMode="decimal" placeholder="149.90" />
          {fieldError("price")}
        </div>
        <div className="grid gap-2">
          <Label htmlFor={`${id}-currency`}>Currency</Label>
          <Input {...field("currency")} {...register("currency")} maxLength={3} className="uppercase" />
          {fieldError("currency")}
        </div>
      </div>

      <div className="grid gap-2">
        <Label htmlFor={`${id}-description`}>Description</Label>
        <Textarea {...field("description")} {...register("description")} rows={5} />
        {fieldError("description")}
      </div>

      {errors.root && (
        <p role="alert" className="text-sm text-destructive">
          {errors.root.message}
        </p>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={onCancel} disabled={formState.isSubmitting}>
          Cancel
        </Button>
        <Button type="submit" disabled={formState.isSubmitting}>
          {formState.isSubmitting ? "Saving…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
