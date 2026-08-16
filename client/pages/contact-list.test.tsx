// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import { ContactList } from './contact-list.js';
import { ErrorBoundary } from '../components/error-boundary.js';
import type { Contact } from '../lib/contacts-api.js';

vi.mock('../lib/contacts-api.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/contacts-api.js')>();
  return { ...actual, fetchContacts: vi.fn() };
});

import { fetchContacts, TIER_LABELS } from '../lib/contacts-api.js';

function makeContact(overrides: Partial<Contact> = {}): Contact {
  return {
    id: crypto.randomUUID(),
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    deletedAt: null,
    schemaVersion: 1,
    name: 'Test Contact',
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

function renderList() {
  return render(
    <MemoryRouter>
      <ContactList />
    </MemoryRouter>
  );
}

describe('ContactList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders empty state when no contacts exist', async () => {
    vi.mocked(fetchContacts).mockResolvedValue({ contacts: [] });

    renderList();

    await screen.findByText('No contacts yet. Create your first contact.');
  });

  it('renders a list of contacts', async () => {
    const alice = makeContact({ name: 'Alice', company: 'Acme', email: 'alice@example.com' });
    const bob = makeContact({ name: 'Bob', company: null, email: null });
    vi.mocked(fetchContacts).mockResolvedValue({ contacts: [alice, bob] });

    renderList();

    await screen.findByText('Alice');
    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(screen.getByText('Acme')).toBeInTheDocument();
    expect(screen.getByText('alice@example.com')).toBeInTheDocument();
  });

  it('displays preferredName instead of name when set', async () => {
    const contact = makeContact({ name: 'Gregory', preferredName: 'Greg' });
    vi.mocked(fetchContacts).mockResolvedValue({ contacts: [contact] });

    renderList();

    await screen.findByText('Greg');
    expect(screen.queryByText('Gregory')).not.toBeInTheDocument();
  });

  it('row links point to /contacts/:id', async () => {
    const contact = makeContact({ name: 'Alice' });
    vi.mocked(fetchContacts).mockResolvedValue({ contacts: [contact] });

    renderList();

    const link = await screen.findByRole('link', { name: 'Alice' });
    expect(link).toHaveAttribute('href', `/contacts/${contact.id}`);
  });

  it('filters contacts by search query (name match)', async () => {
    const alice = makeContact({ name: 'Alice' });
    const bob = makeContact({ name: 'Bob' });
    vi.mocked(fetchContacts).mockResolvedValue({ contacts: [alice, bob] });

    renderList();

    await screen.findByText('Alice');

    const input = screen.getByRole('textbox', { name: /search/i });
    fireEvent.change(input, { target: { value: 'ali' } });

    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.queryByText('Bob')).not.toBeInTheDocument();
  });

  it('filters contacts by company', async () => {
    const alice = makeContact({ name: 'Alice', company: 'Acme' });
    const bob = makeContact({ name: 'Bob', company: 'Globex' });
    vi.mocked(fetchContacts).mockResolvedValue({ contacts: [alice, bob] });

    renderList();

    await screen.findByText('Alice');

    fireEvent.change(screen.getByRole('textbox', { name: /search/i }), {
      target: { value: 'acme' },
    });

    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.queryByText('Bob')).not.toBeInTheDocument();
  });

  it('filters contacts by email', async () => {
    const alice = makeContact({ name: 'Alice', email: 'alice@acme.com' });
    const bob = makeContact({ name: 'Bob', email: 'bob@globex.com' });
    vi.mocked(fetchContacts).mockResolvedValue({ contacts: [alice, bob] });

    renderList();

    await screen.findByText('Alice');

    fireEvent.change(screen.getByRole('textbox', { name: /search/i }), {
      target: { value: 'acme' },
    });

    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.queryByText('Bob')).not.toBeInTheDocument();
  });

  it('search is case-insensitive', async () => {
    const contact = makeContact({ name: 'Alice' });
    vi.mocked(fetchContacts).mockResolvedValue({ contacts: [contact] });

    renderList();

    await screen.findByText('Alice');

    fireEvent.change(screen.getByRole('textbox', { name: /search/i }), {
      target: { value: 'ALICE' },
    });

    expect(screen.getByText('Alice')).toBeInTheDocument();
  });

  it('shows "no results" state when filter matches nothing', async () => {
    const contact = makeContact({ name: 'Alice' });
    vi.mocked(fetchContacts).mockResolvedValue({ contacts: [contact] });

    renderList();

    await screen.findByText('Alice');

    fireEvent.change(screen.getByRole('textbox', { name: /search/i }), {
      target: { value: 'zzz' },
    });

    await waitFor(() => {
      expect(screen.queryByText('Alice')).not.toBeInTheDocument();
    });
    expect(screen.getByText(/no results/i)).toBeInTheDocument();
  });

  it('does not search notes field', async () => {
    const contact = makeContact({ name: 'Alice', notes: 'secret-keyword' });
    vi.mocked(fetchContacts).mockResolvedValue({ contacts: [contact] });

    renderList();

    await screen.findByText('Alice');

    fireEvent.change(screen.getByRole('textbox', { name: /search/i }), {
      target: { value: 'secret-keyword' },
    });

    expect(screen.queryByText('Alice')).not.toBeInTheDocument();
    expect(screen.getByText(/no results/i)).toBeInTheDocument();
  });

  it('shows loading state while fetching', () => {
    vi.mocked(fetchContacts).mockImplementation(() => new Promise(() => {}));

    renderList();

    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('"New Contact" link points to /contacts/new', async () => {
    vi.mocked(fetchContacts).mockResolvedValue({ contacts: [] });

    renderList();

    await screen.findByText(/new contact/i);

    const link = screen.getByRole('link', { name: /new contact/i });
    expect(link).toHaveAttribute('href', '/contacts/new');
  });

  it('propagates non-404 fetch errors to ErrorBoundary', async () => {
    const err = new Error('Network failure');
    vi.mocked(fetchContacts).mockRejectedValue(err);

    // Suppress React error boundary console output and mock the log-client-error fetch call
    const originalError = console.error;
    console.error = vi.fn();
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({ ok: true } as Response);

    render(
      <MemoryRouter>
        <ErrorBoundary>
          <ContactList />
        </ErrorBoundary>
      </MemoryRouter>
    );

    await screen.findByText('Something went wrong');

    console.error = originalError;
    global.fetch = originalFetch;
  });

  describe('tier badge', () => {
    it('shows tier badge with correct label for a tiered contact', async () => {
      const contact = makeContact({ name: 'Alice', tier: 'inner_circle' });
      vi.mocked(fetchContacts).mockResolvedValue({ contacts: [contact] });
      renderList();
      await screen.findByText('Alice');
      // Use class selector so the assertion targets the badge element, not the
      // filter <select> option which also contains the tier label text.
      const badge = document.querySelector('.tier-badge--inner_circle');
      expect(badge).not.toBeNull();
      expect(badge?.textContent).toBe(TIER_LABELS['inner_circle']);
    });

    it('shows no tier badge for an untiered contact', async () => {
      const contact = makeContact({ name: 'Bob', tier: null });
      vi.mocked(fetchContacts).mockResolvedValue({ contacts: [contact] });
      renderList();
      await screen.findByText('Bob');
      // queryByText would find the filter <option> elements; check badge class instead.
      expect(document.querySelector('.tier-badge')).toBeNull();
    });
  });

  describe('tier filter', () => {
    function setTierFilter(value: string) {
      fireEvent.change(screen.getByRole('combobox', { name: /filter by tier/i }), {
        target: { value },
      });
    }

    it('"All" (default) shows all contacts', async () => {
      vi.mocked(fetchContacts).mockResolvedValue({
        contacts: [
          makeContact({ name: 'Alice', tier: 'inner_circle' }),
          makeContact({ name: 'Bob', tier: 'active' }),
          makeContact({ name: 'Carol', tier: null }),
        ],
      });
      renderList();
      await screen.findByText('Alice');
      expect(screen.getByText('Bob')).toBeInTheDocument();
      expect(screen.getByText('Carol')).toBeInTheDocument();
    });

    it('"Inner Circle" filter shows only inner_circle contacts', async () => {
      vi.mocked(fetchContacts).mockResolvedValue({
        contacts: [
          makeContact({ name: 'Alice', tier: 'inner_circle' }),
          makeContact({ name: 'Bob', tier: 'active' }),
        ],
      });
      renderList();
      await screen.findByText('Alice');
      setTierFilter('inner_circle');
      expect(screen.getByText('Alice')).toBeInTheDocument();
      expect(screen.queryByText('Bob')).not.toBeInTheDocument();
    });

    it('"Active" filter shows only active contacts', async () => {
      vi.mocked(fetchContacts).mockResolvedValue({
        contacts: [
          makeContact({ name: 'Alice', tier: 'active' }),
          makeContact({ name: 'Bob', tier: 'dormant' }),
        ],
      });
      renderList();
      await screen.findByText('Alice');
      setTierFilter('active');
      expect(screen.getByText('Alice')).toBeInTheDocument();
      expect(screen.queryByText('Bob')).not.toBeInTheDocument();
    });

    it('"Dormant" filter shows only dormant contacts', async () => {
      vi.mocked(fetchContacts).mockResolvedValue({
        contacts: [
          makeContact({ name: 'Alice', tier: 'dormant' }),
          makeContact({ name: 'Bob', tier: 'active' }),
        ],
      });
      renderList();
      await screen.findByText('Alice');
      setTierFilter('dormant');
      expect(screen.getByText('Alice')).toBeInTheDocument();
      expect(screen.queryByText('Bob')).not.toBeInTheDocument();
    });

    it('"Untiered" filter shows only contacts with tier null', async () => {
      vi.mocked(fetchContacts).mockResolvedValue({
        contacts: [
          makeContact({ name: 'Alice', tier: null }),
          makeContact({ name: 'Bob', tier: 'active' }),
        ],
      });
      renderList();
      await screen.findByText('Alice');
      setTierFilter('untiered');
      expect(screen.getByText('Alice')).toBeInTheDocument();
      expect(screen.queryByText('Bob')).not.toBeInTheDocument();
    });

    it('tier filter composes with text search as a genuine intersection', async () => {
      // Text filter alone: "alice" matches both Alice Smith (active) and Alice Jones (inner_circle).
      // Tier filter alone: "active" matches Alice Smith and Bob (active).
      // Intersection: only Alice Smith matches both.
      vi.mocked(fetchContacts).mockResolvedValue({
        contacts: [
          makeContact({ name: 'Alice Smith', tier: 'active' }),
          makeContact({ name: 'Alice Jones', tier: 'inner_circle' }),
          makeContact({ name: 'Bob Active', tier: 'active' }),
        ],
      });
      renderList();
      await screen.findByText('Alice Smith');

      fireEvent.change(screen.getByRole('textbox', { name: /search/i }), {
        target: { value: 'alice' },
      });
      setTierFilter('active');

      expect(screen.getByText('Alice Smith')).toBeInTheDocument();
      // Excluded by tier filter (inner_circle, not active):
      expect(screen.queryByText('Alice Jones')).not.toBeInTheDocument();
      // Excluded by text filter (no "alice" in name):
      expect(screen.queryByText('Bob Active')).not.toBeInTheDocument();
    });
  });
});
