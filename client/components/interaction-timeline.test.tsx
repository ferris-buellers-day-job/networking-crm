// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { InteractionTimeline } from './interaction-timeline.js';
import { ErrorBoundary } from './error-boundary.js';
import { ApiError } from '../lib/api-error.js';
import type { Interaction } from '../lib/interactions-api.js';

vi.mock('../lib/interactions-api.js', () => ({
  fetchInteractions: vi.fn(),
  deleteInteraction: vi.fn(),
  createInteraction: vi.fn(),
}));

vi.mock('./log-interaction-modal.js', () => ({
  LogInteractionModal: ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) =>
    isOpen ? (
      <div role="dialog" aria-label="Log interaction">
        <button onClick={onClose}>Close modal</button>
      </div>
    ) : null,
}));

import { fetchInteractions, deleteInteraction } from '../lib/interactions-api.js';

// ErrorBoundary triggers React's error logging; suppress during tests that intentionally throw
const originalConsoleError = console.error;
beforeEach(() => {
  console.error = vi.fn();
});
afterEach(() => {
  console.error = originalConsoleError;
});

const CONTACT_ID = 'cccccccc-0000-0000-0000-000000000001';

function makeInteraction(overrides: Partial<Interaction> = {}): Interaction {
  return {
    id: 'iiiiiiii-0000-0000-0000-000000000001',
    createdAt: '2026-06-01T10:00:00.000Z',
    updatedAt: '2026-06-01T10:00:00.000Z',
    deletedAt: null,
    schemaVersion: 1,
    contactId: CONTACT_ID,
    occurredAt: '2026-06-01T09:00:00.000Z',
    type: 'meeting',
    summary: 'Discussed product roadmap',
    location: null,
    ...overrides,
  };
}

function renderTimeline(contactId = CONTACT_ID) {
  return render(<InteractionTimeline contactId={contactId} />);
}

