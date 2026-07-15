import { cssLanguage } from '@codemirror/lang-css';
import { htmlLanguage } from '@codemirror/lang-html';
import { javascriptLanguage, jsxLanguage, tsxLanguage, typescriptLanguage } from '@codemirror/lang-javascript';
import { jsonLanguage } from '@codemirror/lang-json';
import type { Language } from '@codemirror/language';

function normalizeCodeLanguageInfo(info: string): string {
  return info.trim().toLowerCase().split(/\s+/, 1)[0] ?? '';
}

export function resolveMarkdownCodeLanguage(info: string): Language | null {
  switch (normalizeCodeLanguageInfo(info)) {
    case 'js':
    case 'mjs':
    case 'cjs':
    case 'javascript':
    case 'node':
      return javascriptLanguage;
    case 'ts':
    case 'mts':
    case 'cts':
    case 'typescript':
      return typescriptLanguage;
    case 'jsx':
      return jsxLanguage;
    case 'tsx':
      return tsxLanguage;
    case 'html':
    case 'htm':
    case 'xhtml':
    case 'svg':
      return htmlLanguage;
    case 'css':
    case 'scss':
    case 'sass':
    case 'less':
      return cssLanguage;
    case 'json':
    case 'jsonc':
      return jsonLanguage;
    default:
      return null;
  }
}
