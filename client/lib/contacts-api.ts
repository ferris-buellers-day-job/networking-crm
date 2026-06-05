import { apiFetch } from './api.js';

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
