import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearToasts, dismissToast, getToasts, pushToast, subscribe } from '../src/client/components/ui/toast-store.js';

afterEach(() => {
  clearToasts();
  vi.useRealTimers();
});

describe('toast store', () => {
  it('stores toasts and auto-dismisses them after their duration', async () => {
    vi.useFakeTimers();

    const updates: number[] = [];
    const unsubscribe = subscribe(() => {
      updates.push(getToasts().length);
    });

    const id = pushToast({
      message: 'Share link copied.',
      variant: 'success',
      duration: 1000,
    });

    expect(getToasts()).toHaveLength(1);
    expect(getToasts()[0]).toMatchObject({
      id,
      message: 'Share link copied.',
      variant: 'success',
      duration: 1000,
    });

    await vi.advanceTimersByTimeAsync(1000);

    expect(getToasts()).toHaveLength(0);
    expect(updates).toEqual([1, 0]);

    unsubscribe();
  });

  it('dismisses a toast immediately and cancels the timer', async () => {
    vi.useFakeTimers();

    const id = pushToast({
      message: 'Failed to copy link.',
      variant: 'error',
      duration: 1000,
    });

    dismissToast(id);
    expect(getToasts()).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1000);
    expect(getToasts()).toHaveLength(0);
  });
});
