import { describe, expect, it } from 'vitest';

import { defineTemplate, escapeHtml } from './mail-template.js';

const greeting = defineTemplate((data: { name: string; lines: string[] }) => ({
  subject: `Hello ${data.name}`,
  paragraphs: [`Hi ${data.name},`, data.lines.join('\n')],
}));

describe('defineTemplate', () => {
  it('Builds the subject from the data', () => {
    expect(greeting({ name: 'Ada', lines: [] }).subject).toBe('Hello Ada');
  });

  it('Separates paragraphs with a blank line in the text part', () => {
    expect(greeting({ name: 'Ada', lines: ['one', 'two'] }).text).toBe('Hi Ada,\n\none\ntwo');
  });

  it('Renders each paragraph as a <p> and a newline as <br> in the html part', () => {
    const { html } = greeting({ name: 'Ada', lines: ['one', 'two'] });

    expect(html).toContain('>Hi Ada,</p>');
    expect(html).toContain('>one<br>two</p>');
    expect(html).toContain('<title>Hello Ada</title>');
  });

  it('Escapes data in the html part, so a value cannot inject markup', () => {
    const { html, text } = greeting({ name: '<script>alert(1)</script>', lines: [] });

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(text).toContain('<script>alert(1)</script>');
  });
});

describe('escapeHtml', () => {
  it('Escapes every character that is special in markup or an attribute', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
  });
});
