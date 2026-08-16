// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ContactForm } from './contact-form.js';
import { ApiError } from '../lib/api-error.js';
import type { Contact } from '../lib/contacts-api.js';

vi.mock('../lib/contacts-api.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/contacts-api.js')>();
  return {
    ...actual,
    getContact: vi.fn(),
    createContact: vi.fn(),
    updateContact: vi.fn(),
  };
});

// Render a simple dropdown so tests aren't coupled to the full country list
vi.mock('../components/country-select.js', () => ({
  CountrySelect: ({ value, onChange, id }: { value: string | null; onChange: (v: string | null) => void; id?: string }) => (
    <select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">— Select country —</option>
      <option value="US">United States</option>
      <option value="GB">United Kingdom</option>
    </select>
  ),
}));

import { getContact, createContact, updateContact, TIER_LABELS } from '../lib/contacts-api.js';

const TEST_ID = 'aaaaaaaa-0000-0000-0000-000000000001';

function makeContact(overrides: Partial<Contact> = {}): Contact {
  return {
    id: TEST_ID,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    deletedAt: null,
    schemaVersion: 1,
    name: 'Alice Smith',
    preferredName: null,
    linkedinUrl: null,
    phone: null,
    defaultCountry: null,
    email: null,
    company: null,
    title: null,
    notes: null,
    tier: null,
    ...overrides,
  };
}

function renderCreate() {
  return render(
    <MemoryRouter initialEntries={['/contacts/new']}>
      <Routes>
        <Route path="/contacts/new" element={<ContactForm />} />
        <Route path="/contacts/:id" element={<div>Detail page</div>} />
      </Routes>
    </MemoryRouter>
  );
}

