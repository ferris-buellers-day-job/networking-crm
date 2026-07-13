// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ResolveInboxModal } from './resolve-inbox-modal.js';
import { ErrorBoundary } from './error-boundary.js';
import { ApiError } from '../lib/api-error.js';
import type { InboxEntry } from '../lib/inbox-api.js';
import type { Contact } from '../lib/contacts-api.js';

vi.mock('../lib/inbox-api.js', () => ({
  resolveInboxEntry: vi.fn(),
  fetchInboxQueue: vi.fn(),
  processInbox: vi.fn(),
  discardInboxEntry: vi.fn(),
}));

vi.mock('../lib/contacts-api.js', () => ({
  fetchContacts: vi.fn(),
  getContact: vi.fn(),
  createContact: vi.fn(),
  updateContact: vi.fn(),
  deleteContact: vi.fn(),
}));

import { resolveInboxEntry } from '../lib/inbox-api.js';
import { fetchContacts } from '../lib/contacts-api.js';

const ENTRY_ID = 'eeeeeeee-0000-0000-0000-000000000001';
const CONTACT_ID_A = 'cccccccc-0000-0000-0000-000000000001';
const CONTACT_ID_B = 'cccccccc-0000-0000-0000-000000000002';

function makeContact(overrides: Partial<Contact> = {}): Contact {
  return {
    id: CONTACT_ID_A,
    createdAt: '2026-07-12T00:00:00.000Z',
    updatedAt: '2026-07-12T00:00:00.000Z',
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

function makeResolvedEntry(): InboxEntry {
  return {
    id: ENTRY_ID,
    createdAt: '2026-07-12T10:00:00.000Z',
    updatedAt: '2026-07-12T10:00:00.000Z',
    deletedAt: null,
    schemaVersion: 1,
    rawId: 'a3f7c2b1',
    rawText: '---\nid: a3f7c2b1\n---',
    status: 'resolved',
    matchState: 'unmatched',
    parsedDate: '2026-07-12T17:30:00.000Z',
    parsedContact: 'alice smith',
    parsedType: 'meeting',
    parsedSummary: null,
    parsedLocation: null,
    parseError: null,
    candidateContactIds: [],
    candidateContacts: [],
    contactId: CONTACT_ID_A,
    interactionId: 'iiiiiiii-0000-0000-0000-000000000001',
  };
}

const originalConsoleError = console.error;

beforeEach(() => {
  vi.clearAllMocks();
  console.error = vi.fn();
  global.fetch = vi.fn().mockResolvedValue({ ok: true });
  vi.mocked(fetchContacts).mockResolvedValue({ contacts: [makeContact()] });
});

afterEach(() => {
  console.error = originalConsoleError;
});

function renderModal(props: Partial<Parameters<typeof ResolveInboxModal>[0]> = {}) {
  return render(
    <ResolveInboxModal
      entryId={ENTRY_ID}
      isOpen={true}
      onClose={vi.fn()}
      onResolved={vi.fn()}
      {...props}
    />
  );
}

describe('ResolveInboxModal', () => {
  it('does not render when isOpen is false', () => {
    renderModal({ isOpen: false });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders the dialog when isOpen is true', async () => {
    renderModal();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await waitFor(() => expect(fetchContacts).toHaveBeenCalledOnce());
  });

  it('fetches contacts when modal opens', async () => {
    const { rerender } = render(
      <ResolveInboxModal entryId={ENTRY_ID} isOpen={false} onClose={vi.fn()} onResolved={vi.fn()} />
    );
    expect(fetchContacts).not.toHaveBeenCalled();

    rerender(
      <ResolveInboxModal entryId={ENTRY_ID} isOpen={true} onClose={vi.fn()} onResolved={vi.fn()} />
    );
    await waitFor(() => expect(fetchContacts).toHaveBeenCalledOnce());
  });

  it('Cancel button receives initial focus when modal opens', () => {
    renderModal();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
  });

  it('Cancel button calls onClose without submitting', () => {
    const onClose = vi.fn();
    renderModal({ onClose });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(resolveInboxEntry).not.toHaveBeenCalled();
  });

  it('ESC calls onClose without submitting', () => {
    const onClose = vi.fn();
    renderModal({ onClose });
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
    expect(resolveInboxEntry).not.toHaveBeenCalled();
  });

  describe('contact search and selection', () => {
    it('shows filtered results as user types', async () => {
      vi.mocked(fetchContacts).mockResolvedValue({
        contacts: [
          makeContact({ id: CONTACT_ID_A, name: 'Alice Smith' }),
          makeContact({ id: CONTACT_ID_B, name: 'Bob Jones' }),
        ],
      });

      renderModal();
      await waitFor(() => expect(fetchContacts).toHaveBeenCalled());

      fireEvent.change(screen.getByLabelText('Search contacts'), { target: { value: 'alice' } });

      expect(screen.getByRole('button', { name: 'Alice Smith' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Bob Jones' })).not.toBeInTheDocument();
    });

    it('matches against preferredName', async () => {
      vi.mocked(fetchContacts).mockResolvedValue({
        contacts: [makeContact({ name: 'Robert Jones', preferredName: 'Bob' })],
      });

      renderModal();
      await waitFor(() => expect(fetchContacts).toHaveBeenCalled());

      fireEvent.change(screen.getByLabelText('Search contacts'), { target: { value: 'bob' } });

      expect(screen.getByRole('button', { name: /Bob.*Robert Jones/i })).toBeInTheDocument();
    });

    it('clicking a result selects the contact and enables Submit', async () => {
      renderModal();
      await waitFor(() => expect(fetchContacts).toHaveBeenCalled());

      fireEvent.change(screen.getByLabelText('Search contacts'), { target: { value: 'alice' } });
      fireEvent.click(screen.getByRole('button', { name: 'Alice Smith' }));

      expect(screen.getByText(/Selected:/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Resolve' })).not.toBeDisabled();
    });

    it('pressing Enter in search input selects first filtered result and enables Submit', async () => {
      vi.mocked(fetchContacts).mockResolvedValue({
        contacts: [
          makeContact({ id: CONTACT_ID_A, name: 'Alice Smith' }),
          makeContact({ id: CONTACT_ID_B, name: 'Alice Brown' }),
        ],
      });

      renderModal();
      await waitFor(() => expect(fetchContacts).toHaveBeenCalled());

      const searchInput = screen.getByLabelText('Search contacts');
      fireEvent.change(searchInput, { target: { value: 'alice' } });

      // Both results show; Enter selects first
      fireEvent.keyDown(searchInput, { key: 'Enter' });

      expect(screen.getByText(/Selected:/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Resolve' })).not.toBeDisabled();
    });

    it('typing after a selection clears it', async () => {
      renderModal();
      await waitFor(() => expect(fetchContacts).toHaveBeenCalled());

      fireEvent.change(screen.getByLabelText('Search contacts'), { target: { value: 'alice' } });
      fireEvent.click(screen.getByRole('button', { name: 'Alice Smith' }));
      expect(screen.getByText(/Selected:/)).toBeInTheDocument();

      fireEvent.change(screen.getByLabelText('Search contacts'), { target: { value: 'alic' } });
      expect(screen.queryByText(/Selected:/)).not.toBeInTheDocument();
    });

    it('Submit is disabled when no contact is selected', async () => {
      renderModal();
      await waitFor(() => expect(fetchContacts).toHaveBeenCalled());
      expect(screen.getByRole('button', { name: 'Resolve' })).toBeDisabled();
    });
  });

  describe('form submission', () => {
    it('calls resolveInboxEntry with entryId and selected contactId, then calls onResolved', async () => {
      const resolvedEntry = makeResolvedEntry();
      vi.mocked(resolveInboxEntry).mockResolvedValue({ entry: resolvedEntry });
      const onResolved = vi.fn();

      renderModal({ onResolved });
      await waitFor(() => expect(fetchContacts).toHaveBeenCalled());

      fireEvent.change(screen.getByLabelText('Search contacts'), { target: { value: 'alice' } });
      fireEvent.click(screen.getByRole('button', { name: 'Alice Smith' }));
      fireEvent.click(screen.getByRole('button', { name: 'Resolve' }));

      await waitFor(() => expect(onResolved).toHaveBeenCalledWith(resolvedEntry));
      expect(resolveInboxEntry).toHaveBeenCalledWith(ENTRY_ID, CONTACT_ID_A);
    });

    it('ApiError 400 shows inline error — modal stays open', async () => {
      vi.mocked(resolveInboxEntry).mockRejectedValue(
        new ApiError('Contact not found or deleted', {
          type: 'ValidationError',
          statusCode: 400,
          debugBlock: '--- DEBUG BLOCK ---\n{}\n--- END DEBUG BLOCK ---',
        })
      );

      renderModal();
      await waitFor(() => expect(fetchContacts).toHaveBeenCalled());

      fireEvent.change(screen.getByLabelText('Search contacts'), { target: { value: 'alice' } });
      fireEvent.click(screen.getByRole('button', { name: 'Alice Smith' }));
      fireEvent.click(screen.getByRole('button', { name: 'Resolve' }));

      await screen.findByText('Contact not found or deleted');
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('non-400 error propagates to ErrorBoundary', async () => {
      vi.mocked(resolveInboxEntry).mockRejectedValue(
        new ApiError('Storage failure', {
          type: 'StorageError',
          statusCode: 500,
          debugBlock: '--- DEBUG BLOCK ---\n{}\n--- END DEBUG BLOCK ---',
        })
      );

      render(
        <ErrorBoundary>
          <ResolveInboxModal
            entryId={ENTRY_ID}
            isOpen={true}
            onClose={vi.fn()}
            onResolved={vi.fn()}
          />
        </ErrorBoundary>
      );

      await waitFor(() => expect(fetchContacts).toHaveBeenCalled());

      fireEvent.change(screen.getByLabelText('Search contacts'), { target: { value: 'alice' } });
      fireEvent.click(screen.getByRole('button', { name: 'Alice Smith' }));
      fireEvent.click(screen.getByRole('button', { name: 'Resolve' }));

      await screen.findByText('Something went wrong');
    });
  });
});
