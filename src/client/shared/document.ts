type MetaSelector = `meta[name="${string}"]` | `meta[property="${string}"]`;

function upsertMeta(selector: MetaSelector, attribute: 'name' | 'property', key: string, content: string): void {
  let element = document.head.querySelector<HTMLMetaElement>(selector);
  if (!element) {
    element = document.createElement('meta');
    element.setAttribute(attribute, key);
    document.head.appendChild(element);
  }

  element.setAttribute('content', content);
}

export function setDocumentMetadata(input: {
  title: string;
  description: string;
  robots?: string;
}): void {
  document.title = input.title;
  upsertMeta('meta[name="description"]', 'name', 'description', input.description);
  upsertMeta('meta[property="og:title"]', 'property', 'og:title', input.title);
  upsertMeta('meta[property="og:description"]', 'property', 'og:description', input.description);

  if (input.robots) {
    upsertMeta('meta[name="robots"]', 'name', 'robots', input.robots);
  }
}
