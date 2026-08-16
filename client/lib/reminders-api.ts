import { apiFetch } from './api.js';
import { ApiError, NetworkError } from './api-error.js';

export interface Reminder {
  id:            string;
  createdAt:     string;
  updatedAt:     string;
  deletedAt:     string | null;
  schemaVersion: number;
  contactId:     string;
  dueAt:         string;
  status:        'pending' | 'done';
  note:          string | null;
}

export interface ReminderListResponse { reminders: Reminder[]; }
export interface ReminderResponse     { reminder: Reminder; }

export interface CreateReminderInput {
  contactId: string;
  dueAt:     string;  // UTC ISO 8601 with Z — client converts datetime-local before calling
  note?:     string | null;
}

export function fetchReminders(): Promise<ReminderListResponse> {
  return apiFetch<ReminderListResponse>('/api/reminders');
}

export function createReminder(input: CreateReminderInput): Promise<ReminderResponse> {
  return apiFetch<ReminderResponse>('/api/reminders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export function markReminderDone(id: string): Promise<ReminderResponse> {
  return apiFetch<ReminderResponse>(`/api/reminders/${id}/done`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
}

// DELETE returns 204 with no body — use raw fetch like deleteInteraction/deleteContact.
export async function deleteReminder(id: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`/api/reminders/${id}`, { method: 'DELETE' });
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
            url: `/api/reminders/${id}`,
          },
          null,
          2
        )}\n--- END DEBUG BLOCK ---`,
    });
  }
}
