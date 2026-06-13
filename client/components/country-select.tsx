import { getCountries, type CountryCode } from 'libphonenumber-js';

interface CountryOption {
  code: CountryCode;
  name: string;
}

function buildCountryOptions(): CountryOption[] {
  const displayNames = new Intl.DisplayNames(['en'], { type: 'region' });
  return getCountries()
    .map((code) => ({ code, name: displayNames.of(code) ?? code }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

const COUNTRY_OPTIONS = buildCountryOptions();

export interface CountrySelectProps {
  value: string | null;
  onChange: (value: string | null) => void;
  id?: string;
}

export function CountrySelect({ value, onChange, id }: CountrySelectProps) {
  return (
    <select
      id={id}
      className="form-select"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || null)}
    >
      <option value="">— Select country —</option>
      {COUNTRY_OPTIONS.map((opt) => (
        <option key={opt.code} value={opt.code}>
          {opt.name}
        </option>
      ))}
    </select>
  );
}
