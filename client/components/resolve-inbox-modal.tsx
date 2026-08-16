import { useEffect, useRef, useState } from 'react';
import { resolveInboxEntry, type InboxEntry } from '../lib/inbox-api.js';
import { fetchContacts, type Contact } from '../lib/contacts-api.js';
import { ApiError } from '../lib/api-error.js';
import { ContactPicker } from './contact-picker.js';
import '../styles/contacts.css';

export interface ResolveInboxModalProps {
  entryId: string;
  isOpen: boolean;
  onClose: () => void;
  onResolved: (entry: InboxEntry) => void;
}

export function ResolveInboxModal({
  entryId,
  isOpen,
  onClose,
  onResolved,
}: ResolveInboxModalProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const searchRef  = useRef<HTMLInputElement>(null);
  const submitRef  = useRef<HTMLButtonElement>(null);
  const openerRef  = useRef<Element | null>(null);

  const [contacts, setContacts]               = useState<Contact[]>([]);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [inlineError, setInlineError]         = useState<string | null>(null);
  const [submitError, setSubmitError]         = useState<Error | null>(null);

  useEffect(() => {
    if (isOpen) {
      openerRef.current = document.activeElement;
      setSelectedContact(null);
      setInlineError(null);
      cancelRef.current?.focus();

      fetchContacts()
        .then((data) => setContacts(data.contacts))
        .catch((err: Error) => {
          setSubmitError(err);
        });
    } else {
      if (openerRef.current instanceof HTMLElement) {
        openerRef.current.focus();
      }
      openerRef.current = null;
    }
  }, [isOpen]);

  if (submitError) throw submitError;
  if (!isOpen) return null;

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      onClose();
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      const elements = [cancelRef, searchRef, submitRef]
        .map((r) => r.current)
        .filter(Boolean) as HTMLElement[];
      const idx = elements.indexOf(document.activeElement as HTMLElement);
      const next = e.shiftKey
        ? elements[(idx - 1 + elements.length) % elements.length]
        : elements[(idx + 1) % elements.length];
      next?.focus();
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedContact) return;
    setInlineError(null);

    try {
      const result = await resolveInboxEntry(entryId, selectedContact.id);
      onResolved(result.entry);
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 400) {
        setInlineError(err.message);
      } else {
        setSubmitError(err instanceof Error ? err : new Error(String(err)));
      }
    }
  }

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="resolve-modal-title"
      onKeyDown={handleKeyDown}
    >
      <div className="modal-content">
        <h2 id="resolve-modal-title">Resolve entry</h2>

        {inlineError && <p className="modal-inline-error">{inlineError}</p>}

        <form onSubmit={(e) => { void handleSubmit(e); }}>
          <div className="modal-field">
            <ContactPicker
              contacts={contacts}
              selectedContact={selectedContact}
              onSelect={setSelectedContact}
              inputRef={searchRef}
            />
          </div>

          <div className="modal-actions">
            <button ref={cancelRef} type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              ref={submitRef}
              type="submit"
              className="btn-primary"
              disabled={!selectedContact}
            >
              Resolve
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