describe('InteractionTimeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading state while fetching', () => {
    vi.mocked(fetchInteractions).mockImplementation(() => new Promise(() => {}));
    renderTimeline();
    expect(screen.getByText('Loading interactions…')).toBeInTheDocument();
  });

  it('shows empty state when no interactions', async () => {
    vi.mocked(fetchInteractions).mockResolvedValue({ interactions: [] });
    renderTimeline();
    await screen.findByText('No interactions yet. Log your first one.');
  });

  it('renders interactions with type, date, and truncated summary', async () => {
    const longSummary = 'A'.repeat(100);
    vi.mocked(fetchInteractions).mockResolvedValue({
      interactions: [makeInteraction({ summary: longSummary })],
    });

    renderTimeline();

    await screen.findByText('Meeting');
    expect(screen.getByText('A'.repeat(80) + '…')).toBeInTheDocument();
  });

  it('renders short summary without truncation', async () => {
    vi.mocked(fetchInteractions).mockResolvedValue({
      interactions: [makeInteraction({ summary: 'Short summary' })],
    });

    renderTimeline();

    await screen.findByText('Short summary');
  });

  it('clicking row body expands full summary', async () => {
    const longSummary = 'B'.repeat(100);
    vi.mocked(fetchInteractions).mockResolvedValue({
      interactions: [makeInteraction({ summary: longSummary })],
    });

    renderTimeline();

    await screen.findByText('B'.repeat(80) + '…');
    fireEvent.click(screen.getByRole('button', { name: /meeting/i }));
    expect(screen.getByText(longSummary)).toBeInTheDocument();
  });

  it('clicking row body again collapses summary', async () => {
    const longSummary = 'C'.repeat(100);
    vi.mocked(fetchInteractions).mockResolvedValue({
      interactions: [makeInteraction({ summary: longSummary })],
    });

    renderTimeline();

    await screen.findByText('C'.repeat(80) + '…');
    fireEvent.click(screen.getByRole('button', { name: /meeting/i }));
    expect(screen.getByText(longSummary)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /meeting/i }));
    expect(screen.getByText('C'.repeat(80) + '…')).toBeInTheDocument();
  });

  it('delete button is separate from row body — does not expand summary', async () => {
    const longSummary = 'D'.repeat(100);
    vi.mocked(fetchInteractions).mockResolvedValue({
      interactions: [makeInteraction({ summary: longSummary })],
    });
    vi.mocked(deleteInteraction).mockResolvedValue(undefined);

    renderTimeline();

    await screen.findByText('D'.repeat(80) + '…');
    fireEvent.click(screen.getByRole('button', { name: 'Delete interaction' }));

    await waitFor(() => {
      expect(screen.queryByText(longSummary)).not.toBeInTheDocument();
      expect(screen.queryByText('D'.repeat(80) + '…')).not.toBeInTheDocument();
    });
  });

  it('delete removes the interaction from the list without page reload', async () => {
    vi.mocked(fetchInteractions).mockResolvedValue({
      interactions: [makeInteraction({ id: 'iiiiiiii-0000-0000-0000-000000000001' })],
    });
    vi.mocked(deleteInteraction).mockResolvedValue(undefined);

    renderTimeline();

    await screen.findByText('Meeting');
    fireEvent.click(screen.getByRole('button', { name: 'Delete interaction' }));

    await waitFor(() => {
      expect(screen.queryByText('Meeting')).not.toBeInTheDocument();
    });
    expect(deleteInteraction).toHaveBeenCalledWith('iiiiiiii-0000-0000-0000-000000000001');
  });

  it('failed delete propagates to ErrorBoundary', async () => {
    vi.mocked(fetchInteractions).mockResolvedValue({
      interactions: [makeInteraction()],
    });
    const err = new ApiError('Not found', {
      type: 'NotFound',
      statusCode: 404,
      debugBlock: '--- DEBUG BLOCK ---\n{}\n--- END DEBUG BLOCK ---',
    });
    vi.mocked(deleteInteraction).mockRejectedValue(err);

    render(
      <ErrorBoundary>
        <InteractionTimeline contactId={CONTACT_ID} />
      </ErrorBoundary>
    );

    await screen.findByText('Meeting');
    fireEvent.click(screen.getByRole('button', { name: 'Delete interaction' }));

    await screen.findByText('Something went wrong');
    expect(deleteInteraction).toHaveBeenCalled();
  });

  it('"Log interaction" button opens the modal', async () => {
    vi.mocked(fetchInteractions).mockResolvedValue({ interactions: [] });

    renderTimeline();

    await screen.findByText('No interactions yet. Log your first one.');
    fireEvent.click(screen.getByRole('button', { name: 'Log interaction' }));
    expect(screen.getByRole('dialog', { name: 'Log interaction' })).toBeInTheDocument();
  });

  it('fetch error propagates to ErrorBoundary', async () => {
    const err = new ApiError('Server error', {
      type: 'StorageError',
      statusCode: 500,
      debugBlock: '--- DEBUG BLOCK ---\n{}\n--- END DEBUG BLOCK ---',
    });
    vi.mocked(fetchInteractions).mockRejectedValue(err);

    render(
      <ErrorBoundary>
        <InteractionTimeline contactId={CONTACT_ID} />
      </ErrorBoundary>
    );

    await screen.findByText('Something went wrong');
    expect(fetchInteractions).toHaveBeenCalledWith(CONTACT_ID);
  });

  it('renders multiple interactions in the order returned by the API', async () => {
    vi.mocked(fetchInteractions).mockResolvedValue({
      interactions: [
        makeInteraction({
          id: 'iiiiiiii-0000-0000-0000-000000000002',
          type: 'call',
          occurredAt: '2026-06-02T09:00:00.000Z',
          summary: 'Follow-up call',
        }),
        makeInteraction({
          id: 'iiiiiiii-0000-0000-0000-000000000001',
          type: 'meeting',
          occurredAt: '2026-06-01T09:00:00.000Z',
          summary: 'Initial meeting',
        }),
      ],
    });

    renderTimeline();

    const rows = await screen.findAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Call');
    expect(rows[1]).toHaveTextContent('Meeting');
  });
});
