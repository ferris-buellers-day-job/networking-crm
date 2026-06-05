import { parsePhoneNumber, type CountryCode } from 'libphonenumber-js';

/**
 * Format an E.164 phone number for display.
 *
 * Uses national format if the phone's country matches displayCountry,
 * otherwise uses international format. Duplicated from server/lib/phone.ts —
 * kept separate so server and client can diverge without coupling.
 */
export function formatPhoneForDisplay(
  e164: string,
  displayCountry?: string | null
): string {
  if (!e164) return e164;

  const country = (displayCountry?.toUpperCase() as CountryCode) ?? ('US' as CountryCode);

  try {
    const parsed = parsePhoneNumber(e164);
    if (!parsed) return e164;

    if (parsed.country === country) {
      return parsed.format('NATIONAL');
    }
    return parsed.format('INTERNATIONAL');
  } catch {
    return e164;
  }
}
