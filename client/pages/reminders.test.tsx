// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import { RemindersPage } from './reminders.js';
import { ErrorBoundary } from '../components/error-boundary.js';
import { ApiError } from '../lib/api-error.js';
import type { Reminder } from '../lib/reminders-api.js';
import type { Contact } from '../lib/contacts-api.js';

vi.mock('../lib/reminders-api.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/reminders-api.js')>();
  return {
    ...actual,
    fetchReminders:  vi.fn(),
    createReminder:  vi.fn(),
    markReminderDone: vi.fn(),
    deleteReminder:  vi.fn(),
  };
});

vi.mock('../lib/contacts-api.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/contacts-api.js')>();
  return {
    ...actual,
    fetchContacts: vi.fn(),
  };
});

// ContactPicker is a real component; no mock needed.

import {
  fetchReminders, createReminder, markReminderDone, deleteReminder,
} from '../lib/reminders-api.js';
import { fetchContacts } from '../lib/contacts-api.js';

const CONTACT_ID = 'cccc-0001';

function makeContact(overrides: Partial<Contact> = {}): Contact {
  return {
    id: CONTACT_ID,
    createdAt: '', updatedAt: '', deletedAt: null, schemaVersion: 1,
    name: 'Alice Smith', preferredName: null, linkedinUrl: null, phone: null,
    defaultCountry: null, email: null, company: null, title: null, notes: null, tier: null,
    ...overrides,
  };
}

function makeReminder(overrides: Partial<Reminder> = {}): Reminder {
  return {
    id: crypto.randomUUID(),
    createdAt: '', updatedAt: '', deletedAt: null, schemaVersion: 1,
    contactId: CONTACT_ID,
    dueAt: '2026-09-01T12:00:00.000Z',
    status: 'pending',
    note: null,
    ...overrides,
  };
}

const originalConsoleError = console.error;

beforeEach(() => {
  vi.resetAllMocks();
  console.error = vi.fn();
  global.fetch = vi.fn().mockResolvedValue({ ok: true });
  vi.mocked(fetchReminders).mockResolvedValue({ reminders: [] });
  vi.mocked(fetchContacts).mockResolvedValue({ contacts: [makeContact()] });
});

afterEach(() => {
  console.error = originalConsoleError;
  vi.useRealTimers();
});

function renderPage() {
  return render(
    <MemoryRouter>
      <RemindersPage />
    </MemoryRouter>
  );
}

