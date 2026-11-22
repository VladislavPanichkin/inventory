import { useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { emptyProductForm, ProductForm, productToFormValues } from "@/components/product-form";
import { ErrorState, LoadingRows } from "@/components/states";
import { Card, CardContent } from "@/components/ui/card";
import { useCreateProduct, useProduct, useUpdateProduct } from "@/hooks/use-products";

export function ProductNewPage() {
  const navigate = useNavigate();
  const create = useCreateProduct();

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <PageHeader title="Add product" description="New products start as Available. You add photos on the next screen, once it's created." />
      <Card>
        <CardContent>
          <ProductForm
            defaultValues={emptyProductForm}
            submitLabel="Create product"
            onCancel={() => navigate("/products")}
            onSubmit={async (input) => {
              const product = await create.mutateAsync(input);
              toast.success(`Created ${product.name}. You can add photos now.`);
              navigate(`/products/${product.id}`);
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}

export function ProductEditPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const product = useProduct(id);
  const update = useUpdateProduct(id);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <PageHeader
        title="Edit product"
        description="Status is changed separately (Change status), so it stays in the history."
      />
      {product.isPending ? (
        <LoadingRows rows={6} label="Loading product" />
      ) : product.isError ? (
        <ErrorState error={product.error} onRetry={() => product.refetch()} />
      ) : (
        <Card>
          <CardContent>
            <ProductForm
              // Re-mount when the product loads/changes so the form resets to server values.
              key={product.data.updatedAt}
              defaultValues={productToFormValues(product.data)}
              submitLabel="Save changes"
              onCancel={() => navigate(`/products/${id}`)}
              onSubmit={async (input) => {
                await update.mutateAsync(input);
                toast.success("Product saved");
                navigate(`/products/${id}`);
              }}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
