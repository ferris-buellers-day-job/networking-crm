// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ContactDetail } from './contact-detail.js';
import { ApiError } from '../lib/api-error.js';
import type { Contact } from '../lib/contacts-api.js';

vi.mock('../lib/contacts-api.js', () => ({
  getContact: vi.fn(),
}));

import { getContact } from '../lib/contacts-api.js';

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
    ...overrides,
  };
}

function renderDetail(id = TEST_ID) {
  return render(
    <MemoryRouter initialEntries={[`/contacts/${id}`]}>
      <Routes>
        <Route path="/contacts/:id" element={<ContactDetail />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('ContactDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders contact name as heading', async () => {
    vi.mocked(getContact).mockResolvedValue({ contact: makeContact() });

    renderDetail();

    await screen.findByRole('heading', { name: 'Alice Smith' });
  });

  it('renders preferredName as heading when set', async () => {
    vi.mocked(getContact).mockResolvedValue({
      contact: makeContact({ name: 'Gregory Allen', preferredName: 'Greg' }),
    });

    renderDetail();

    await screen.findByRole('heading', { name: 'Greg' });
    expect(screen.getByText('Gregory Allen')).toBeInTheDocument();
  });

  it('renders all populated fields', async () => {
    vi.mocked(getContact).mockResolvedValue({
      contact: makeContact({
        title: 'Product Manager',
        company: 'Acme Corp',
        email: 'alice@acme.com',
        notes: 'Met at conference',
      }),
    });

    renderDetail();

    await screen.findByText('Product Manager');
    expect(screen.getByText('Acme Corp')).toBeInTheDocument();
    expect(screen.getByText('alice@acme.com')).toBeInTheDocument();
    expect(screen.getByText('Met at conference')).toBeInTheDocument();
  });

  it('renders LinkedIn URL as clickable link opening in new tab', async () => {
    vi.mocked(getContact).mockResolvedValue({
      contact: makeContact({ linkedinUrl: 'https://linkedin.com/in/alice' }),
    });

    renderDetail();

    const link = await screen.findByRole('link', { name: 'https://linkedin.com/in/alice' });
    expect(link).toHaveAttribute('href', 'https://linkedin.com/in/alice');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('formats US phone in national format when defaultCountry is US', async () => {
    vi.mocked(getContact).mockResolvedValue({
      contact: makeContact({ phone: '+14155551234', defaultCountry: 'US' }),
    });

    renderDetail();

    await screen.findByText('(415) 555-1234');
  });

  it('formats non-US phone in international format when defaultCountry is US', async () => {
    vi.mocked(getContact).mockResolvedValue({
      contact: makeContact({ phone: '+442079460958', defaultCountry: 'US' }),
    });

    renderDetail();

    await screen.findByText('+44 20 7946 0958');
  });

  it('formats UK phone in national format when defaultCountry is GB', async () => {
    vi.mocked(getContact).mockResolvedValue({
      contact: makeContact({ phone: '+442079460958', defaultCountry: 'GB' }),
    });

    renderDetail();

    // UK national format for a London number
    await waitFor(() => {
      expect(screen.getByText(/020 7946 0958/)).toBeInTheDocument();
    });
  });

  it('renders "Edit" link pointing to /contacts/:id/edit', async () => {
    vi.mocked(getContact).mockResolvedValue({ contact: makeContact() });

    renderDetail();

    const editLink = await screen.findByRole('link', { name: /edit/i });
    expect(editLink).toHaveAttribute('href', `/contacts/${TEST_ID}/edit`);
  });

  it('shows inline "Contact not found" for ApiError 404 — does not propagate', async () => {
    vi.mocked(getContact).mockRejectedValue(
      new ApiError('Contact not found', {
        type: 'NotFound',
        statusCode: 404,
        debugBlock: '',
      })
    );

    renderDetail();

    await screen.findByText(/contact not found/i);
    const backLink = screen.getByRole('link', { name: /back to contacts/i });
    expect(backLink).toHaveAttribute('href', '/contacts');
  });

  it('shows loading state while fetching', () => {
    vi.mocked(getContact).mockImplementation(() => new Promise(() => {}));

    renderDetail();

    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });
});
