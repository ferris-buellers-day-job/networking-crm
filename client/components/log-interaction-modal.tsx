import { useEffect, useRef, useState } from 'react';
import { createInteraction, type Interaction } from '../lib/interactions-api.js';
import { ApiError } from '../lib/api-error.js';
import '../styles/contacts.css';

export interface LogInteractionModalProps {
  contactId: string;
  isOpen: boolean;
  onClose: () => void;
  onSaved: (interaction: Interaction) => void;
}

export function LogInteractionModal({
  contactId,
  isOpen,
  onClose,
  onSaved,
}: LogInteractionModalProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);
  const occurredAtRef = useRef<HTMLInputElement>(null);
  const typeRef = useRef<HTMLSelectElement>(null);
  const summaryRef = useRef<HTMLTextAreaElement>(null);
  const locationRef = useRef<HTMLInputElement>(null);
  const openerRef = useRef<Element | null>(null);

  const [occurredAt, setOccurredAt] = useState('');
  const [type, setType] = useState<Interaction['type']>('meeting');
  const [summary, setSummary] = useState('');
  const [location, setLocation] = useState('');
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<Error | null>(null);

  useEffect(() => {
    if (isOpen) {
      openerRef.current = document.activeElement;
      // Compute current datetime when modal opens, not at page load
      const now = new Date();
      const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
      setOccurredAt(local.toISOString().slice(0, 16));
      setType('meeting');
      setSummary('');
      setLocation('');
      setInlineError(null);
      cancelRef.current?.focus();
    } else {
      if (openerRef.current instanceof HTMLElement) {
        openerRef.current.focus();
      }
      openerRef.current = null;
    }
  }, [isOpen]);

  if (submitError) throw submitError;
  if (!isOpen) return null;

  const interactiveRefs = [cancelRef, occurredAtRef, typeRef, summaryRef, locationRef, submitRef];

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      onClose();
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      const elements = interactiveRefs.map((r) => r.current).filter(Boolean) as HTMLElement[];
      const current = document.activeElement;
      const idx = elements.indexOf(current as HTMLElement);
      const next = e.shiftKey
        ? elements[(idx - 1 + elements.length) % elements.length]
        : elements[(idx + 1) % elements.length];
      next?.focus();
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setInlineError(null);

    try {
      const result = await createInteraction({
        contactId,
        occurredAt: new Date(occurredAt).toISOString(),
        type,
        summary: summary.trim() || null,
        location: location.trim() || null,
      });
      onSaved(result.interaction);
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
      aria-labelledby="log-modal-title"
      onKeyDown={handleKeyDown}
    >
      <div className="modal-content">
        <h2 id="log-modal-title">Log interaction</h2>

        {inlineError && <p className="modal-inline-error">{inlineError}</p>}

        <form onSubmit={(e) => { void handleSubmit(e); }}>
          <div className="modal-field">
            <label htmlFor="log-occurred-at">Date &amp; time</label>
            <input
              ref={occurredAtRef}
              id="log-occurred-at"
              type="datetime-local"
              value={occurredAt}
              onChange={(e) => setOccurredAt(e.target.value)}
              required
            />
          </div>

          <div className="modal-field">
            <label htmlFor="log-type">Type</label>
            <select
              ref={typeRef}
              id="log-type"
              value={type}
              onChange={(e) => setType(e.target.value as Interaction['type'])}
            >
              <option value="meeting">Meeting</option>
              <option value="call">Call</option>
              <option value="email">Email</option>
              <option value="message">Message</option>
              <option value="other">Other</option>
            </select>
          </div>

          <div className="modal-field">
            <label htmlFor="log-summary">Summary</label>
            <textarea
              ref={summaryRef}
              id="log-summary"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              rows={4}
            />
          </div>

          <div className="modal-field">
            <label htmlFor="log-location">Location</label>
            <input
              ref={locationRef}
              id="log-location"
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
            />
          </div>

          <div className="modal-actions">
            <button ref={cancelRef} type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button ref={submitRef} type="submit" className="btn-primary">
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
