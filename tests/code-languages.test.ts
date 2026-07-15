import { cssLanguage } from '@codemirror/lang-css';
import { htmlLanguage } from '@codemirror/lang-html';
import { javascriptLanguage, jsxLanguage, tsxLanguage, typescriptLanguage } from '@codemirror/lang-javascript';
import { jsonLanguage } from '@codemirror/lang-json';
import { describe, expect, it } from 'vitest';
import { resolveMarkdownCodeLanguage } from '../src/client/shared/code-languages.js';

describe('resolveMarkdownCodeLanguage', () => {
  it('maps common fenced code language aliases to CodeMirror languages', () => {
    expect(resolveMarkdownCodeLanguage('js')).toBe(javascriptLanguage);
    expect(resolveMarkdownCodeLanguage('typescript')).toBe(typescriptLanguage);
    expect(resolveMarkdownCodeLanguage('jsx')).toBe(jsxLanguage);
    expect(resolveMarkdownCodeLanguage('tsx')).toBe(tsxLanguage);
    expect(resolveMarkdownCodeLanguage('html')).toBe(htmlLanguage);
    expect(resolveMarkdownCodeLanguage('css')).toBe(cssLanguage);
    expect(resolveMarkdownCodeLanguage('json')).toBe(jsonLanguage);
  });

  it('ignores unsupported code fence languages', () => {
    expect(resolveMarkdownCodeLanguage('mermaid')).toBeNull();
  });
});
