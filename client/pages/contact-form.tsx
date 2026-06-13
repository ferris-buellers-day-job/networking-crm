import { useState, useEffect } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import {
  getContact,
  createContact,
  updateContact,
  type ContactInput,
  type Contact,
} from '../lib/contacts-api.js';
import { normalizePhone } from '../lib/phone.js';
import { ApiError } from '../lib/api-error.js';
import { CountrySelect } from '../components/country-select.js';
import '../styles/contacts.css';

interface FormFields {
  name: string;
  preferredName: string;
  linkedinUrl: string;
  phone: string;
  defaultCountry: string | null;
  email: string;
  company: string;
  title: string;
  notes: string;
}

function emptyFields(): FormFields {
  return {
    name: '',
    preferredName: '',
    linkedinUrl: '',
    phone: '',
    defaultCountry: null,
    email: '',
    company: '',
    title: '',
    notes: '',
  };
}

function fieldsFromContact(contact: Contact): FormFields {
  return {
    name: contact.name,
    preferredName: contact.preferredName ?? '',
    linkedinUrl: contact.linkedinUrl ?? '',
    phone: contact.phone ?? '',
    defaultCountry: contact.defaultCountry,
    email: contact.email ?? '',
    company: contact.company ?? '',
    title: contact.title ?? '',
    notes: contact.notes ?? '',
  };
}

export function ContactForm() {
  const { id } = useParams<{ id: string }>();
  const isEdit = !!id;
  const navigate = useNavigate();

  const [fields, setFields] = useState<FormFields>(emptyFields());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [throwError, setThrowError] = useState<Error | null>(null);

  useEffect(() => {
    if (!id) return;
    getContact(id)
      .then((data) => {
        setFields(fieldsFromContact(data.contact));
        setLoading(false);
      })
      .catch((err: Error) => {
        if (err instanceof ApiError && err.statusCode === 404) {
          setNotFound(true);
        } else {
          setThrowError(err);
        }
        setLoading(false);
      });
  }, [id]);

  if (throwError) throw throwError;

  function setField<K extends keyof FormFields>(key: K, value: FormFields[K]) {
    setFields((prev) => ({ ...prev, [key]: value }));
  }

  function handlePhoneBlur() {
    const phone = fields.phone.trim();
    if (!phone) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next.phone;
        return next;
      });
      return;
    }
    const normalized = normalizePhone(phone, fields.defaultCountry);
    if (normalized === null) {
      setErrors((prev) => ({ ...prev, phone: "Couldn't parse as phone number" }));
    } else {
      setErrors((prev) => {
        const next = { ...prev };
        delete next.phone;
        return next;
      });
    }
  }

  function validate(): boolean {
    const newErrors: Record<string, string> = {};

    if (!fields.name.trim()) {
      newErrors.name = 'Name is required';
    }

    if (fields.linkedinUrl.trim()) {
      try {
        new URL(fields.linkedinUrl.trim());
      } catch {
        newErrors.linkedinUrl = 'Enter a valid URL';
      }
    }

    if (errors.phone) {
      newErrors.phone = errors.phone;
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    const input: ContactInput = {
      name: fields.name.trim(),
      preferredName: fields.preferredName.trim() || null,
      linkedinUrl: fields.linkedinUrl.trim() || null,
      phone: fields.phone.trim() || null,
      defaultCountry: fields.defaultCountry,
      email: fields.email.trim() || null,
      company: fields.company.trim() || null,
      title: fields.title.trim() || null,
      notes: fields.notes.trim() || null,
    };

    setSaving(true);
    setSubmitError(null);

    try {
      let result;
      if (isEdit && id) {
        result = await updateContact(id, input);
      } else {
        result = await createContact(input);
      }
      navigate(`/contacts/${result.contact.id}`);
    } catch (err) {
      setSaving(false);
      if (err instanceof ApiError) {
        setSubmitError(err.message);
      } else if (err instanceof Error) {
        setThrowError(err);
      }
    }
  }

  if (loading) {
    return (
      <div className="contact-form-page">
        <p className="contact-loading">Loading…</p>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="contact-form-page">
        <div className="contact-not-found">
          <p>Contact not found.</p>
          <Link to="/contacts">Back to contacts</Link>
        </div>
      </div>
    );
  }

  const cancelTo = isEdit && id ? `/contacts/${id}` : '/contacts';

  return (
    <div className="contact-form-page">
      <h1>{isEdit ? 'Edit Contact' : 'New Contact'}</h1>
      <form onSubmit={handleSubmit} noValidate>
        <div className="form-group">
          <label htmlFor="name" className="form-label">Name *</label>
          <input
            id="name"
            type="text"
            className={`form-input${errors.name ? ' form-input--error' : ''}`}
            value={fields.name}
            onChange={(e) => setField('name', e.target.value)}
            autoFocus={!isEdit}
          />
          {errors.name && <span className="field-error">{errors.name}</span>}
        </div>

        <div className="form-group">
          <label htmlFor="preferredName" className="form-label">Preferred name</label>
          <input
            id="preferredName"
            type="text"
            className="form-input"
            value={fields.preferredName}
            onChange={(e) => setField('preferredName', e.target.value)}
          />
        </div>

        <div className="form-group">
          <label htmlFor="company" className="form-label">Company</label>
          <input
            id="company"
            type="text"
            className="form-input"
            value={fields.company}
            onChange={(e) => setField('company', e.target.value)}
          />
        </div>

        <div className="form-group">
          <label htmlFor="title" className="form-label">Title</label>
          <input
            id="title"
            type="text"
            className="form-input"
            value={fields.title}
            onChange={(e) => setField('title', e.target.value)}
          />
        </div>

        <div className="form-group">
          <label htmlFor="email" className="form-label">Email</label>
          <input
            id="email"
            type="email"
            className="form-input"
            value={fields.email}
            onChange={(e) => setField('email', e.target.value)}
          />
        </div>

        <div className="form-group">
          <label htmlFor="defaultCountry" className="form-label">Default country</label>
          <CountrySelect
            id="defaultCountry"
            value={fields.defaultCountry}
            onChange={(v) => setField('defaultCountry', v)}
          />
        </div>

        <div className="form-group">
          <label htmlFor="phone" className="form-label">Phone</label>
          <input
            id="phone"
            type="tel"
            className={`form-input${errors.phone ? ' form-input--error' : ''}`}
            value={fields.phone}
            onChange={(e) => setField('phone', e.target.value)}
            onBlur={handlePhoneBlur}
          />
          {errors.phone && <span className="field-error">{errors.phone}</span>}
        </div>

        <div className="form-group">
          <label htmlFor="linkedinUrl" className="form-label">LinkedIn URL</label>
          <input
            id="linkedinUrl"
            type="url"
            className={`form-input${errors.linkedinUrl ? ' form-input--error' : ''}`}
            value={fields.linkedinUrl}
            onChange={(e) => setField('linkedinUrl', e.target.value)}
          />
          {errors.linkedinUrl && <span className="field-error">{errors.linkedinUrl}</span>}
        </div>

        <div className="form-group">
          <label htmlFor="notes" className="form-label">Notes</label>
          <textarea
            id="notes"
            className="form-textarea"
            value={fields.notes}
            onChange={(e) => setField('notes', e.target.value)}
            rows={5}
          />
        </div>

        {submitError && <p className="submit-error">{submitError}</p>}

        <div className="form-actions">
          <Link to={cancelTo} className="btn-secondary">Cancel</Link>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Contact'}
          </button>
        </div>
      </form>
    </div>
  );
}
