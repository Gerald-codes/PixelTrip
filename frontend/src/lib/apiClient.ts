/**
 * FastAPI HTTP client.
 *
 * The single place the frontend talks to the FastAPI backend. Only the real
 * service implementations (`src/services/*.api.ts`) may import it; UI code
 * (`app/`, `src/features`, `src/components`) must never import this module.
 *
 * Requests and responses are JSON with camelCase fields. Failures always surface
 * as {@link ApiError}: backend errors keep their envelope `code`
 * (`{ "error": { "code", "message" } }`, see `api-contracts.md`), and transport
 * failures use `NETWORK_ERROR` / `UNEXPECTED_RESPONSE`.
 */
import { ApiError, type ApiErrorCode } from "./errors";

/** Public base URL for the FastAPI backend. */
export const API_BASE_URL_ENV = "NEXT_PUBLIC_API_BASE_URL";

const DEFAULT_API_BASE_URL = "http://localhost:8000";

export interface ApiClient {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body: unknown): Promise<T>;
  put<T>(path: string, body: unknown): Promise<T>;
}

function apiBaseUrl(): string {
  const raw = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();
  return (raw ? raw : DEFAULT_API_BASE_URL).replace(/\/+$/, "");
}

/** Read the backend error envelope, or `null` if the body is not one. */
function parseErrorEnvelope(
  body: unknown,
): { code: string; message: string } | null {
  if (typeof body !== "object" || body === null || !("error" in body)) {
    return null;
  }
  const error = (body as { error: unknown }).error;
  if (
    typeof error === "object" &&
    error !== null &&
    typeof (error as { code?: unknown }).code === "string" &&
    typeof (error as { message?: unknown }).message === "string"
  ) {
    return error as { code: string; message: string };
  }
  return null;
}

async function request<T>(
  method: "GET" | "POST" | "PUT",
  path: string,
  body?: unknown,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl()}${path}`, {
      method,
      headers:
        body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError("NETWORK_ERROR", "Could not reach the backend.", null);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = undefined;
  }

  if (!response.ok) {
    const envelope = parseErrorEnvelope(payload);
    if (envelope) {
      throw new ApiError(
        envelope.code as ApiErrorCode,
        envelope.message,
        response.status,
      );
    }
    throw new ApiError(
      "UNEXPECTED_RESPONSE",
      `Backend responded with HTTP ${response.status}.`,
      response.status,
    );
  }

  if (payload === undefined) {
    throw new ApiError(
      "UNEXPECTED_RESPONSE",
      "Backend response was not valid JSON.",
      response.status,
    );
  }
  return payload as T;
}

const apiClient: ApiClient = {
  get: (path) => request("GET", path),
  post: (path, body) => request("POST", path, body),
  put: (path, body) => request("PUT", path, body),
};

/** Return the FastAPI HTTP client bound to `NEXT_PUBLIC_API_BASE_URL`. */
export function getApiClient(): ApiClient {
  return apiClient;
}
