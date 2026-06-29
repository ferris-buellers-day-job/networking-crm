import { useEffect, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { getContact, deleteContact, type Contact } from '../lib/contacts-api.js';
import { formatPhoneForDisplay } from '../lib/phone.js';
import { ApiError } from '../lib/api-error.js';
import { ConfirmModal } from '../components/confirm-modal.js';
import { InteractionTimeline } from '../components/interaction-timeline.js';
import '../styles/contacts.css';

export function ContactDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [contact, setContact] = useState<Contact | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!id) return;
    getContact(id)
      .then((data) => {
        setContact(data.contact);
        setLoading(false);
      })
      .catch((err: Error) => {
        if (err instanceof ApiError && err.statusCode === 404) {
          setNotFound(true);
          setLoading(false);
        } else {
          setError(err);
          setLoading(false);
        }
      });
  }, [id]);

  // Propagate non-404 errors to ErrorBoundary
  if (error) throw error;

  if (loading) {
    return (
      <div className="contact-detail-page">
        <p className="contact-loading">Loading…</p>
      </div>
    );
  }

  if (notFound || !contact) {
    return (
      <div className="contact-detail-page">
        <div className="contact-not-found">
          <p>Contact not found.</p>
          <Link to="/contacts">Back to contacts</Link>
        </div>
      </div>
    );
  }

  const displayName = contact.preferredName ?? contact.name;

  return (
    <div className="contact-detail-page">
      <h1>{displayName}</h1>

      <dl className="contact-fields">
        {contact.preferredName && (
          <>
            <dt>Legal name</dt>
            <dd>{contact.name}</dd>
          </>
        )}

        {contact.title && (
          <>
            <dt>Title</dt>
            <dd>{contact.title}</dd>
          </>
        )}

        {contact.company && (
          <>
            <dt>Company</dt>
            <dd>{contact.company}</dd>
          </>
        )}

        {contact.email && (
          <>
            <dt>Email</dt>
            <dd>{contact.email}</dd>
          </>
        )}

        {contact.phone && (
          <>
            <dt>Phone</dt>
            <dd>{formatPhoneForDisplay(contact.phone, contact.defaultCountry)}</dd>
          </>
        )}

        {contact.linkedinUrl && (
          <>
            <dt>LinkedIn</dt>
            <dd>
              <a href={contact.linkedinUrl} target="_blank" rel="noopener noreferrer">
                {contact.linkedinUrl}
              </a>
            </dd>
          </>
        )}

        {contact.notes && (
          <>
            <dt>Notes</dt>
            <dd style={{ whiteSpace: 'pre-wrap' }}>{contact.notes}</dd>
          </>
        )}
      </dl>

      <InteractionTimeline contactId={id!} />

      <div className="contact-actions">
        <Link to={`/contacts/${contact.id}/edit`} className="btn-secondary">
          Edit
        </Link>
        <button
          type="button"
          className="btn-danger"
          onClick={() => setShowDeleteModal(true)}
          disabled={deleting}
        >
          Delete
        </button>
      </div>

      <ConfirmModal
        isOpen={showDeleteModal}
        title="Delete contact?"
        message="This cannot be undone."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onConfirm={async () => {
          setDeleting(true);
          try {
            await deleteContact(contact.id);
            navigate('/contacts');
          } catch (err) {
            setDeleting(false);
            setShowDeleteModal(false);
            setError(err instanceof Error ? err : new Error(String(err)));
          }
        }}
        onCancel={() => setShowDeleteModal(false)}
      />
    </div>
  );
}
