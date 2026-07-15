export function resolveMarkdownImageSource(
  source: string,
  resolveLocalSource?: (source: string) => string | null,
): string | null {
  const trimmed = source.trim();
  if (!trimmed) {
    return null;
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) || trimmed.startsWith('//')) {
    return null;
  }

  return resolveLocalSource ? resolveLocalSource(trimmed) : trimmed;
}
