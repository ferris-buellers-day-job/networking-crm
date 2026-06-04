import { ApiError, NetworkError } from './api-error.js';

/**
 * Server API error response format (per ADR 010).
 */
interface ApiErrorResponse {
  error: {
    type: string;
    message: string;
    debugBlock: string;
  };
}

/**
 * Fetch wrapper for API calls.
 *
 * - Parses JSON response
 * - On non-2xx, throws ApiError with debug block from server
 * - On network failure (fetch rejects), throws NetworkError
 * - Never silently swallows errors
 *
 * @param path - API path (e.g., '/api/health')
 * @param options - Standard fetch options
 * @returns Parsed JSON response
 */
export async function apiFetch<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  let response: Response;

  try {
    response = await fetch(path, options);
  } catch (err) {
    // Network error - request never completed
    throw new NetworkError(
      err instanceof Error ? err.message : 'Network request failed',
      err instanceof Error ? err : undefined
    );
  }

  if (!response.ok) {
    // Try to parse error response from server
    let errorData: ApiErrorResponse | null = null;
    try {
      errorData = (await response.json()) as ApiErrorResponse;
    } catch {
      // Server didn't return valid JSON error response
    }

    if (errorData?.error) {
      throw new ApiError(errorData.error.message, {
        type: errorData.error.type,
        statusCode: response.status,
        debugBlock: errorData.error.debugBlock,
      });
    }

    // Fallback for non-JSON error responses
    throw new ApiError(`HTTP ${response.status}`, {
      type: 'UnknownError',
      statusCode: response.status,
      debugBlock: `--- DEBUG BLOCK ---\n${JSON.stringify({
        ts: new Date().toISOString(),
        error: 'UnknownError',
        message: `HTTP ${response.status}`,
        statusCode: response.status,
        url: path,
      }, null, 2)}\n--- END DEBUG BLOCK ---`,
    });
  }

  return response.json() as Promise<T>;
}
