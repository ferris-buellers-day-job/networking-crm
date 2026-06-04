import { parsePhoneNumber, type CountryCode } from 'libphonenumber-js';

/**
 * Default country code for phone parsing when no country is specified.
 * Read from DEFAULT_COUNTRY env var, defaults to 'US'.
 */
function getDefaultCountry(): CountryCode {
  const envCountry = process.env.DEFAULT_COUNTRY;
  if (envCountry && envCountry.length === 2) {
    return envCountry.toUpperCase() as CountryCode;
  }
  return 'US';
}

/**
 * Parse and normalize a phone number to E.164 format.
 *
 * @param input - Raw phone input from user
 * @param defaultCountry - ISO 3166-1 alpha-2 code (e.g., 'US', 'GB').
 *                         Falls back to DEFAULT_COUNTRY env var, then 'US'.
 * @returns E.164 string (e.g., '+14155551234') or null if invalid/empty
 *
 * Behavior:
 * - Empty string, null, undefined: returns null without error
 * - Input starting with '+': parsed as international
 * - Input without '+': uses defaultCountry for parsing
 * - Unparseable input: returns null
 */
export function normalizePhone(
  input: string | null | undefined,
  defaultCountry?: string
): string | null {
  // Handle empty/null/undefined gracefully
  if (input === null || input === undefined || input.trim() === '') {
    return null;
  }

  const country = (defaultCountry?.toUpperCase() as CountryCode) || getDefaultCountry();

  try {
    const parsed = parsePhoneNumber(input, country);
    if (parsed && parsed.isValid()) {
      return parsed.format('E.164');
    }
    return null;
  } catch {
    // parsePhoneNumber can throw on malformed input
    return null;
  }
}

/**
 * Format an E.164 phone number for display.
 *
 * Uses national format if the phone's country matches the display country,
 * otherwise uses international format.
 *
 * @param e164 - E.164 formatted phone number (e.g., '+14155551234')
 * @param displayCountry - ISO 3166-1 alpha-2 code for display preference.
 *                         Falls back to DEFAULT_COUNTRY env var, then 'US'.
 * @returns Formatted phone string, or the original input if parsing fails
 *
 * Examples:
 * - formatPhoneForDisplay('+14155551234', 'US') → '(415) 555-1234' (national)
 * - formatPhoneForDisplay('+442079460958', 'US') → '+44 20 7946 0958' (international)
 * - formatPhoneForDisplay('+442079460958', 'GB') → '020 7946 0958' (national)
 */
export function formatPhoneForDisplay(
  e164: string,
  displayCountry?: string
): string {
  if (!e164) {
    return e164;
  }

  const country = (displayCountry?.toUpperCase() as CountryCode) || getDefaultCountry();

  try {
    const parsed = parsePhoneNumber(e164);
    if (!parsed) {
      return e164;
    }

    // Use national format if phone's country matches display country
    if (parsed.country === country) {
      return parsed.format('NATIONAL');
    }

    // Otherwise use international format
    return parsed.format('INTERNATIONAL');
  } catch {
    // Return original if parsing fails
    return e164;
  }
}
