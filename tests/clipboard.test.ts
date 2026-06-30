import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyTextToClipboard } from '../src/client/shared/clipboard.js';

const originalNavigator = globalThis.navigator;
const originalDocument = globalThis.document;

afterEach(() => {
  vi.restoreAllMocks();

  if (originalNavigator === undefined) {
    Reflect.deleteProperty(globalThis, 'navigator');
  } else {
    Object.defineProperty(globalThis, 'navigator', {
      value: originalNavigator,
      configurable: true,
    });
  }

  if (originalDocument === undefined) {
    Reflect.deleteProperty(globalThis, 'document');
  } else {
    Object.defineProperty(globalThis, 'document', {
      value: originalDocument,
      configurable: true,
    });
  }
});

describe('copyTextToClipboard', () => {
  it('uses navigator clipboard when available', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(globalThis, 'navigator', {
      value: { clipboard: { writeText } },
      configurable: true,
    });
    Reflect.deleteProperty(globalThis, 'document');

    const result = await copyTextToClipboard('https://example.test/share');

    expect(writeText).toHaveBeenCalledWith('https://example.test/share');
    expect(result).toEqual({ copied: true, method: 'clipboard' });
  });

  it('returns unavailable when navigator clipboard rejects', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    Object.defineProperty(globalThis, 'navigator', {
      value: { clipboard: { writeText } },
      configurable: true,
    });
    Reflect.deleteProperty(globalThis, 'document');

    const result = await copyTextToClipboard('https://example.test/share');

    expect(writeText).toHaveBeenCalledWith('https://example.test/share');
    expect(result).toEqual({ copied: false, method: 'unavailable' });
  });

  it('falls back to execCommand when navigator clipboard is unavailable', async () => {
    const execCommand = vi.fn().mockReturnValue(true);
    const appended: unknown[] = [];
    const removed: unknown[] = [];
    const textarea = {
      value: '',
      style: {},
      setAttribute: vi.fn(),
      focus: vi.fn(),
      select: vi.fn(),
    };

    Object.defineProperty(globalThis, 'navigator', {
      value: {},
      configurable: true,
    });
    Object.defineProperty(globalThis, 'document', {
      value: {
        createElement: vi.fn(() => textarea),
        execCommand,
        body: {
          appendChild: vi.fn((node: unknown) => appended.push(node)),
          removeChild: vi.fn((node: unknown) => removed.push(node)),
        },
      },
      configurable: true,
    });

    const result = await copyTextToClipboard('https://example.test/share');

    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(appended).toHaveLength(1);
    expect(removed).toHaveLength(1);
    expect((textarea as { value: string }).value).toBe('https://example.test/share');
    expect(result).toEqual({ copied: true, method: 'execCommand' });
  });

  it('returns unavailable when no clipboard mechanism exists', async () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: {},
      configurable: true,
    });
    Reflect.deleteProperty(globalThis, 'document');

    const result = await copyTextToClipboard('https://example.test/share');

    expect(result).toEqual({ copied: false, method: 'unavailable' });
  });
});
