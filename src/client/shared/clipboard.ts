export interface ClipboardCopyResult {
  copied: boolean;
  method: 'clipboard' | 'execCommand' | 'unavailable';
}

export async function copyTextToClipboard(text: string): Promise<ClipboardCopyResult> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return { copied: true, method: 'clipboard' };
    }

    if (typeof document !== 'undefined' && typeof document.execCommand === 'function') {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      textarea.style.pointerEvents = 'none';

      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();

      try {
        const copied = document.execCommand('copy');
        return { copied, method: copied ? 'execCommand' : 'unavailable' };
      } finally {
        document.body.removeChild(textarea);
      }
    }
  } catch {
    // Clipboard support is best-effort; callers should keep going even if it fails.
  }

  return { copied: false, method: 'unavailable' };
}
