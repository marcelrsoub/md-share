import type { HTMLAttributes } from 'react';

type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

export function Badge({ variant = 'default', className, ...props }: BadgeProps) {
  const variantClass =
    variant === 'secondary'
      ? 'subtle-chip'
      : variant === 'destructive'
        ? 'status-pill tone-bad'
        : variant === 'outline'
          ? 'status-pill tone-neutral'
          : 'status-pill tone-good';

  return <span className={[variantClass, className].filter(Boolean).join(' ')} {...props} />;
}
