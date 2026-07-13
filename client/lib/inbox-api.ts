import { apiFetch } from './api.js';

export interface CandidateContact {
  id: string;
  name: string;
}

export interface InboxEntry {
  id: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  schemaVersion: number;
  rawId: string;
  rawText: string;
  status: 'pending' | 'resolved' | 'discarded';
  matchState: 'auto_matched' | 'ambiguous' | 'unmatched' | 'parse_error';
  parsedDate: string | null;
  parsedContact: string | null;
  parsedType: 'meeting' | 'call' | 'email' | 'message' | 'other' | null;
  parsedSummary: string | null;
  parsedLocation: string | null;
  parseError: string | null;
  candidateContactIds: string[];
  candidateContacts: CandidateContact[];
  contactId: string | null;
  interactionId: string | null;
}

export interface ProcessResult       { processed: number; queued: number; }
export interface InboxListResponse   { entries: InboxEntry[]; }
export interface InboxEntryResponse  { entry: InboxEntry; }

export function processInbox(): Promise<ProcessResult> {
  return apiFetch<ProcessResult>('/api/inbox/process', { method: 'POST' });
}

export function fetchInboxQueue(): Promise<InboxListResponse> {
  return apiFetch<InboxListResponse>('/api/inbox');
}

export function resolveInboxEntry(id: string, contactId: string): Promise<InboxEntryResponse> {
  return apiFetch<InboxEntryResponse>(`/api/inbox/${id}/resolve`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contactId }),
  });
}

export function discardInboxEntry(id: string): Promise<InboxEntryResponse> {
  return apiFetch<InboxEntryResponse>(`/api/inbox/${id}/discard`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
}
