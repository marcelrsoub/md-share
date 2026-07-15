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
});
