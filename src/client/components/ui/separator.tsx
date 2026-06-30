import type { HTMLAttributes } from 'react';

export function Separator({ className, orientation = 'horizontal', ...props }: HTMLAttributes<HTMLDivElement> & { orientation?: 'horizontal' | 'vertical' }) {
  return (
    <div
      role="separator"
      aria-orientation={orientation}
      className={['ui-separator', orientation === 'vertical' ? 'is-vertical' : 'is-horizontal', className].filter(Boolean).join(' ')}
      {...props}
    />
  );
}
