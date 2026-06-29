import { describe, it, expect } from 'vitest';
import { parseInbox } from './inbox-parser.js';

function entry(fields: Record<string, string | undefined>, summary?: string): string {
  const lines = ['---'];
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined) lines.push(`${k}: ${v}`);
  }
  if (summary !== undefined) {
    lines.push(`summary: ${summary}`);
  }
  lines.push('---');
  return lines.join('\n') + '\n';
}

const VALID_FIELDS = {
  id: 'a3f7c2b1',
  date: '2026-06-28T15:30:00-07:00',
  contact: 'Alice Smith',
  type: 'meeting',
};

describe('parseInbox', () => {
  it('returns empty array for empty content', () => {
    expect(parseInbox('')).toEqual([]);
    expect(parseInbox('   \n  ')).toEqual([]);
  });

  it('parses a complete valid entry with all fields', () => {
    const content = entry(
      { id: 'a3f7c2b1', date: '2026-06-28T15:30:00-07:00', contact: 'Alice Smith', type: 'meeting', location: 'Blue Bottle' },
      'Discussed roadmap.'
    );
    const [result] = parseInbox(content);
    expect(result.parseError).toBeNull();
    expect(result.rawId).toBe('a3f7c2b1');
    expect(result.parsedContact).toBe('Alice Smith');
    expect(result.parsedDate).toBe('2026-06-28T22:30:00.000Z');
    expect(result.parsedType).toBe('meeting');
    expect(result.parsedLocation).toBe('Blue Bottle');
    expect(result.parsedSummary).toBe('Discussed roadmap.');
  });

  it('parses a multi-line summary correctly', () => {
    const lines = [
      '---',
      'id: a3f7c2b1',
      'date: 2026-06-28T15:30:00-07:00',
      'contact: Alice Smith',
      'summary: First line.',
      'Second line.',
      'Third line.',
      '---',
    ].join('\n') + '\n';

    const [result] = parseInbox(lines);
    expect(result.parseError).toBeNull();
    expect(result.parsedSummary).toBe('First line.\nSecond line.\nThird line.');
  });

  it('parses multiple entries from one file', () => {
    const content = entry(VALID_FIELDS) + entry({ ...VALID_FIELDS, id: 'b4c8d2e1', contact: 'Bob Jones' });
    const results = parseInbox(content);
    expect(results).toHaveLength(2);
    expect(results[0].parsedContact).toBe('Alice Smith');
    expect(results[1].parsedContact).toBe('Bob Jones');
  });

  describe('rawText', () => {
    it('includes the opening and closing --- delimiters', () => {
      const content = entry(VALID_FIELDS);
      const [result] = parseInbox(content);
      expect(result.rawText).toMatch(/^---\n/);
      expect(result.rawText).toMatch(/\n---$/);
    });
  });

  describe('date conversion', () => {
    it('converts offset date to UTC-Z', () => {
      const [result] = parseInbox(entry({ ...VALID_FIELDS, date: '2026-06-28T15:30:00-07:00' }));
      expect(result.parsedDate).toBe('2026-06-28T22:30:00.000Z');
      expect(result.parseError).toBeNull();
    });

    it('accepts UTC-Z date directly', () => {
      const [result] = parseInbox(entry({ ...VALID_FIELDS, date: '2026-06-28T22:30:00.000Z' }));
      expect(result.parsedDate).toBe('2026-06-28T22:30:00.000Z');
      expect(result.parseError).toBeNull();
    });

    it('accepts minute-precision ISO string with offset (no seconds)', () => {
      const [result] = parseInbox(entry({ ...VALID_FIELDS, date: '2026-06-28T15:30-07:00' }));
      expect(result.parsedDate).toBe('2026-06-28T22:30:00.000Z');
      expect(result.parseError).toBeNull();
    });

    it('rejects a loosely-formatted non-ISO date string', () => {
      const [result] = parseInbox(entry({ ...VALID_FIELDS, date: 'June 28 2026' }));
      expect(result.parseError).toMatch(/invalid date format/i);
      expect(result.parsedDate).toBeNull();
    });

    it('rejects a date-only string (no time)', () => {
      const [result] = parseInbox(entry({ ...VALID_FIELDS, date: '2026-06-28' }));
      expect(result.parseError).toMatch(/invalid date format/i);
    });

    it('rejects a datetime string without offset or Z', () => {
      const [result] = parseInbox(entry({ ...VALID_FIELDS, date: '2026-06-28T15:30:00' }));
      expect(result.parseError).toMatch(/invalid date format/i);
    });
  });

  describe('required field validation', () => {
    it('parse error when id is missing', () => {
      const [result] = parseInbox(entry({ date: '2026-06-28T15:30:00-07:00', contact: 'Alice Smith' }));
      expect(result.parseError).toMatch(/missing required field: id/i);
    });

    it('parse error when id does not match 8 hex chars', () => {
      const [result] = parseInbox(entry({ ...VALID_FIELDS, id: 'xyz' }));
      expect(result.parseError).toMatch(/invalid id format/i);
    });

    it('parse error when id has wrong length (too long)', () => {
      const [result] = parseInbox(entry({ ...VALID_FIELDS, id: 'a3f7c2b1ff' }));
      expect(result.parseError).toMatch(/invalid id format/i);
    });

    it('parse error when date is missing', () => {
      const [result] = parseInbox(entry({ id: 'a3f7c2b1', contact: 'Alice Smith' }));
      expect(result.parseError).toMatch(/missing required field: date/i);
    });

    it('parse error when contact is missing', () => {
      const [result] = parseInbox(entry({ id: 'a3f7c2b1', date: '2026-06-28T15:30:00-07:00' }));
      expect(result.parseError).toMatch(/missing required field: contact/i);
    });

    it('parse error when contact is empty string after trimming', () => {
      const [result] = parseInbox(entry({ id: 'a3f7c2b1', date: '2026-06-28T15:30:00-07:00', contact: '   ' }));
      expect(result.parseError).toMatch(/missing required field: contact/i);
    });

    it('parse error for unclosed block', () => {
      const content = '---\nid: a3f7c2b1\ndate: 2026-06-28T15:30:00-07:00\ncontact: Alice\n';
      const [result] = parseInbox(content);
      expect(result.parseError).toMatch(/unclosed block/i);
    });

    it('rawText of unclosed block contains all content from the opening ---', () => {
      const content = '---\nid: a3f7c2b1\ncontact: Alice\n';
      const [result] = parseInbox(content);
      expect(result.rawText).toContain('---');
      expect(result.rawText).toContain('Alice');
    });
  });

  describe('type normalization', () => {
    it('defaults type to meeting when field is absent — no parse error', () => {
      const [result] = parseInbox(entry({ id: 'a3f7c2b1', date: '2026-06-28T15:30:00-07:00', contact: 'Alice' }));
      expect(result.parseError).toBeNull();
      expect(result.parsedType).toBe('meeting');
    });

    it('defaults type to meeting when value is unrecognized — no parse error', () => {
      const [result] = parseInbox(entry({ ...VALID_FIELDS, type: 'conference' }));
      expect(result.parseError).toBeNull();
      expect(result.parsedType).toBe('meeting');
    });

    it('accepts all five valid type values', () => {
      for (const t of ['meeting', 'call', 'email', 'message', 'other']) {
        const [result] = parseInbox(entry({ ...VALID_FIELDS, type: t }));
        expect(result.parsedType).toBe(t);
      }
    });
  });

  describe('optional fields', () => {
    it('sets parsedLocation to null when location is absent — no error', () => {
      const [result] = parseInbox(entry(VALID_FIELDS));
      expect(result.parsedLocation).toBeNull();
      expect(result.parseError).toBeNull();
    });

    it('sets parsedSummary to null when summary is absent — no error', () => {
      const [result] = parseInbox(entry(VALID_FIELDS));
      expect(result.parsedSummary).toBeNull();
      expect(result.parseError).toBeNull();
    });
  });

  describe('parsedType null on parse error', () => {
    it('parsedType is null when entry has a parse error', () => {
      const [result] = parseInbox(entry({ date: '2026-06-28T15:30:00-07:00', contact: 'Alice', type: 'call' }));
      expect(result.parseError).not.toBeNull();
      expect(result.parsedType).toBeNull();
    });
  });
});
