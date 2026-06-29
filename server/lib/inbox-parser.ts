import type { Interaction } from '../schemas/interaction.js';

export interface ParsedEntry {
  rawId:          string;
  rawText:        string;
  parsedDate:     string | null;
  parsedContact:  string | null;
  parsedType:     Interaction['type'] | null;
  parsedSummary:  string | null;
  parsedLocation: string | null;
  parseError:     string | null;
}

const VALID_TYPES: ReadonlySet<string> = new Set(['meeting', 'call', 'email', 'message', 'other']);

// Strict ISO 8601: requires date, time, and offset (or Z). Seconds are optional.
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

const DELIMITER = '---';

/**
 * Parse the full text of inbox.txt into individual entries.
 *
 * Pure function — no I/O, no side effects. Returns one ParsedEntry per
 * --- block, including malformed ones (never silently discards an entry).
 */
export function parseInbox(content: string): ParsedEntry[] {
  if (!content.trim()) return [];

  const lines = content.split('\n');
  const results: ParsedEntry[] = [];
  let i = 0;

  while (i < lines.length) {
    // Seek next opening ---
    if (lines[i].trimEnd() !== DELIMITER) {
      i++;
      continue;
    }

    const openIdx = i;
    i++;

    // Find closing ---
    let closeIdx = -1;
    for (let j = i; j < lines.length; j++) {
      if (lines[j].trimEnd() === DELIMITER) {
        closeIdx = j;
        break;
      }
    }

    if (closeIdx === -1) {
      // Unclosed block: everything from openIdx to EOF is one malformed entry
      const rawText = lines.slice(openIdx).join('\n');
      results.push(makeErrorEntry('', rawText, 'Unclosed block: no closing --- found'));
      break;
    }

    const blockLines = lines.slice(i, closeIdx);
    const rawText = [DELIMITER, ...blockLines, DELIMITER].join('\n');

    results.push(parseBlock(blockLines, rawText));
    i = closeIdx + 1;
  }

  return results;
}

function parseBlock(blockLines: string[], rawText: string): ParsedEntry {
  let rawId = '';
  let rawDate = '';
  let rawContact = '';
  let rawType = '';
  let rawLocation = '';
  let summaryFirstLine: string | null = null;
  const summaryContinuation: string[] = [];
  let inSummary = false;

  for (const line of blockLines) {
    if (inSummary) {
      summaryContinuation.push(line);
      continue;
    }

    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;

    const key = line.slice(0, colonIdx).trim().toLowerCase();
    const value = line.slice(colonIdx + 1).trimStart();

    switch (key) {
      case 'id':       rawId = value.trimEnd(); break;
      case 'date':     rawDate = value.trimEnd(); break;
      case 'contact':  rawContact = value.trimEnd(); break;
      case 'type':     rawType = value.trimEnd(); break;
      case 'location': rawLocation = value.trimEnd(); break;
      case 'summary':
        summaryFirstLine = value.trimEnd();
        inSummary = true;
        break;
    }
  }

  const errors: string[] = [];

  // Validate id
  if (!rawId) {
    errors.push('Missing required field: id');
  } else if (!/^[0-9a-fA-F]{8}$/.test(rawId)) {
    errors.push(`Invalid id format (expected 8 hex chars): ${rawId}`);
  }

  // Validate and convert date
  let parsedDate: string | null = null;
  if (!rawDate) {
    errors.push('Missing required field: date');
  } else if (!ISO_DATE_RE.test(rawDate)) {
    errors.push(`Invalid date format (expected ISO 8601 with offset): ${rawDate}`);
  } else {
    parsedDate = new Date(rawDate).toISOString();
  }

  // Validate contact
  const parsedContact = rawContact.trim() || null;
  if (!parsedContact) {
    errors.push('Missing required field: contact');
  }

  // Type: default to 'meeting' if absent or unrecognized (not an error)
  const parsedType: Interaction['type'] = (VALID_TYPES.has(rawType) ? rawType : 'meeting') as Interaction['type'];

  // Location: optional
  const parsedLocation = rawLocation.trim() || null;

  // Summary: join first line + continuations, trim
  let parsedSummary: string | null = null;
  if (summaryFirstLine !== null) {
    const full = [summaryFirstLine, ...summaryContinuation].join('\n').trim();
    parsedSummary = full || null;
  }

  const parseError = errors.length > 0 ? errors.join('; ') : null;

  return {
    rawId,
    rawText,
    parsedDate,
    parsedContact,
    parsedType: parseError ? null : parsedType,
    parsedSummary,
    parsedLocation,
    parseError,
  };
}

function makeErrorEntry(rawId: string, rawText: string, parseError: string): ParsedEntry {
  return {
    rawId,
    rawText,
    parsedDate: null,
    parsedContact: null,
    parsedType: null,
    parsedSummary: null,
    parsedLocation: null,
    parseError,
  };
}
