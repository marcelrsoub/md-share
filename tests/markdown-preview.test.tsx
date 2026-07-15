import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MarkdownPreview } from '../src/client/components/markdown-preview.js';

describe('MarkdownPreview', () => {
  it('preserves multiline blockquotes as separate paragraphs', () => {
    const markup = renderToStaticMarkup(
      <MarkdownPreview
        content={['> First line', '> second line', '', '> Another paragraph'].join('\n')}
      />,
    );

    expect(markup).toContain('markdown-blockquote-body');
    expect(markup).toContain('First line<br/>second line');
    expect(markup).toContain('Another paragraph');
  });

  it('renders fenced code blocks as a structured block with a language badge', () => {
    const markup = renderToStaticMarkup(
      <MarkdownPreview content={['```ts', 'const value = 42;', '```'].join('\n')} />,
    );

    expect(markup).toContain('markdown-codeblock');
    expect(markup).toContain('markdown-codebar');
    expect(markup).toContain('markdown-codebadge');
    expect(markup).toContain('<span>ts</span>');
    expect(markup).toContain('const value = 42;');
    expect(markup).not.toContain('```');
  });

  it('keeps list types separate and renders nested task items', () => {
    const markup = renderToStaticMarkup(
      <MarkdownPreview
        content={['- unordered', '  - nested', '', '1. ordered', '2. second', '', '- [x] done'].join('\n')}
      />,
    );

    expect(markup.match(/class="markdown-list/g)).toHaveLength(4);
    expect(markup).toContain('<ol class="markdown-list is-ordered">');
    expect(markup).toContain('type="checkbox"');
    expect(markup).toContain('checked=""');
  });

  it('renders aligned tables with semantic headers and cells', () => {
    const markup = renderToStaticMarkup(
      <MarkdownPreview
        content={['| Name | Status |', '| :--- | ---: |', '| **MD Share** | Ready |'].join('\n')}
      />,
    );

    expect(markup).toContain('markdown-table-wrap');
    expect(markup).toContain('<thead>');
    expect(markup).toContain('<th style="text-align:left" scope="col">Name</th>');
    expect(markup).toContain('<th style="text-align:right" scope="col">Status</th>');
    expect(markup).toContain('<strong>MD Share</strong>');
    expect(markup).toContain('<td style="text-align:right">Ready</td>');
  });
});
