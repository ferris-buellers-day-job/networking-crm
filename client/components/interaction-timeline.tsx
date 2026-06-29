import { useEffect, useState } from 'react';
import { fetchInteractions, deleteInteraction, type Interaction } from '../lib/interactions-api.js';
import { LogInteractionModal } from './log-interaction-modal.js';

export interface InteractionTimelineProps {
  contactId: string;
}

function formatDate(isoString: string): string {
  return new Date(isoString).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function truncateSummary(summary: string | null): string {
  if (!summary) return '';
  return summary.length > 80 ? summary.slice(0, 80) + '…' : summary;
}

const TYPE_LABELS: Record<Interaction['type'], string> = {
  meeting: 'Meeting',
  call: 'Call',
  email: 'Email',
  message: 'Message',
  other: 'Other',
};

export function InteractionTimeline({ contactId }: InteractionTimelineProps) {
  const [interactions, setInteractions] = useState<Interaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    fetchInteractions(contactId)
      .then((data) => {
        setInteractions(data.interactions);
        setLoading(false);
      })
      .catch((err: Error) => {
        setError(err);
        setLoading(false);
      });
  }, [contactId]);

  if (error) throw error;

  function toggleExpanded(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function handleDelete(id: string) {
    deleteInteraction(id)
      .then(() => {
        setInteractions((prev) => prev.filter((i) => i.id !== id));
      })
      .catch((err: Error) => {
        setError(err);
      });
  }

  function handleSaved(interaction: Interaction) {
    setInteractions((prev) => [interaction, ...prev]);
    setShowModal(false);
  }

  if (loading) {
    return (
      <section className="interaction-timeline">
        <p className="timeline-loading">Loading interactions…</p>
      </section>
    );
  }

  return (
    <section className="interaction-timeline">
      <div className="timeline-header">
        <h2>Interactions</h2>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => setShowModal(true)}
        >
          Log interaction
        </button>
      </div>

      {interactions.length === 0 ? (
        <p className="timeline-empty">No interactions yet. Log your first one.</p>
      ) : (
        <ul className="timeline-list">
          {interactions.map((interaction) => {
            const isExpanded = expandedIds.has(interaction.id);
            return (
              <li key={interaction.id} className="timeline-row">
                <button
                  type="button"
                  className="timeline-row-body"
                  onClick={() => toggleExpanded(interaction.id)}
                  aria-expanded={isExpanded}
                >
                  <span className="timeline-type">{TYPE_LABELS[interaction.type]}</span>
                  <span className="timeline-date">{formatDate(interaction.occurredAt)}</span>
                  {interaction.summary && (
                    <span className="timeline-summary">
                      {isExpanded ? interaction.summary : truncateSummary(interaction.summary)}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  className="timeline-delete"
                  onClick={() => handleDelete(interaction.id)}
                  aria-label="Delete interaction"
                >
                  Delete
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <LogInteractionModal
        contactId={contactId}
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        onSaved={handleSaved}
      />
    </section>
  );
}