describe('RemindersPage', () => {
  it('shows loading state while fetching', () => {
    vi.mocked(fetchReminders).mockImplementation(() => new Promise(() => {}));
    renderPage();
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('shows empty state when no reminders', async () => {
    renderPage();
    await screen.findByText('No pending reminders.');
  });

  it('renders each reminder with contact name linked, note, and formatted dueAt', async () => {
    vi.mocked(fetchReminders).mockResolvedValue({
      reminders: [makeReminder({ note: 'Ask about Q4', dueAt: '2026-09-01T12:00:00.000Z' })],
    });
    renderPage();
    await screen.findByText('Alice Smith');
    expect(screen.getByRole('link', { name: 'Alice Smith' })).toHaveAttribute(
      'href', `/contacts/${CONTACT_ID}`
    );
    expect(screen.getByText('Ask about Q4')).toBeInTheDocument();
  });

  it('shows no note element when note is null', async () => {
    vi.mocked(fetchReminders).mockResolvedValue({
      reminders: [makeReminder({ note: null })],
    });
    renderPage();
    await screen.findByText('Alice Smith');
    expect(screen.queryByText('Ask about Q4')).not.toBeInTheDocument();
  });

  it('falls back to "(unknown contact)" when contactId is not in the contacts list', async () => {
    vi.mocked(fetchReminders).mockResolvedValue({
      reminders: [makeReminder({ contactId: 'unknown-id' })],
    });
    renderPage();
    await screen.findByText('(unknown contact)');
  });

  describe('overdue rendering', () => {
    it('reminder with dueAt T-1ms receives .reminder-overdue class', async () => {
      const T = new Date('2026-09-15T12:00:00.000Z').getTime();
      vi.useFakeTimers();
      vi.setSystemTime(T);

      const dueAt = new Date(T - 1).toISOString();
      vi.mocked(fetchReminders).mockResolvedValue({ reminders: [makeReminder({ dueAt })] });
      renderPage();

      // With fake timers, setTimeout-based polling (findByText/waitFor) hangs.
      // Flush the promise microtasks directly instead — the mocks resolve immediately.
      await act(async () => {});

      const card = document.querySelector('.reminder-card');
      expect(card).not.toBeNull();
      expect(card).toHaveClass('reminder-overdue');
    });

    it('future-UTC-instant guard: reminder with dueAt T+1ms does NOT receive .reminder-overdue class', async () => {
      const T = new Date('2026-09-15T12:00:00.000Z').getTime();
      vi.useFakeTimers();
      vi.setSystemTime(T);

      const dueAt = new Date(T + 1).toISOString();
      vi.mocked(fetchReminders).mockResolvedValue({ reminders: [makeReminder({ dueAt })] });
      renderPage();

      await act(async () => {});

      const card = document.querySelector('.reminder-card');
      expect(card).not.toBeNull();
      expect(card).not.toHaveClass('reminder-overdue');
    });
  });

  describe('mark done', () => {
    it('calls markReminderDone and removes entry from list in place', async () => {
      const r = makeReminder();
      vi.mocked(fetchReminders).mockResolvedValue({ reminders: [r] });
      vi.mocked(markReminderDone).mockResolvedValue({ reminder: { ...r, status: 'done' } });

      renderPage();
      await screen.findByText('Alice Smith');

      fireEvent.click(screen.getByRole('button', { name: /mark done/i }));

      await waitFor(() => {
        expect(screen.queryByText('Alice Smith')).not.toBeInTheDocument();
      });
      expect(markReminderDone).toHaveBeenCalledWith(r.id);
    });

    it('mark-done errors propagate to ErrorBoundary', async () => {
      const r = makeReminder();
      vi.mocked(fetchReminders).mockResolvedValue({ reminders: [r] });
      vi.mocked(markReminderDone).mockRejectedValue(new Error('Storage failure'));

      render(
        <MemoryRouter>
          <ErrorBoundary>
            <RemindersPage />
          </ErrorBoundary>
        </MemoryRouter>
      );
      await screen.findByText('Alice Smith');
      fireEvent.click(screen.getByRole('button', { name: /mark done/i }));
      await screen.findByText('Something went wrong');
    });
  });

  describe('delete', () => {
    it('calls deleteReminder and removes entry from list in place', async () => {
      const r = makeReminder();
      vi.mocked(fetchReminders).mockResolvedValue({ reminders: [r] });
      vi.mocked(deleteReminder).mockResolvedValue(undefined);

      renderPage();
      await screen.findByText('Alice Smith');

      fireEvent.click(screen.getByRole('button', { name: /delete/i }));

      await waitFor(() => {
        expect(screen.queryByText('Alice Smith')).not.toBeInTheDocument();
      });
      expect(deleteReminder).toHaveBeenCalledWith(r.id);
    });

    it('delete errors propagate to ErrorBoundary', async () => {
      const r = makeReminder();
      vi.mocked(fetchReminders).mockResolvedValue({ reminders: [r] });
      vi.mocked(deleteReminder).mockRejectedValue(new Error('Storage failure'));

      render(
        <MemoryRouter>
          <ErrorBoundary>
            <RemindersPage />
          </ErrorBoundary>
        </MemoryRouter>
      );
      await screen.findByText('Alice Smith');
      fireEvent.click(screen.getByRole('button', { name: /delete/i }));
      await screen.findByText('Something went wrong');
    });
  });

  describe('create form', () => {
    it('"Add reminder" toggles the inline create form', async () => {
      renderPage();
      await screen.findByText('No pending reminders.');

      expect(screen.queryByLabelText('Search contacts')).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Add reminder' }));
      expect(screen.getByLabelText('Search contacts')).toBeInTheDocument();
    });

    it('Submit is disabled until contact is selected AND dueAt is entered', async () => {
      renderPage();
      await screen.findByText('No pending reminders.');
      fireEvent.click(screen.getByRole('button', { name: 'Add reminder' }));

      const submit = screen.getByRole('button', { name: /create reminder/i });
      expect(submit).toBeDisabled();

      // Select a contact
      fireEvent.change(screen.getByLabelText('Search contacts'), { target: { value: 'alice' } });
      fireEvent.click(screen.getByRole('button', { name: 'Alice Smith' }));
      // Still disabled — no dueAt yet
      expect(submit).toBeDisabled();

      // Enter dueAt
      fireEvent.change(screen.getByLabelText('Due date'), { target: { value: '2026-09-15T14:30' } });
      expect(submit).not.toBeDisabled();
    });

    it('converts datetime-local value to the correct UTC-Z instant before posting', async () => {
      // The specific local string to use. new Date(localString).toISOString() in the test
      // uses the same formula as the component — if the component passes the raw string or
      // uses a different formula, the assertion will fail (catching offset errors, not just format).
      const localInput = '2026-09-15T14:30';
      const expectedUtc = new Date(localInput).toISOString();  // same formula as component

      const newReminder = makeReminder({ dueAt: expectedUtc });
      vi.mocked(createReminder).mockResolvedValue({ reminder: newReminder });

      renderPage();
      await screen.findByText('No pending reminders.');
      fireEvent.click(screen.getByRole('button', { name: 'Add reminder' }));

      fireEvent.change(screen.getByLabelText('Search contacts'), { target: { value: 'alice' } });
      fireEvent.click(screen.getByRole('button', { name: 'Alice Smith' }));
      fireEvent.change(screen.getByLabelText('Due date'), { target: { value: localInput } });
      fireEvent.click(screen.getByRole('button', { name: /create reminder/i }));

      await waitFor(() => {
        expect(createReminder).toHaveBeenCalledWith(
          expect.objectContaining({ dueAt: expectedUtc })
        );
      });
    });

    it('on successful create, reminder is added to the list and form hides', async () => {
      const newReminder = makeReminder({ note: 'Follow up on Q4' });
      vi.mocked(createReminder).mockResolvedValue({ reminder: newReminder });

      renderPage();
      await screen.findByText('No pending reminders.');
      fireEvent.click(screen.getByRole('button', { name: 'Add reminder' }));

      fireEvent.change(screen.getByLabelText('Search contacts'), { target: { value: 'alice' } });
      fireEvent.click(screen.getByRole('button', { name: 'Alice Smith' }));
      fireEvent.change(screen.getByLabelText('Due date'), { target: { value: '2026-09-15T14:30' } });
      fireEvent.change(screen.getByLabelText('Note (optional)'), { target: { value: 'Follow up on Q4' } });
      fireEvent.click(screen.getByRole('button', { name: /create reminder/i }));

      await screen.findByText('Follow up on Q4');
      expect(screen.queryByLabelText('Search contacts')).not.toBeInTheDocument();
    });

    it('ApiError 400 shows inline error inside the form', async () => {
      vi.mocked(createReminder).mockRejectedValue(
        new ApiError('Contact not found or deleted', {
          type: 'ValidationError',
          statusCode: 400,
          debugBlock: '--- DEBUG BLOCK ---\n{}\n--- END DEBUG BLOCK ---',
        })
      );

      renderPage();
      await screen.findByText('No pending reminders.');
      fireEvent.click(screen.getByRole('button', { name: 'Add reminder' }));

      fireEvent.change(screen.getByLabelText('Search contacts'), { target: { value: 'alice' } });
      fireEvent.click(screen.getByRole('button', { name: 'Alice Smith' }));
      fireEvent.change(screen.getByLabelText('Due date'), { target: { value: '2026-09-15T14:30' } });
      fireEvent.click(screen.getByRole('button', { name: /create reminder/i }));

      await screen.findByText('Contact not found or deleted');
      // Form still visible
      expect(screen.getByLabelText('Search contacts')).toBeInTheDocument();
    });

    it('non-400 create error propagates to ErrorBoundary', async () => {
      vi.mocked(createReminder).mockRejectedValue(
        new ApiError('Storage failure', {
          type: 'StorageError',
          statusCode: 500,
          debugBlock: '--- DEBUG BLOCK ---\n{}\n--- END DEBUG BLOCK ---',
        })
      );

      render(
        <MemoryRouter>
          <ErrorBoundary>
            <RemindersPage />
          </ErrorBoundary>
        </MemoryRouter>
      );
      await screen.findByText('No pending reminders.');
      fireEvent.click(screen.getByRole('button', { name: 'Add reminder' }));

      fireEvent.change(screen.getByLabelText('Search contacts'), { target: { value: 'alice' } });
      fireEvent.click(screen.getByRole('button', { name: 'Alice Smith' }));
      // Wait for the contact selection state to flush before proceeding — fireEvent
      // schedules the setFormContact update but doesn't guarantee it has applied.
      await screen.findByText(/Selected:/);

      fireEvent.change(screen.getByLabelText('Due date'), { target: { value: '2026-09-15T14:30' } });

      // Wait for the submit button to be enabled (both formContact and formDueAt must be set).
      // A disabled submit button does not fire the form's onSubmit — clicking it would be a no-op.
      const submitBtn = screen.getByRole('button', { name: /create reminder/i });
      await waitFor(() => expect(submitBtn).not.toBeDisabled());

      fireEvent.click(submitBtn);
      await screen.findByText('Something went wrong');
    });
  });

  it('fetch error propagates to ErrorBoundary', async () => {
    vi.mocked(fetchReminders).mockRejectedValue(new Error('Network failure'));

    render(
      <MemoryRouter>
        <ErrorBoundary>
          <RemindersPage />
        </ErrorBoundary>
      </MemoryRouter>
    );
    await screen.findByText('Something went wrong');
  });
});
