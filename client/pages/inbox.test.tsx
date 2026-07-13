// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import { InboxPage } from './inbox.js';
import { ErrorBoundary } from '../components/error-boundary.js';
import { ApiError } from '../lib/api-error.js';
import type { InboxEntry } from '../lib/inbox-api.js';

vi.mock('../lib/inbox-api.js', () => ({
  fetchInboxQueue: vi.fn(),
  processInbox:    vi.fn(),
  discardInboxEntry: vi.fn(),
  resolveInboxEntry: vi.fn(),
}));

// Mocked modal — exposes "Confirm resolve" button so integration tests can simulate resolution
vi.mock('../components/resolve-inbox-modal.js', () => ({
  ResolveInboxModal: ({
    isOpen,
    onResolved,
    onClose,
    entryId,
  }: {
    isOpen: boolean;
    onResolved: (e: InboxEntry) => void;
    onClose: () => void;
    entryId: string;
  }) =>
    isOpen ? (
      <div role="dialog" aria-label="Resolve entry">
        <p data-testid="modal-entry-id">{entryId}</p>
        <button
          onClick={() =>
            onResolved({
              id: entryId,
              createdAt: '2026-07-12T10:00:00.000Z',
              updatedAt: '2026-07-12T10:00:00.000Z',
              deletedAt: null,
              schemaVersion: 1,
              rawId: 'a3f7c2b1',
              rawText: '---\nid: a3f7c2b1\n---',
              status: 'resolved',
              matchState: 'unmatched',
              parsedDate: '2026-07-12T17:30:00.000Z',
              parsedContact: 'Alice Smith',
              parsedType: 'meeting',
              parsedSummary: null,
              parsedLocation: null,
              parseError: null,
              candidateContactIds: [],
              candidateContacts: [],
              contactId: 'cccccccc-0000-0000-0000-000000000001',
              interactionId: 'iiiiiiii-0000-0000-0000-000000000001',
            })
          }
        >
          Confirm resolve
        </button>
        <button onClick={onClose}>Cancel resolve</button>
      </div>
    ) : null,
}));

import { fetchInboxQueue, processInbox, discardInboxEntry } from '../lib/inbox-api.js';

const ENTRY_ID = 'eeeeeeee-0000-0000-0000-000000000001';

function makeEntry(overrides: Partial<InboxEntry> = {}): InboxEntry {
  return {
    id: ENTRY_ID,
    createdAt: '2026-07-12T10:00:00.000Z',
    updatedAt: '2026-07-12T10:00:00.000Z',
    deletedAt: null,
    schemaVersion: 1,
    rawId: 'a3f7c2b1',
    rawText: '---\nid: a3f7c2b1\n---',
    status: 'pending',
    matchState: 'unmatched',
    parsedDate: '2026-07-12T17:30:00.000Z',
    parsedContact: 'Alice Smith',
    parsedType: 'meeting',
    parsedSummary: null,
    parsedLocation: null,
    parseError: null,
    candidateContactIds: [],
    candidateContacts: [],
    contactId: null,
    interactionId: null,
    ...overrides,
  };
}

const originalConsoleError = console.error;

beforeEach(() => {
  vi.resetAllMocks();
  console.error = vi.fn();
  global.fetch = vi.fn().mockResolvedValue({ ok: true });
  vi.mocked(fetchInboxQueue).mockResolvedValue({ entries: [] });
});

afterEach(() => {
  console.error = originalConsoleError;
});

function renderPage() {
  return render(
    <MemoryRouter>
      <InboxPage />
    </MemoryRouter>
  );
}

