// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ContactPicker } from './contact-picker.js';
import type { Contact } from '../lib/contacts-api.js';

const CONTACT_A: Contact = {
  id: 'aaaa-0001', createdAt: '', updatedAt: '', deletedAt: null, schemaVersion: 1,
  name: 'Alice Smith', preferredName: null, linkedinUrl: null, phone: null,
  defaultCountry: null, email: null, company: null, title: null, notes: null, tier: null,
};
const CONTACT_B: Contact = {
  id: 'aaaa-0002', createdAt: '', updatedAt: '', deletedAt: null, schemaVersion: 1,
  name: 'Robert Jones', preferredName: 'Bob', linkedinUrl: null, phone: null,
  defaultCountry: null, email: null, company: null, title: null, notes: null, tier: null,
};

function renderPicker(
  overrides: Partial<Parameters<typeof ContactPicker>[0]> = {}
) {
  const onSelect = vi.fn();
  render(
    <ContactPicker
      contacts={[CONTACT_A, CONTACT_B]}
      selectedContact={null}
      onSelect={onSelect}
      {...overrides}
    />
  );
  return { onSelect };
}

describe('ContactPicker', () => {
  it('renders the search input', () => {
    renderPicker();
    expect(screen.getByLabelText('Search contacts')).toBeInTheDocument();
  });

  it('empty query shows no results', () => {
    renderPicker();
    expect(screen.queryByRole('button', { name: /Alice/i })).not.toBeInTheDocument();
  });

  it('filters contacts by name (case-insensitive)', () => {
    renderPicker();
    fireEvent.change(screen.getByLabelText('Search contacts'), { target: { value: 'alice' } });
    expect(screen.getByRole('button', { name: 'Alice Smith' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Bob/i })).not.toBeInTheDocument();
  });

  it('filters contacts by preferredName', () => {
    renderPicker();
    fireEvent.change(screen.getByLabelText('Search contacts'), { target: { value: 'bob' } });
    expect(screen.getByRole('button', { name: /Bob.*Robert Jones/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Alice Smith' })).not.toBeInTheDocument();
  });

  it('clicking a result calls onSelect(contact)', () => {
    const { onSelect } = renderPicker();
    fireEvent.change(screen.getByLabelText('Search contacts'), { target: { value: 'alice' } });
    fireEvent.click(screen.getByRole('button', { name: 'Alice Smith' }));
    expect(onSelect).toHaveBeenCalledWith(CONTACT_A);
  });

  it('shows "Selected: name" when selectedContact is set', () => {
    renderPicker({ selectedContact: CONTACT_A });
    expect(screen.getByText(/Selected:/)).toBeInTheDocument();
    expect(screen.getByText('Alice Smith')).toBeInTheDocument();
  });

  it('shows preferredName in Selected display when set', () => {
    renderPicker({ selectedContact: CONTACT_B });
    expect(screen.getByText('Bob')).toBeInTheDocument();
  });

  it('typing after a selection calls onSelect(null)', () => {
    const { onSelect } = renderPicker({ selectedContact: CONTACT_A });
    fireEvent.change(screen.getByLabelText('Search contacts'), { target: { value: 'al' } });
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it('pressing Enter selects first filtered result', () => {
    const { onSelect } = renderPicker();
    fireEvent.change(screen.getByLabelText('Search contacts'), { target: { value: 'alice' } });
    fireEvent.keyDown(screen.getByLabelText('Search contacts'), { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith(CONTACT_A);
  });

  it('no matches shows "No contacts match."', () => {
    renderPicker();
    fireEvent.change(screen.getByLabelText('Search contacts'), { target: { value: 'zzz' } });
    expect(screen.getByText('No contacts match.')).toBeInTheDocument();
  });
});
