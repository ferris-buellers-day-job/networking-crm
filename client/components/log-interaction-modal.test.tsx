// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { LogInteractionModal } from './log-interaction-modal.js';
import { ErrorBoundary } from './error-boundary.js';
import { ApiError } from '../lib/api-error.js';
import type { Interaction } from '../lib/interactions-api.js';

vi.mock('../lib/interactions-api.js', () => ({
  createInteraction: vi.fn(),
  fetchInteractions: vi.fn(),
  deleteInteraction: vi.fn(),
}));

import { createInteraction } from '../lib/interactions-api.js';

const CONTACT_ID = 'cccccccc-0000-0000-0000-000000000001';

function makeInteraction(overrides: Partial<Interaction> = {}): Interaction {
  return {
    id: 'iiiiiiii-0000-0000-0000-000000000001',
    createdAt: '2026-06-28T10:00:00.000Z',
    updatedAt: '2026-06-28T10:00:00.000Z',
    deletedAt: null,
    schemaVersion: 1,
    contactId: CONTACT_ID,
    occurredAt: '2026-06-28T09:00:00.000Z',
    type: 'meeting',
    summary: null,
    location: null,
    ...overrides,
  };
}

const originalConsoleError = console.error;

beforeEach(() => {
  vi.clearAllMocks();
  console.error = vi.fn();
  global.fetch = vi.fn().mockResolvedValue({ ok: true });
});

afterEach(() => {
  console.error = originalConsoleError;
});

function renderModal(props: Partial<Parameters<typeof LogInteractionModal>[0]> = {}) {
  return render(
    <LogInteractionModal
      contactId={CONTACT_ID}
      isOpen={true}
      onClose={vi.fn()}
      onSaved={vi.fn()}
      {...props}
    />
  );
}

