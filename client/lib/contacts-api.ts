import { apiFetch } from './api.js';
import { ApiError, NetworkError } from './api-error.js';

export interface Contact {
  id: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  schemaVersion: number;
  name: string;
  preferredName: string | null;
  linkedinUrl: string | null;
  phone: string | null;
  defaultCountry: string | null;
  email: string | null;
  company: string | null;
  title: string | null;
  notes: string | null;
}

export interface ContactListResponse {
  contacts: Contact[];
}

export interface ContactResponse {
  contact: Contact;
}

export function fetchContacts(): Promise<ContactListResponse> {
  return apiFetch<ContactListResponse>('/api/contacts');
}

export function getContact(id: string): Promise<ContactResponse> {
  return apiFetch<ContactResponse>(`/api/contacts/${id}`);
}

export interface ContactInput {
  name: string;
  preferredName?: string | null;
  linkedinUrl?: string | null;
  phone?: string | null;
  defaultCountry?: string | null;
  email?: string | null;
  company?: string | null;
  title?: string | null;
  notes?: string | null;
}

export function createContact(input: ContactInput): Promise<ContactResponse> {
  return apiFetch<ContactResponse>('/api/contacts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export function updateContact(id: string, input: Partial<ContactInput>): Promise<ContactResponse> {
  return apiFetch<ContactResponse>(`/api/contacts/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export async function deleteContact(id: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`/api/contacts/${id}`, { method: 'DELETE' });
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
      debugBlock: errorBody.error?.debugBlock ?? `--- DEBUG BLOCK ---\n${JSON.stringify({
        ts: new Date().toISOString(),
        error: 'UnknownError',
        message: `HTTP ${response.status}`,
        statusCode: response.status,
        url: `/api/contacts/${id}`,
      }, null, 2)}\n--- END DEBUG BLOCK ---`,
    });
  }
}
