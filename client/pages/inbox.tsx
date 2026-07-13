import { useEffect, useState } from 'react';
import {
  fetchInboxQueue,
  processInbox,
  discardInboxEntry,
  type InboxEntry,
  type ProcessResult,
} from '../lib/inbox-api.js';
import { ResolveInboxModal } from '../components/resolve-inbox-modal.js';
import '../styles/contacts.css';

const TYPE_LABELS: Record<NonNullable<InboxEntry['parsedType']>, string> = {
  meeting: 'Meeting',
  call: 'Call',
  email: 'Email',
  message: 'Message',
  other: 'Other',
};

function formatDate(isoString: string): string {
  return new Date(isoString).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function truncate(text: string | null, max = 80): string {
  if (!text) return '';
  return text.length > max ? text.slice(0, max) + '…' : text;
}

export function InboxPage() {
  const [entries, setEntries]             = useState<InboxEntry[]>([]);
  const [loading, setLoading]             = useState(true);
  const [processResult, setProcessResult] = useState<ProcessResult | null>(null);
  const [processing, setProcessing]       = useState(false);
  const [resolveEntry, setResolveEntry]   = useState<InboxEntry | null>(null);
  const [error, setError]                 = useState<Error | null>(null);

  useEffect(() => {
    fetchInboxQueue()
      .then((data) => { setEntries(data.entries); setLoading(false); })
      .catch((err: Error) => { setError(err); setLoading(false); });
  }, []);

  if (error) throw error;

  function handleProcess() {
    setProcessing(true);
    setProcessResult(null);
    processInbox()
      .then((result) => {
        setProcessResult(result);
        return fetchInboxQueue();
      })
      .then((data) => { setEntries(data.entries); setProcessing(false); })
      .catch((err: Error) => { setError(err); setProcessing(false); });
  }

  function handleDiscard(id: string) {
    discardInboxEntry(id)
      .then(() => setEntries((prev) => prev.filter((e) => e.id !== id)))
      .catch((err: Error) => setError(err));
  }

  function handleResolved(entry: InboxEntry) {
    setEntries((prev) => prev.filter((e) => e.id !== entry.id));
    setResolveEntry(null);
  }

  if (loading) {
    return (
      <div className="inbox-page">
        <p>Loading…</p>
      </div>
    );
  }

  return (
    <div className="inbox-page">
      <h1>Inbox</h1>

      <div className="inbox-controls">
        <button
          type="button"
          className="btn-primary"
          onClick={handleProcess}
          disabled={processing}
        >
          {processing ? 'Processing…' : 'Process inbox'}
        </button>

        {processResult && (
          <p className="inbox-process-result">
            Processed {processResult.processed} interaction
            {processResult.processed !== 1 ? 's' : ''}, queued {processResult.queued} for review
          </p>
        )}
      </div>

      {entries.length === 0 ? (
        <p className="inbox-empty">Inbox is empty.</p>
      ) : (
        <ul className="inbox-list">
          {entries.map((entry) => (
            <li key={entry.id} className="inbox-card">
              <div className="inbox-card-meta">
                <span className="inbox-contact">{entry.parsedContact ?? '(unknown contact)'}</span>
                {entry.parsedType && (
                  <span className="inbox-type">{TYPE_LABELS[entry.parsedType]}</span>
                )}
                {entry.parsedDate && (
                  <span className="inbox-date">{formatDate(entry.parsedDate)}</span>
                )}
              </div>

              {entry.parsedSummary && (
                <p className="inbox-summary">{truncate(entry.parsedSummary)}</p>
              )}

              {entry.matchState === 'parse_error' && (
                <div className="inbox-parse-error">
                  <p className="inbox-error-msg">{entry.parseError}</p>
                  <pre className="inbox-raw-text">{entry.rawText}</pre>
                </div>
              )}

              {entry.matchState === 'ambiguous' && (
                entry.candidateContacts.length > 0 ? (
                  <ul className="inbox-candidate-names">
                    {entry.candidateContacts.map((c) => (
                      <li key={c.id}>{c.name}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="inbox-match-note">Matching contacts no longer available.</p>
                )
              )}

              {entry.matchState === 'unmatched' && (
                <p className="inbox-match-note">
                  No match found for &ldquo;{entry.parsedContact}&rdquo;.
                </p>
              )}

              <div className="inbox-card-actions">
                {entry.matchState !== 'parse_error' && (
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => setResolveEntry(entry)}
                  >
                    Resolve
                  </button>
                )}
                <button
                  type="button"
                  className="btn-danger"
                  onClick={() => handleDiscard(entry.id)}
                >
                  Discard
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <ResolveInboxModal
        entryId={resolveEntry?.id ?? ''}
        isOpen={resolveEntry !== null}
        onClose={() => setResolveEntry(null)}
        onResolved={handleResolved}
      />
    </div>
  );
}
