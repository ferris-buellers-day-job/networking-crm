import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { normalizePhone, formatPhoneForDisplay } from './phone.js';

describe('normalizePhone', () => {
  const originalEnv = process.env.DEFAULT_COUNTRY;

  beforeEach(() => {
    delete process.env.DEFAULT_COUNTRY;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.DEFAULT_COUNTRY = originalEnv;
    } else {
      delete process.env.DEFAULT_COUNTRY;
    }
  });

  describe('empty/null/undefined handling', () => {
    it('returns null for empty string', () => {
      expect(normalizePhone('')).toBe(null);
    });

    it('returns null for whitespace-only string', () => {
      expect(normalizePhone('   ')).toBe(null);
    });

    it('returns null for null input', () => {
      expect(normalizePhone(null)).toBe(null);
    });

    it('returns null for undefined input', () => {
      expect(normalizePhone(undefined)).toBe(null);
    });
  });

  describe('international format (starts with +)', () => {
    it('parses international format to E.164', () => {
      expect(normalizePhone('+14155551234')).toBe('+14155551234');
    });

    it('parses international format with spaces', () => {
      expect(normalizePhone('+1 415 555 1234')).toBe('+14155551234');
    });

    it('parses UK international format', () => {
      expect(normalizePhone('+44 20 7946 0958')).toBe('+442079460958');
    });

    it('ignores defaultCountry when input starts with +', () => {
      // UK number should parse as UK even with US default
      expect(normalizePhone('+44 20 7946 0958', 'US')).toBe('+442079460958');
    });
  });

  describe('national format with defaultCountry', () => {
    it('parses US national format with US country', () => {
      expect(normalizePhone('(415) 555-1234', 'US')).toBe('+14155551234');
    });

    it('parses UK national format with GB country', () => {
      expect(normalizePhone('020 7946 0958', 'GB')).toBe('+442079460958');
    });

    it('parses digits-only with country', () => {
      expect(normalizePhone('4155551234', 'US')).toBe('+14155551234');
    });
  });

  describe('DEFAULT_COUNTRY env var fallback', () => {
    it('uses DEFAULT_COUNTRY env var when no country provided', () => {
      process.env.DEFAULT_COUNTRY = 'GB';
      expect(normalizePhone('020 7946 0958')).toBe('+442079460958');
    });

    it('falls back to US when DEFAULT_COUNTRY not set', () => {
      expect(normalizePhone('(415) 555-1234')).toBe('+14155551234');
    });

    it('handles lowercase DEFAULT_COUNTRY', () => {
      process.env.DEFAULT_COUNTRY = 'gb';
      expect(normalizePhone('020 7946 0958')).toBe('+442079460958');
    });
  });

  describe('invalid input handling', () => {
    it('returns null for unparseable input', () => {
      expect(normalizePhone('not a phone number')).toBe(null);
    });

    it('returns null for too few digits', () => {
      expect(normalizePhone('123')).toBe(null);
    });

    it('returns null for malformed input', () => {
      expect(normalizePhone('++1234')).toBe(null);
    });
  });
});

describe('formatPhoneForDisplay', () => {
  const originalEnv = process.env.DEFAULT_COUNTRY;

  beforeEach(() => {
    delete process.env.DEFAULT_COUNTRY;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.DEFAULT_COUNTRY = originalEnv;
    } else {
      delete process.env.DEFAULT_COUNTRY;
    }
  });

  describe('national format when country matches', () => {
    it('formats US number in national format for US display', () => {
      const result = formatPhoneForDisplay('+14155551234', 'US');
      expect(result).toBe('(415) 555-1234');
    });

    it('formats UK number in national format for GB display', () => {
      const result = formatPhoneForDisplay('+442079460958', 'GB');
      expect(result).toBe('020 7946 0958');
    });
  });

  describe('international format when country differs', () => {
    it('formats UK number in international format for US display', () => {
      const result = formatPhoneForDisplay('+442079460958', 'US');
      expect(result).toBe('+44 20 7946 0958');
    });

    it('formats US number in international format for GB display', () => {
      const result = formatPhoneForDisplay('+14155551234', 'GB');
      expect(result).toBe('+1 415 555 1234');
    });
  });

  describe('DEFAULT_COUNTRY env var fallback', () => {
    it('uses DEFAULT_COUNTRY when no display country provided', () => {
      process.env.DEFAULT_COUNTRY = 'US';
      const result = formatPhoneForDisplay('+14155551234');
      expect(result).toBe('(415) 555-1234');
    });

    it('falls back to US when DEFAULT_COUNTRY not set', () => {
      const result = formatPhoneForDisplay('+14155551234');
      expect(result).toBe('(415) 555-1234');
    });
  });

  describe('edge cases', () => {
    it('returns empty string for empty input', () => {
      expect(formatPhoneForDisplay('')).toBe('');
    });

    it('returns original for unparseable input', () => {
      expect(formatPhoneForDisplay('not-a-number')).toBe('not-a-number');
    });

    it('handles lowercase country code', () => {
      const result = formatPhoneForDisplay('+14155551234', 'us');
      expect(result).toBe('(415) 555-1234');
    });
  });
});
