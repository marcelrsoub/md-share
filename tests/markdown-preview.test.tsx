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
    expect(markup).not.toContain('markdown-blockquote-icon');
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
    expect(markup).not.toContain('SquareTerminal');
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

  it('renders supported inline formatting with recursive link labels', () => {
    const markup = renderToStaticMarkup(
      <MarkdownPreview content={'**bold** __strong__ *italic* _emphasis_ ~~removed~~ `code` ==highlight== [**linked**](https://example.com)'} />,
    );

    expect(markup).toContain('<strong>bold</strong>');
    expect(markup).toContain('<strong>strong</strong>');
    expect(markup).toContain('<em>italic</em>');
    expect(markup).toContain('<em>emphasis</em>');
    expect(markup).toContain('<del>removed</del>');
    expect(markup).toContain('<code class="markdown-inline-code">code</code>');
    expect(markup).toContain('<mark class="markdown-highlight">highlight</mark>');
    expect(markup).toContain('<a href="https://example.com" target="_blank" rel="noreferrer"><strong>linked</strong>');
    expect(markup).not.toContain('markdown-link-icon');
  });

  it('preserves literal brackets and invalid image syntax', () => {
    const markup = renderToStaticMarkup(
      <MarkdownPreview content="Parentheses (stay) and [brackets] should remain. ![not an image]" />,
    );

    expect(markup).toContain('Parentheses (stay) and [brackets] should remain. ![not an image]');
  });

  it('sets external link targets but leaves internal anchors in the current context', () => {
    const markup = renderToStaticMarkup(
      <MarkdownPreview content="[External](https://example.com) [Section](#section)" />,
    );

    expect(markup).toContain('<a href="https://example.com" target="_blank" rel="noreferrer">External</a>');
    expect(markup).toContain('<a href="#section">Section</a>');
  });

  it('marks checked task items for muted styling', () => {
    const markup = renderToStaticMarkup(<MarkdownPreview content="- [x] completed" />);

    expect(markup).toContain('<li class="is-task is-checked">');
    expect(markup).toContain('<span class="markdown-task-toggle is-checked"><input class="markdown-task-checkbox" type="checkbox"');
    expect(markup).toContain('disabled="" aria-label="Completed task"');
    expect(markup).toContain('checked=""');
    expect(markup).not.toContain('aria-hidden="true"');
  });

  it('renders image alt text as a figure caption', () => {
    const markup = renderToStaticMarkup(
      <MarkdownPreview content="![A caption](image.png)" resolveImageUrl={() => '/image.png'} />,
    );

    expect(markup).toContain('<figcaption class="markdown-figure-caption">A caption</figcaption>');
  });
});
