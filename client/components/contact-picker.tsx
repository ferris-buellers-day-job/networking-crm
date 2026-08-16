import { useState } from 'react';
import { type Contact } from '../lib/contacts-api.js';

export interface ContactPickerProps {
  contacts:        Contact[];
  selectedContact: Contact | null;
  onSelect:        (contact: Contact | null) => void;
  /** Optional ref forwarded to the search input — used by ResolveInboxModal's Tab focus trap. */
  inputRef?:       React.RefObject<HTMLInputElement>;
}

export function ContactPicker({
  contacts,
  selectedContact,
  onSelect,
  inputRef,
}: ContactPickerProps) {
  const [searchQuery, setSearchQuery] = useState('');

  const normalized = searchQuery.toLowerCase().trim();
  const filtered = normalized
    ? contacts.filter(
        (c) =>
          c.name.toLowerCase().includes(normalized) ||
          (c.preferredName !== null && c.preferredName.toLowerCase().includes(normalized))
      )
    : [];

  return (
    <div className="contact-picker">
      <label htmlFor="contact-search">Search contacts</label>
      <input
        ref={inputRef}
        id="contact-search"
        type="text"
        value={searchQuery}
        placeholder="Type a name…"
        onChange={(e) => {
          setSearchQuery(e.target.value);
          if (selectedContact) onSelect(null);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            if (!selectedContact && filtered.length > 0) {
              onSelect(filtered[0]);
            }
          }
        }}
      />

      {selectedContact && (
        <p className="resolve-selected">
          Selected:{' '}
          <strong>{selectedContact.preferredName ?? selectedContact.name}</strong>
        </p>
      )}

      {!selectedContact && normalized && (
        <ul className="resolve-results">
          {filtered.length > 0 ? (
            filtered.map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => onSelect(c)}>
                  {c.preferredName ? `${c.preferredName} (${c.name})` : c.name}
                </button>
              </li>
            ))
          ) : (
            <li>No contacts match.</li>
          )}
        </ul>
      )}
    </div>
  );
}