describe('LogInteractionModal', () => {
  it('does not render when isOpen is false', () => {
    renderModal({ isOpen: false });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders the dialog when isOpen is true', () => {
    renderModal();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  describe('default values', () => {
    it('occurredAt defaults to current local datetime when modal opens — not at page load', () => {
      vi.useFakeTimers();

      try {
        const T1 = new Date('2026-06-28T10:00:00.000Z');
        const T2 = new Date('2026-06-28T15:30:00.000Z');

        // Compute what the modal will produce at T2 (timezone-independent)
        const t2Local = new Date(T2.getTime() - T2.getTimezoneOffset() * 60000);
        const expectedAtT2 = t2Local.toISOString().slice(0, 16);

        const t1Local = new Date(T1.getTime() - T1.getTimezoneOffset() * 60000);
        const expectedAtT1 = t1Local.toISOString().slice(0, 16);

        // Render closed at T1
        vi.setSystemTime(T1);
        const { rerender } = render(
          <LogInteractionModal
            contactId={CONTACT_ID}
            isOpen={false}
            onClose={vi.fn()}
            onSaved={vi.fn()}
          />
        );

        // Advance clock to T2, then open the modal
        vi.setSystemTime(T2);
        rerender(
          <LogInteractionModal
            contactId={CONTACT_ID}
            isOpen={true}
            onClose={vi.fn()}
            onSaved={vi.fn()}
          />
        );

        const input = screen.getByLabelText('Date & time') as HTMLInputElement;
        // Should reflect T2 (when opened), not T1 (when page loaded)
        expect(input.value).toBe(expectedAtT2);
        expect(input.value).not.toBe(expectedAtT1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('local-time conversion sign check: UTC-6 offset produces correct hour', () => {
      // Independent from the circular formula test — pins a known offset and asserts
      // a hardcoded literal, catching any sign error in the modal's getTimezoneOffset logic.
      vi.useFakeTimers();
      const origGetTZO = Date.prototype.getTimezoneOffset;
      Date.prototype.getTimezoneOffset = () => 360; // simulate UTC-6

      try {
        vi.setSystemTime(new Date('2026-06-28T15:30:00.000Z'));
        renderModal();
        const input = screen.getByLabelText('Date & time') as HTMLInputElement;
        // 15:30 UTC minus 360 min = 09:30 local — hardcoded, not derived from formula
        expect(input.value).toBe('2026-06-28T09:30');
      } finally {
        Date.prototype.getTimezoneOffset = origGetTZO;
        vi.useRealTimers();
      }
    });

    it('type defaults to meeting', () => {
      renderModal();
      const select = screen.getByLabelText('Type') as HTMLSelectElement;
      expect(select.value).toBe('meeting');
    });
  });

  describe('focus and keyboard', () => {
    it('Cancel button gets initial focus when modal opens', () => {
      renderModal();
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
    });

    it('ESC key calls onClose without submitting', () => {
      const onClose = vi.fn();
      renderModal({ onClose });
      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
      expect(onClose).toHaveBeenCalledOnce();
      expect(createInteraction).not.toHaveBeenCalled();
    });

    it('Cancel button calls onClose without submitting', () => {
      const onClose = vi.fn();
      renderModal({ onClose });
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(onClose).toHaveBeenCalledOnce();
      expect(createInteraction).not.toHaveBeenCalled();
    });
  });

  describe('form submission', () => {
    it('submit calls createInteraction and invokes onSaved with the returned interaction', async () => {
      const interaction = makeInteraction();
      vi.mocked(createInteraction).mockResolvedValue({ interaction });
      const onSaved = vi.fn();

      renderModal({ onSaved });

      fireEvent.click(screen.getByRole('button', { name: 'Save' }));

      await waitFor(() => {
        expect(onSaved).toHaveBeenCalledWith(interaction);
      });

      expect(createInteraction).toHaveBeenCalledOnce();
      const arg = vi.mocked(createInteraction).mock.calls[0][0];
      expect(arg.contactId).toBe(CONTACT_ID);
      expect(arg.type).toBe('meeting');
      // occurredAt must be a UTC ISO 8601 string (converted from datetime-local)
      expect(arg.occurredAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    it('submit sends null for blank summary and location', async () => {
      const interaction = makeInteraction();
      vi.mocked(createInteraction).mockResolvedValue({ interaction });

      renderModal();

      // Leave summary and location blank
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));

      await waitFor(() => {
        expect(createInteraction).toHaveBeenCalledOnce();
      });

      const arg = vi.mocked(createInteraction).mock.calls[0][0];
      expect(arg.summary).toBeNull();
      expect(arg.location).toBeNull();
    });

    it('submit trims whitespace-only summary and location to null', async () => {
      const interaction = makeInteraction();
      vi.mocked(createInteraction).mockResolvedValue({ interaction });

      renderModal();

      fireEvent.change(screen.getByLabelText('Summary'), { target: { value: '   ' } });
      fireEvent.change(screen.getByLabelText('Location'), { target: { value: '  ' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));

      await waitFor(() => {
        expect(createInteraction).toHaveBeenCalledOnce();
      });

      const arg = vi.mocked(createInteraction).mock.calls[0][0];
      expect(arg.summary).toBeNull();
      expect(arg.location).toBeNull();
    });

    it('submit sends trimmed non-blank summary and location', async () => {
      const interaction = makeInteraction({ summary: 'Great call', location: 'Blue Bottle' });
      vi.mocked(createInteraction).mockResolvedValue({ interaction });

      renderModal();

      fireEvent.change(screen.getByLabelText('Summary'), { target: { value: '  Great call  ' } });
      fireEvent.change(screen.getByLabelText('Location'), { target: { value: '  Blue Bottle  ' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));

      await waitFor(() => {
        expect(createInteraction).toHaveBeenCalledOnce();
      });

      const arg = vi.mocked(createInteraction).mock.calls[0][0];
      expect(arg.summary).toBe('Great call');
      expect(arg.location).toBe('Blue Bottle');
    });
  });

  describe('error handling', () => {
    it('ApiError 400 shows inline error inside the modal — does not propagate', async () => {
      vi.mocked(createInteraction).mockRejectedValue(
        new ApiError('Contact not found or deleted', {
          type: 'ValidationError',
          statusCode: 400,
          debugBlock: '--- DEBUG BLOCK ---\n{}\n--- END DEBUG BLOCK ---',
        })
      );

      renderModal();

      fireEvent.click(screen.getByRole('button', { name: 'Save' }));

      await screen.findByText('Contact not found or deleted');
      // Modal is still open — ErrorBoundary has NOT taken over
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('non-400 error propagates to ErrorBoundary', async () => {
      vi.mocked(createInteraction).mockRejectedValue(
        new ApiError('Storage failure', {
          type: 'StorageError',
          statusCode: 500,
          debugBlock: '--- DEBUG BLOCK ---\n{}\n--- END DEBUG BLOCK ---',
        })
      );

      render(
        <ErrorBoundary>
          <LogInteractionModal
            contactId={CONTACT_ID}
            isOpen={true}
            onClose={vi.fn()}
            onSaved={vi.fn()}
          />
        </ErrorBoundary>
      );

      fireEvent.click(screen.getByRole('button', { name: 'Save' }));

      await screen.findByText('Something went wrong');
    });
  });
});
