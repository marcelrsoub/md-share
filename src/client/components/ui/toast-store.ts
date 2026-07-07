export type ToastVariant = 'default' | 'success' | 'error';

export interface ToastRecord {
  id: string;
  message: string;
  variant: ToastVariant;
  duration: number;
}

export interface ToastInput {
  message: string;
  duration?: number;
}

const DEFAULT_DURATION = 3200;
const ERROR_DURATION = 5000;

let nextToastId = 0;
let toasts: ToastRecord[] = [];
const listeners = new Set<() => void>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

function clearTimer(id: string): void {
  const timer = timers.get(id);
  if (timer) {
    clearTimeout(timer);
    timers.delete(id);
  }
}

export function getToasts(): ToastRecord[] {
  return toasts;
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function dismissToast(id: string): void {
  clearTimer(id);

  const nextToasts = toasts.filter((toast) => toast.id !== id);
  if (nextToasts.length === toasts.length) {
    return;
  }

  toasts = nextToasts;
  emit();
}

export function clearToasts(): void {
  for (const id of Array.from(timers.keys())) {
    clearTimer(id);
  }

  if (toasts.length === 0) {
    return;
  }

  toasts = [];
  emit();
}

function scheduleDismiss(id: string, duration: number): void {
  if (!Number.isFinite(duration) || duration <= 0) {
    return;
  }

  clearTimer(id);
  const timer = setTimeout(() => {
    timers.delete(id);
    dismissToast(id);
  }, duration);
  timers.set(id, timer);
}

export function pushToast(input: ToastInput & { variant: ToastVariant }): string {
  const id = `toast-${String(++nextToastId)}`;
  const duration =
    typeof input.duration === 'number'
      ? input.duration
      : input.variant === 'error'
        ? ERROR_DURATION
        : DEFAULT_DURATION;

  toasts = [
    ...toasts,
    {
      id,
      message: input.message,
      variant: input.variant,
      duration,
    },
  ];

  emit();
  scheduleDismiss(id, duration);
  return id;
}