function renderEdit(id = TEST_ID) {
  return render(
    <MemoryRouter initialEntries={[`/contacts/${id}/edit`]}>
      <Routes>
        <Route path="/contacts/:id/edit" element={<ContactForm />} />
        <Route path="/contacts/:id" element={<div>Detail page</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('ContactForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders "New Contact" heading in create mode', () => {
    renderCreate();
    expect(screen.getByRole('heading', { name: 'New Contact' })).toBeInTheDocument();
  });

  it('renders "Edit Contact" heading in edit mode', async () => {
    vi.mocked(getContact).mockResolvedValue({ contact: makeContact() });
    renderEdit();
    await screen.findByRole('heading', { name: 'Edit Contact' });
  });

  it('populates fields from existing contact in edit mode', async () => {
    vi.mocked(getContact).mockResolvedValue({
      contact: makeContact({ name: 'Alice Smith', company: 'Acme', email: 'alice@acme.com' }),
    });
    renderEdit();
    await screen.findByRole('heading', { name: 'Edit Contact' });
    expect((screen.getByLabelText(/name \*/i) as HTMLInputElement).value).toBe('Alice Smith');
    expect((screen.getByLabelText(/company/i) as HTMLInputElement).value).toBe('Acme');
    expect((screen.getByLabelText(/email/i) as HTMLInputElement).value).toBe('alice@acme.com');
  });

  it('shows "Name is required" error when submitting empty name', async () => {
    renderCreate();
    fireEvent.click(screen.getByRole('button', { name: /create contact/i }));
    await screen.findByText('Name is required');
  });

  it('shows phone error on blur with invalid value', async () => {
    renderCreate();
    const phoneInput = screen.getByLabelText(/phone/i);
    fireEvent.change(phoneInput, { target: { value: 'not-a-phone' } });
    fireEvent.blur(phoneInput);
    await screen.findByText("Couldn't parse as phone number");
  });

  it('clears phone error on blur with empty value', async () => {
    renderCreate();
    const phoneInput = screen.getByLabelText(/phone/i);
    fireEvent.change(phoneInput, { target: { value: 'not-a-phone' } });
    fireEvent.blur(phoneInput);
    await screen.findByText("Couldn't parse as phone number");
    fireEvent.change(phoneInput, { target: { value: '' } });
    fireEvent.blur(phoneInput);
    await waitFor(() => {
      expect(screen.queryByText("Couldn't parse as phone number")).not.toBeInTheDocument();
    });
  });

  it('creates contact and navigates to detail page on success', async () => {
    vi.mocked(createContact).mockResolvedValue({ contact: makeContact({ id: TEST_ID }) });
    renderCreate();
    fireEvent.change(screen.getByLabelText(/name \*/i), { target: { value: 'Alice' } });
    fireEvent.click(screen.getByRole('button', { name: /create contact/i }));
    await screen.findByText('Detail page');
    expect(createContact).toHaveBeenCalledOnce();
  });

  it('updates contact and navigates to detail page on success', async () => {
    vi.mocked(getContact).mockResolvedValue({ contact: makeContact() });
    vi.mocked(updateContact).mockResolvedValue({ contact: makeContact() });
    renderEdit();
    await screen.findByRole('heading', { name: 'Edit Contact' });
    fireEvent.change(screen.getByLabelText(/name \*/i), { target: { value: 'Alice Updated' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    await screen.findByText('Detail page');
    expect(updateContact).toHaveBeenCalledOnce();
  });

  it('shows inline error for ApiError 400 from server', async () => {
    vi.mocked(createContact).mockRejectedValue(
      new ApiError("Couldn't parse as phone number", {
        type: 'ValidationError',
        statusCode: 400,
        debugBlock: '',
      })
    );
    renderCreate();
    fireEvent.change(screen.getByLabelText(/name \*/i), { target: { value: 'Alice' } });
    fireEvent.click(screen.getByRole('button', { name: /create contact/i }));
    await screen.findByText("Couldn't parse as phone number");
  });

  it('shows not-found state when edit target returns 404', async () => {
    vi.mocked(getContact).mockRejectedValue(
      new ApiError('Contact not found', {
        type: 'NotFound',
        statusCode: 404,
        debugBlock: '',
      })
    );
    renderEdit();
    await screen.findByText('Contact not found.');
    expect(screen.getByRole('link', { name: /back to contacts/i })).toBeInTheDocument();
  });

  it('Cancel link in create mode points to /contacts', () => {
    renderCreate();
    const link = screen.getByRole('link', { name: /cancel/i });
    expect(link).toHaveAttribute('href', '/contacts');
  });

  it('Cancel link in edit mode points to /contacts/:id', async () => {
    vi.mocked(getContact).mockResolvedValue({ contact: makeContact() });
    renderEdit();
    await screen.findByRole('heading', { name: 'Edit Contact' });
    const link = screen.getByRole('link', { name: /cancel/i });
    expect(link).toHaveAttribute('href', `/contacts/${TEST_ID}`);
  });

  describe('tier select', () => {
    it('renders tier select with (none), Inner Circle, Active, Dormant options', () => {
      renderCreate();
      const select = screen.getByLabelText(/tier/i);
      expect(select).toBeInTheDocument();
      expect(screen.getByRole('option', { name: '(none)' })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: TIER_LABELS['inner_circle'] })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: TIER_LABELS['active'] })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: TIER_LABELS['dormant'] })).toBeInTheDocument();
    });

    it('in create mode, submitting with (none) selected sends tier: null', async () => {
      vi.mocked(createContact).mockResolvedValue({ contact: makeContact() });
      renderCreate();
      fireEvent.change(screen.getByLabelText(/name \*/i), { target: { value: 'Alice' } });
      // tier select defaults to (none) — no change needed
      fireEvent.click(screen.getByRole('button', { name: /create contact/i }));
      await waitFor(() => expect(createContact).toHaveBeenCalledWith(
        expect.objectContaining({ tier: null })
      ));
    });

    it('in create mode, selecting Inner Circle sends tier: inner_circle', async () => {
      vi.mocked(createContact).mockResolvedValue({ contact: makeContact() });
      renderCreate();
      fireEvent.change(screen.getByLabelText(/name \*/i), { target: { value: 'Alice' } });
      fireEvent.change(screen.getByLabelText(/tier/i), { target: { value: 'inner_circle' } });
      fireEvent.click(screen.getByRole('button', { name: /create contact/i }));
      await waitFor(() => expect(createContact).toHaveBeenCalledWith(
        expect.objectContaining({ tier: 'inner_circle' })
      ));
    });

    it('in edit mode, tier select is pre-populated from contact tier', async () => {
      vi.mocked(getContact).mockResolvedValue({ contact: makeContact({ tier: 'active' }) });
      renderEdit();
      await screen.findByRole('heading', { name: 'Edit Contact' });
      const select = screen.getByLabelText(/tier/i) as HTMLSelectElement;
      expect(select.value).toBe('active');
    });

    it('in edit mode, changing tier and submitting sends updated tier', async () => {
      vi.mocked(getContact).mockResolvedValue({ contact: makeContact({ tier: 'active' }) });
      vi.mocked(updateContact).mockResolvedValue({ contact: makeContact({ tier: 'dormant' }) });
      renderEdit();
      await screen.findByRole('heading', { name: 'Edit Contact' });
      fireEvent.change(screen.getByLabelText(/tier/i), { target: { value: 'dormant' } });
      fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
      await waitFor(() => expect(updateContact).toHaveBeenCalledWith(
        TEST_ID,
        expect.objectContaining({ tier: 'dormant' })
      ));
    });

    it('in edit mode, selecting (none) sends tier: null to clear the tier', async () => {
      vi.mocked(getContact).mockResolvedValue({ contact: makeContact({ tier: 'active' }) });
      vi.mocked(updateContact).mockResolvedValue({ contact: makeContact({ tier: null }) });
      renderEdit();
      await screen.findByRole('heading', { name: 'Edit Contact' });
      fireEvent.change(screen.getByLabelText(/tier/i), { target: { value: '' } });
      fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
      await waitFor(() => expect(updateContact).toHaveBeenCalledWith(
        TEST_ID,
        expect.objectContaining({ tier: null })
      ));
    });
  });
});
