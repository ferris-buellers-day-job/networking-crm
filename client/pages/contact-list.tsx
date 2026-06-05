import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchContacts, type Contact } from '../lib/contacts-api.js';
import '../styles/contacts.css';

export function ContactList() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    fetchContacts()
      .then((data) => {
        setContacts(data.contacts);
        setLoading(false);
      })
      .catch((err: Error) => {
        setError(err);
        setLoading(false);
      });
  }, []);

  // Propagate non-404 fetch errors to ErrorBoundary
  if (error) throw error;

  if (loading) {
    return (
      <div className="contacts-page">
        <p className="contacts-loading">Loading…</p>
      </div>
    );
  }

  const filtered =
    query.trim() === ''
      ? contacts
      : contacts.filter((c) => {
          const q = query.toLowerCase();
          return (
            c.name.toLowerCase().includes(q) ||
            (c.preferredName?.toLowerCase().includes(q) ?? false) ||
            (c.company?.toLowerCase().includes(q) ?? false) ||
            (c.email?.toLowerCase().includes(q) ?? false)
          );
        });

  return (
    <div className="contacts-page">
      <div className="contacts-header">
        <h1>Contacts</h1>
        <Link to="/contacts/new" className="btn-primary">
          New Contact
        </Link>
      </div>

      <input
        type="text"
        className="search-input"
        placeholder="Search contacts…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Search contacts"
      />

      {contacts.length === 0 ? (
        <p className="contacts-empty">No contacts yet. Create your first contact.</p>
      ) : filtered.length === 0 ? (
        <p className="contacts-no-results">No results for "{query}"</p>
      ) : (
        <table className="contacts-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Company</th>
              <th>Email</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((contact) => {
              const displayName = contact.preferredName ?? contact.name;
              const to = `/contacts/${contact.id}`;
              return (
                <tr key={contact.id}>
                  <td>
                    <Link to={to}>{displayName}</Link>
                  </td>
                  <td>
                    <Link to={to}>{contact.company ?? ''}</Link>
                  </td>
                  <td>
                    <Link to={to}>{contact.email ?? ''}</Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
