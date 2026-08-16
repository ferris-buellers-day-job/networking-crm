import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  fetchReminders,
  createReminder,
  markReminderDone,
  deleteReminder,
  type Reminder,
} from '../lib/reminders-api.js';
import { fetchContacts, type Contact } from '../lib/contacts-api.js';
import { ApiError } from '../lib/api-error.js';
import { ContactPicker } from '../components/contact-picker.js';
import '../styles/contacts.css';

function formatDueAt(dueAt: string): string {
  return new Date(dueAt).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

// Overdue = dueAt is before the current instant.
// Both operands are epoch milliseconds — new Date(utcString) parses the Z-suffix UTC
// string to an absolute instant; new Date() is the current instant. Timezone-agnostic.
function isOverdue(dueAt: string): boolean {
  return new Date(dueAt) < new Date();
}

export function RemindersPage() {
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [contactMap, setContactMap] = useState<Map<string, Contact>>(new Map());
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<Error | null>(null);

  const [showForm, setShowForm]         = useState(false);
  const [formContact, setFormContact]   = useState<Contact | null>(null);
  const [formDueAt, setFormDueAt]       = useState('');
  const [formNote, setFormNote]         = useState('');
  const [formError, setFormError]       = useState<string | null>(null);
  const [formSaving, setFormSaving]     = useState(false);

  useEffect(() => {
    Promise.all([fetchReminders(), fetchContacts()])
      .then(([remData, contactsData]) => {
        setReminders(remData.reminders);
        setContactMap(new Map(contactsData.contacts.map((c) => [c.id, c])));
        setLoading(false);
      })
      .catch((err: Error) => {
        setError(err);
        setLoading(false);
      });
  }, []);

  if (error) throw error;

  if (loading) {
    return (
      <div className="reminders-page">
        <p>Loading…</p>
      </div>
    );
  }

  function handleMarkDone(id: string) {
    markReminderDone(id)
      .then(() => setReminders((prev) => prev.filter((r) => r.id !== id)))
      .catch((err: Error) => setError(err));
  }

  function handleDelete(id: string) {
    deleteReminder(id)
      .then(() => setReminders((prev) => prev.filter((r) => r.id !== id)))
      .catch((err: Error) => setError(err));
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!formContact || !formDueAt) return;

    setFormSaving(true);
    setFormError(null);

    // Convert the datetime-local string (local time, timezone-naive) to UTC ISO.
    // new Date(naiveLocalString) interprets it as local time; .toISOString() emits UTC Z.
    const dueAtUtc = new Date(formDueAt).toISOString();

    try {
      const result = await createReminder({
        contactId: formContact.id,
        dueAt: dueAtUtc,
        note: formNote.trim() || null,
      });
      setReminders((prev) =>
        [...prev, result.reminder].sort(
          (a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime()
        )
      );
      setFormContact(null);
      setFormDueAt('');
      setFormNote('');
      setShowForm(false);
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 400) {
        setFormError(err.message);
      } else {
        setError(err instanceof Error ? err : new Error(String(err)));
      }
    } finally {
      setFormSaving(false);
    }
  }

  const allContacts = [...contactMap.values()];

  return (
    <div className="reminders-page">
      <h1>Reminders</h1>

      <button
        type="button"
        className="btn-primary"
        onClick={() => setShowForm((s) => !s)}
      >
        {showForm ? 'Cancel' : 'Add reminder'}
      </button>

      {showForm && (
        <form className="reminder-create-form" onSubmit={(e) => { void handleCreate(e); }}>
          <ContactPicker
            contacts={allContacts}
            selectedContact={formContact}
            onSelect={setFormContact}
          />

          <div className="form-group">
            <label htmlFor="reminder-due-at">Due date</label>
            <input
              id="reminder-due-at"
              type="datetime-local"
              value={formDueAt}
              onChange={(e) => setFormDueAt(e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="reminder-note">Note (optional)</label>
            <input
              id="reminder-note"
              type="text"
              value={formNote}
              maxLength={500}
              onChange={(e) => setFormNote(e.target.value)}
              placeholder="e.g. Ask about Q4 partnership"
            />
          </div>

          {formError && <p className="submit-error">{formError}</p>}

          <button
            type="submit"
            className="btn-primary"
            disabled={!formContact || !formDueAt || formSaving}
          >
            {formSaving ? 'Saving…' : 'Create reminder'}
          </button>
        </form>
      )}

      {reminders.length === 0 ? (
        <p className="reminders-empty">No pending reminders.</p>
      ) : (
        <ul className="reminders-list">
          {reminders.map((reminder) => {
            const contact = contactMap.get(reminder.contactId);
            const displayName = contact
              ? (contact.preferredName ?? contact.name)
              : '(unknown contact)';
            const overdue = isOverdue(reminder.dueAt);

            return (
              <li key={reminder.id} className={`reminder-card${overdue ? ' reminder-overdue' : ''}`}>
                <div className="reminder-card-meta">
                  <Link to={`/contacts/${reminder.contactId}`}>{displayName}</Link>
                  <span className="reminder-due-at">{formatDueAt(reminder.dueAt)}</span>
                </div>
                {reminder.note && (
                  <p className="reminder-note">{reminder.note}</p>
                )}
                <div className="reminder-card-actions">
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={() => handleMarkDone(reminder.id)}
                  >
                    Mark done
                  </button>
                  <button
                    type="button"
                    className="btn-danger"
                    onClick={() => handleDelete(reminder.id)}
                  >
                    Delete
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
