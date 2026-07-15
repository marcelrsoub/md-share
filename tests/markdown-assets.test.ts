import { describe, expect, it } from 'vitest';
import { resolveMarkdownImageSource } from '../src/client/shared/markdown-assets.js';

describe('resolveMarkdownImageSource', () => {
  it('keeps http images remote and proxies local images through the caller', () => {
    const resolveLocal = (source: string) => `/assets?path=${encodeURIComponent(source)}`;

    expect(resolveMarkdownImageSource('https://example.com/cover.png', resolveLocal)).toBe('https://example.com/cover.png');
    expect(resolveMarkdownImageSource('cover.png', resolveLocal)).toBe('/assets?path=cover.png');
  });

  it('rejects unsupported image URL schemes', () => {
    expect(resolveMarkdownImageSource('javascript:alert(1)', () => '/assets')).toBeNull();
    expect(resolveMarkdownImageSource('//example.com/cover.png', () => '/assets')).toBeNull();
  });
});
