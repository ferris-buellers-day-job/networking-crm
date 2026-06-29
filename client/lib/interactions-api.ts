import { apiFetch } from './api.js';
import { ApiError, NetworkError } from './api-error.js';

export interface Interaction {
  id: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  schemaVersion: number;
  contactId: string;
  occurredAt: string;
  type: 'meeting' | 'call' | 'email' | 'message' | 'other';
  summary: string | null;
  location: string | null;
}

export interface InteractionInput {
  contactId: string;
  occurredAt: string;
  type: Interaction['type'];
  summary?: string | null;
  location?: string | null;
}

export interface InteractionListResponse {
  interactions: Interaction[];
}

export interface InteractionResponse {
  interaction: Interaction;
}

export function fetchInteractions(contactId: string): Promise<InteractionListResponse> {
  return apiFetch<InteractionListResponse>(
    `/api/interactions?contactId=${encodeURIComponent(contactId)}`
  );
}

export function createInteraction(input: InteractionInput): Promise<InteractionResponse> {
  return apiFetch<InteractionResponse>('/api/interactions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export async function deleteInteraction(id: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`/api/interactions/${id}`, { method: 'DELETE' });
  } catch (err) {
    throw new NetworkError(
      err instanceof Error ? err.message : 'Network request failed',
      err instanceof Error ? err : undefined
    );
  }

  if (!response.ok) {
    let errorBody: { error?: { type?: string; message?: string; debugBlock?: string } } = {};
    try {
      errorBody = (await response.json()) as typeof errorBody;
    } catch (_e) {
      errorBody = {};
    }
    throw new ApiError(errorBody.error?.message ?? `HTTP ${response.status}`, {
      type: errorBody.error?.type ?? 'UnknownError',
      statusCode: response.status,
      debugBlock:
        errorBody.error?.debugBlock ??
        `--- DEBUG BLOCK ---\n${JSON.stringify(
          {
            ts: new Date().toISOString(),
            error: 'UnknownError',
            message: `HTTP ${response.status}`,
            statusCode: response.status,
            url: `/api/interactions/${id}`,
          },
          null,
          2
        )}\n--- END DEBUG BLOCK ---`,
    });
  }
}