describe('InboxPage', () => {
  it('shows loading state while fetching', () => {
    vi.mocked(fetchInboxQueue).mockImplementation(() => new Promise(() => {}));
    renderPage();
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('shows empty state when queue is empty', async () => {
    renderPage();
    await screen.findByText('Inbox is empty.');
  });

  it('renders pending entries with contact, type, and date', async () => {
    vi.mocked(fetchInboxQueue).mockResolvedValue({ entries: [makeEntry()] });
    renderPage();
    await screen.findByText('Alice Smith');
    expect(screen.getByText('Meeting')).toBeInTheDocument();
  });

  describe('"Process inbox" button', () => {
    it('calls processInbox and shows result string', async () => {
      vi.mocked(processInbox).mockResolvedValue({ processed: 2, queued: 1 });
      vi.mocked(fetchInboxQueue)
        .mockResolvedValueOnce({ entries: [] })   // initial load
        .mockResolvedValueOnce({ entries: [] });  // after process

      renderPage();
      await screen.findByText('Inbox is empty.');

      fireEvent.click(screen.getByRole('button', { name: 'Process inbox' }));
      await screen.findByText(/Processed 2 interactions, queued 1 for review/i);
    });

    it('re-fetches queue after processing', async () => {
      const newEntry = makeEntry({ parsedContact: 'Bob Jones' });
      vi.mocked(processInbox).mockResolvedValue({ processed: 0, queued: 1 });
      vi.mocked(fetchInboxQueue)
        .mockResolvedValueOnce({ entries: [] })
        .mockResolvedValueOnce({ entries: [newEntry] });

      renderPage();
      await screen.findByText('Inbox is empty.');

      fireEvent.click(screen.getByRole('button', { name: 'Process inbox' }));
      await screen.findByText('Bob Jones');
    });

    it('process errors propagate to ErrorBoundary', async () => {
      vi.mocked(processInbox).mockRejectedValue(
        new ApiError('Storage failure', {
          type: 'StorageError',
          statusCode: 500,
          debugBlock: '--- DEBUG BLOCK ---\n{}\n--- END DEBUG BLOCK ---',
        })
      );
      // processInbox rejects, so the post-process refetch never fires — one call only
      vi.mocked(fetchInboxQueue).mockResolvedValueOnce({ entries: [] });

      render(
        <MemoryRouter>
          <ErrorBoundary>
            <InboxPage />
          </ErrorBoundary>
        </MemoryRouter>
      );
      await screen.findByText('Inbox is empty.');
      fireEvent.click(screen.getByRole('button', { name: 'Process inbox' }));
      await screen.findByText('Something went wrong');
    });
  });

  describe('per-matchState card rendering', () => {
    it('parse_error card shows parseError message and rawText', async () => {
      vi.mocked(fetchInboxQueue).mockResolvedValue({
        entries: [
          makeEntry({
            matchState: 'parse_error',
            parseError: 'Missing required field: id',
            rawText: '---\ncontact: Alice\n---',
          }),
        ],
      });
      renderPage();
      await screen.findByText('Missing required field: id');
      // getByText collapses \n→space by default; disable collapseWhitespace for <pre> content
      expect(
        screen.getByText('---\ncontact: Alice\n---', { normalizer: (text) => text.trim() })
      ).toBeInTheDocument();
    });

    it('parse_error card has no Resolve button', async () => {
      vi.mocked(fetchInboxQueue).mockResolvedValue({
        entries: [makeEntry({ matchState: 'parse_error', parseError: 'Missing id' })],
      });
      renderPage();
      await screen.findByText('Missing id');
      expect(screen.queryByRole('button', { name: /resolve/i })).not.toBeInTheDocument();
    });

    it('parse_error card has Discard button', async () => {
      vi.mocked(fetchInboxQueue).mockResolvedValue({
        entries: [makeEntry({ matchState: 'parse_error', parseError: 'Missing id' })],
      });
      renderPage();
      await screen.findByText('Missing id');
      expect(screen.getByRole('button', { name: /discard/i })).toBeInTheDocument();
    });

    it('ambiguous card shows ALL candidate contact names and Resolve/Discard buttons', async () => {
      // parsedContact defaults to 'Alice Smith' (visible in card header); both candidate
      // names are distinct so these assertions isolate the candidate list specifically.
      vi.mocked(fetchInboxQueue).mockResolvedValue({
        entries: [
          makeEntry({
            matchState: 'ambiguous',
            candidateContactIds: ['aaa', 'bbb'],
            candidateContacts: [
              { id: 'aaa', name: 'Bob Jones' },
              { id: 'bbb', name: 'Carol White' },
            ],
          }),
        ],
      });
      renderPage();
      await screen.findByText('Bob Jones');
      expect(screen.getByText('Carol White')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /resolve/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /discard/i })).toBeInTheDocument();
    });

    it('ambiguous card with all candidates deleted shows fallback message', async () => {
      vi.mocked(fetchInboxQueue).mockResolvedValue({
        entries: [
          makeEntry({
            matchState: 'ambiguous',
            candidateContactIds: ['aaa', 'bbb'],
            candidateContacts: [],
          }),
        ],
      });
      renderPage();
      await screen.findByText('Matching contacts no longer available.');
      expect(screen.getByRole('button', { name: /resolve/i })).toBeInTheDocument();
    });

    it('unmatched card shows "No match found" and Resolve + Discard buttons', async () => {
      vi.mocked(fetchInboxQueue).mockResolvedValue({
        entries: [makeEntry({ matchState: 'unmatched' })],
      });
      renderPage();
      await screen.findByText(/no match found for/i);
      expect(screen.getByRole('button', { name: /resolve/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /discard/i })).toBeInTheDocument();
    });
  });

  describe('discard', () => {
    it('calls discardInboxEntry and removes entry from list', async () => {
      vi.mocked(fetchInboxQueue).mockResolvedValue({ entries: [makeEntry()] });
      vi.mocked(discardInboxEntry).mockResolvedValue({
        entry: { ...makeEntry(), status: 'discarded' },
      });

      renderPage();
      await screen.findByText('Alice Smith');

      fireEvent.click(screen.getByRole('button', { name: /discard/i }));

      await waitFor(() => {
        expect(screen.queryByText('Alice Smith')).not.toBeInTheDocument();
      });
      expect(discardInboxEntry).toHaveBeenCalledWith(ENTRY_ID);
    });
  });

  describe('resolve modal integration', () => {
    it('clicking Resolve on an entry opens the resolve modal', async () => {
      vi.mocked(fetchInboxQueue).mockResolvedValue({
        entries: [makeEntry({ matchState: 'unmatched' })],
      });
      renderPage();
      await screen.findByText('Alice Smith');

      fireEvent.click(screen.getByRole('button', { name: /resolve/i }));
      expect(screen.getByRole('dialog', { name: 'Resolve entry' })).toBeInTheDocument();
    });

    it('successful resolve removes the entry from the queue (modal→page boundary)', async () => {
      vi.mocked(fetchInboxQueue).mockResolvedValue({
        entries: [makeEntry({ matchState: 'unmatched', parsedContact: 'Alice Smith' })],
      });
      renderPage();
      await screen.findByText('Alice Smith');

      fireEvent.click(screen.getByRole('button', { name: /resolve/i }));
      expect(screen.getByRole('dialog', { name: 'Resolve entry' })).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Confirm resolve' }));

      await waitFor(() => {
        expect(screen.queryByText('Alice Smith')).not.toBeInTheDocument();
      });
      // Modal also closes
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('fetch error propagates to ErrorBoundary', async () => {
    vi.mocked(fetchInboxQueue).mockRejectedValue(
      new ApiError('Server error', {
        type: 'StorageError',
        statusCode: 500,
        debugBlock: '--- DEBUG BLOCK ---\n{}\n--- END DEBUG BLOCK ---',
      })
    );

    render(
      <MemoryRouter>
        <ErrorBoundary>
          <InboxPage />
        </ErrorBoundary>
      </MemoryRouter>
    );

    await screen.findByText('Something went wrong');
  });
});
