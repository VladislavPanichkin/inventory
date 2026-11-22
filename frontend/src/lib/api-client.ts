/**
 * Thin fetch wrapper for the backend REST API (/api/v1).
 *
 * - Same-origin requests (Vite proxies /api in dev), cookies included.
 * - Unwraps the standard error envelope into a typed ApiError.
 * - The frontend never talks to eBay; everything goes through this client.
 */

export const API_BASE = "/api/v1";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }

  get isNetworkError() {
    return this.status === 0;
  }

  get isUnauthorized() {
    return this.status === 401;
  }
}

/** Builds a query string, skipping empty values. */
export function toQueryString(params: Record<string, string | number | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

type ErrorEnvelope = { error: { code: string; message: string; details?: unknown; requestId?: string } };

function isErrorEnvelope(value: unknown): value is ErrorEnvelope {
  return (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof (value as ErrorEnvelope).error?.code === "string"
  );
}

export interface ApiRequestOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
  /** Non-2xx statuses whose JSON body should still be returned (e.g. 503 from /health). */
  acceptStatuses?: number[];
  /** Multipart upload (files). Mutually exclusive with `body`; the browser sets the Content-Type. */
  formData?: FormData;
}

export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const { body, formData, acceptStatuses = [], headers, ...init } = options;

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      credentials: "include",
      ...init,
      headers: {
        Accept: "application/json",
        // Required by the backend's CSRF guard on mutating requests (harmless on GETs).
        "X-Requested-With": "fetch",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...headers,
      },
      body: formData ?? (body === undefined ? undefined : JSON.stringify(body)),
    });
  } catch (error) {
    throw new ApiError(0, "NETWORK_ERROR", "Cannot reach the server. Check that the backend is running.", error);
  }

  const payload: unknown = response.status === 204 ? undefined : await response.json().catch(() => undefined);

  if (response.ok || acceptStatuses.includes(response.status)) {
    return payload as T;
  }
  if (isErrorEnvelope(payload)) {
    const { code, message, details, requestId } = payload.error;
    throw new ApiError(response.status, code, message, details, requestId);
  }
  throw new ApiError(response.status, "HTTP_ERROR", `Request failed with status ${response.status}`);
}
