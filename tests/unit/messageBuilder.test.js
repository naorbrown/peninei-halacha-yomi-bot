/**
 * MessageBuilder tests — escMd, buildCaption, buildWelcomeMessage
 */

import { describe, it, expect } from 'vitest';
import { escMd, buildCaption, buildWelcomeMessage } from '../../src/messageBuilder.js';

// ---------------------------------------------------------------------------
// MARKDOWN ESCAPING
// ---------------------------------------------------------------------------

describe('Markdown escaping — escMd()', () => {
  it('escapes underscores, asterisks, backticks, and brackets', () => {
    expect(escMd('hello_world')).toBe('hello\\_world');
    expect(escMd('**bold**')).toBe('\\*\\*bold\\*\\*');
    expect(escMd('`code`')).toBe('\\`code\\`');
    expect(escMd('[link]')).toBe('\\[link]');
  });

  it('handles combined special characters', () => {
    expect(escMd('_*`[')).toBe('\\_\\*\\`\\[');
  });

  it('passes through normal text unchanged', () => {
    expect(escMd('פרק כו הלכות שבת')).toBe('פרק כו הלכות שבת');
    expect(escMd('Hello World 123')).toBe('Hello World 123');
  });

  it('handles empty and null input', () => {
    expect(escMd('')).toBe('');
    expect(escMd(null)).toBe('');
    expect(escMd(undefined)).toBe('');
  });

  it('handles extremely long title strings', () => {
    const longTitle = 'א'.repeat(10000);
    expect(escMd(longTitle)).toHaveLength(10000);
  });
});

// ---------------------------------------------------------------------------
// BUILD CAPTION
// ---------------------------------------------------------------------------

describe('Message formatting — buildCaption()', () => {
  it('builds correct caption for first halacha', () => {
    const h = {
      url: 'https://ph.yhb.org.il/20-26-12/',
      title: 'פרק כו – הלכות שבת – סעיף יב',
      audioUrl: 'https://cdn1.yhb.org.il/mp3/20-26-12.mp3',
    };
    const caption = buildCaption(h, 0);
    expect(caption).toContain('*הלכה א:*');
    expect(caption).not.toContain('undefined');
    expect(caption).toContain('לקריאה באתר');
  });

  it('builds correct caption for second halacha', () => {
    const h = {
      url: 'https://ph.yhb.org.il/20-26-13/',
      title: 'פרק כו – הלכות שבת – סעיף יג',
      audioUrl: 'https://cdn1.yhb.org.il/mp3/20-26-13.mp3',
    };
    const caption = buildCaption(h, 1);
    expect(caption).toContain('*הלכה ב:*');
  });

  it('escapes parentheses in URLs for Markdown safety', () => {
    const h = {
      url: 'https://ph.yhb.org.il/page-(1)/',
      title: 'Test',
      audioUrl: null,
    };
    const caption = buildCaption(h, 0);
    expect(caption).not.toContain(')(');
    expect(caption).toContain('%29');
  });

  it('escapes Markdown special chars in titles', () => {
    const h = {
      url: 'https://ph.yhb.org.il/20-26-12/',
      title: 'הלכות_שבת *חלק*',
      audioUrl: null,
    };
    const caption = buildCaption(h, 0);
    expect(caption).toContain('הלכות\\_שבת');
    expect(caption).toContain('\\*חלק\\*');
  });
});

// ---------------------------------------------------------------------------
// WELCOME MESSAGE
// ---------------------------------------------------------------------------

describe('buildWelcomeMessage()', () => {
  it('returns Hebrew welcome text with commands', () => {
    const msg = buildWelcomeMessage();
    expect(msg).toContain('ברוכים הבאים');
    expect(msg).toContain('/today');
    expect(msg).toContain('/stop');
  });
});
