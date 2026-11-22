import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ImageDecodeError, prepareImage } from "@/lib/image-resize";
import { MAX_IMAGES_PER_PRODUCT } from "@/lib/types";
import { authed, errorResponse, imageFixture, jsonResponse, mockApi, productFixture, renderRoute } from "@/test/render";

// The real implementation needs a canvas (not available in the test DOM); the resize
// arithmetic is tested separately in image-resize.test.ts.
vi.mock("@/lib/image-resize", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/image-resize")>()),
  prepareImage: vi.fn(),
}));

const product = productFixture({ images: [imageFixture(1), imageFixture(2), imageFixture(3)] });
const [first, second, third] = product.images as [ReturnType<typeof imageFixture>, ReturnType<typeof imageFixture>, ReturnType<typeof imageFixture>];

const detailRoutes = (data = product) => ({
  ...authed,
  "GET /products/:id": { data },
  "GET /products/:id/sales": { data: [] },
  "GET /products/:id/status-history": { data: [] },
});

const photo = (name: string) => new File(["raw-camera-bytes"], name, { type: "image/jpeg" });

beforeEach(() => {
  vi.mocked(prepareImage).mockReset();
  vi.mocked(prepareImage).mockImplementation(async () => ({
    full: new Blob(["full"], { type: "image/jpeg" }),
    thumbnail: new Blob(["thumb"], { type: "image/jpeg" }),
    width: 2048,
    height: 1536,
  }));
});

describe("product photos on the details page", () => {
  it("shows the main photo large and the others as thumbnails to switch between", async () => {
    mockApi(detailRoutes());
    renderRoute(`/products/${product.id}`);

    const large = await screen.findByRole("img", { name: "Leica M3" });
    expect(large).toHaveAttribute("src", first.url);

    const strip = screen.getByRole("list", { name: "Photos" });
    expect(within(strip).getAllByRole("button")).toHaveLength(3);
    expect(within(strip).getByRole("button", { name: "Photo 1 (main)" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(`3 / ${MAX_IMAGES_PER_PRODUCT} photos`)).toBeInTheDocument();
    // "Make main" is only offered for a photo that isn't already the main one.
    expect(screen.queryByRole("button", { name: /Make main/ })).not.toBeInTheDocument();

    await userEvent.click(within(strip).getByRole("button", { name: "Photo 2" }));
    expect(screen.getByRole("img", { name: "Leica M3" })).toHaveAttribute("src", second.url);
    expect(screen.getByRole("button", { name: /Make main/ })).toBeInTheDocument();
  });

  it("makes the selected photo the main one by sending the new order", async () => {
    const { calls } = mockApi({ ...detailRoutes(), "PUT /products/:id/images/order": { data: [third, first, second] } });
    renderRoute(`/products/${product.id}`);

    await userEvent.click(await screen.findByRole("button", { name: "Photo 3" }));
    await userEvent.click(screen.getByRole("button", { name: /Make main/ }));

    await waitFor(() => {
      const put = calls.find((c) => c.method === "PUT")!;
      expect(put.path).toBe(`/products/${product.id}/images/order`);
      expect(put.body).toEqual({ imageIds: [third.id, first.id, second.id] });
    });
  });

  it("deletes a photo only after confirmation", async () => {
    const { calls } = mockApi({ ...detailRoutes(), "DELETE /products/:id/images/:imageId": () => jsonResponse(null, 204) });
    renderRoute(`/products/${product.id}`);

    await userEvent.click(await screen.findByRole("button", { name: "Photo 2" }));
    await userEvent.click(screen.getByRole("button", { name: /Delete photo/ }));

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Delete this photo?")).toBeInTheDocument();
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);

    await userEvent.click(within(dialog).getByRole("button", { name: "Delete photo" }));
    await waitFor(() => expect(calls.find((c) => c.method === "DELETE")?.path).toBe(`/products/${product.id}/images/${second.id}`));
  });

  it("resizes and uploads each chosen photo, then reloads the product", async () => {
    const { calls } = mockApi({ ...detailRoutes(productFixture()), "POST /products/:id/images": () => jsonResponse({ data: imageFixture(1) }, 201) });
    renderRoute(`/products/${product.id}`);

    expect(await screen.findByText(`0 / ${MAX_IMAGES_PER_PRODUCT} photos`)).toBeInTheDocument();
    await userEvent.upload(screen.getByLabelText("Choose photos"), [photo("IMG_0001.jpg"), photo("IMG_0002.jpg")]);

    expect(await screen.findByText("2 photos added.")).toBeInTheDocument();
    expect(prepareImage).toHaveBeenCalledTimes(2);

    const uploads = calls.filter((c) => c.method === "POST" && c.path === `/products/${product.id}/images`);
    expect(uploads).toHaveLength(2);
    const form = uploads[0]!.body as FormData;
    expect(form.get("image")).toBeInstanceOf(Blob);
    expect(form.get("thumbnail")).toBeInstanceOf(Blob);
    expect(uploads[0]!.headers["X-Requested-With"]).toBe("fetch");
    // The browser must set the multipart boundary itself.
    expect(uploads[0]!.headers["Content-Type"]).toBeUndefined();
    // Product reloaded after uploading (initial load + refresh).
    expect(calls.filter((c) => c.method === "GET" && c.path === `/products/${product.id}`).length).toBeGreaterThanOrEqual(2);
  });

  it("reports files that could not be added and still uploads the others", async () => {
    vi.mocked(prepareImage).mockImplementation(async (file: File) => {
      if (file.name === "notes.jpg") throw new ImageDecodeError(file.name);
      return { full: new Blob(["f"]), thumbnail: new Blob(["t"]), width: 10, height: 10 };
    });
    let uploadCount = 0;
    mockApi({
      ...detailRoutes(productFixture()),
      "POST /products/:id/images": () => {
        uploadCount += 1;
        return uploadCount === 2
          ? errorResponse(413, "IMAGE_TOO_LARGE", "The photo is larger than 5120 KB")
          : jsonResponse({ data: imageFixture(1) }, 201);
      },
    });
    renderRoute(`/products/${product.id}`);
    await screen.findByText(`0 / ${MAX_IMAGES_PER_PRODUCT} photos`);

    await userEvent.upload(screen.getByLabelText("Choose photos"), [photo("good.jpg"), photo("notes.jpg"), photo("huge.jpg")]);

    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("1 added, 2 could not be added")).toBeInTheDocument();
    expect(within(alert).getByText(/is not a photo this browser can open/)).toBeInTheDocument();
    expect(within(alert).getByText(/larger than 5120 KB/)).toBeInTheDocument();
  });

  it("stops offering uploads at the per-product limit", async () => {
    const full = productFixture({ images: Array.from({ length: MAX_IMAGES_PER_PRODUCT }, (_, i) => imageFixture(i + 1)) });
    mockApi(detailRoutes(full));
    renderRoute(`/products/${product.id}`);

    expect(await screen.findByText(`${MAX_IMAGES_PER_PRODUCT} / ${MAX_IMAGES_PER_PRODUCT} photos`)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Add photos/ })).toBeDisabled();
  });
});
