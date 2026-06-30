import type { ButtonHTMLAttributes } from 'react';

type ButtonVariant = 'default' | 'secondary' | 'ghost' | 'destructive' | 'outline' | 'icon';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

export function Button({ variant = 'default', className, type = 'button', ...props }: ButtonProps) {
  const variantClass =
    variant === 'default'
      ? 'button-primary'
      : variant === 'ghost'
        ? 'button-ghost'
        : variant === 'icon'
          ? 'icon-button'
          : variant === 'destructive'
            ? 'button-ghost danger-button'
            : 'button-ghost';

  return <button type={type} className={[variantClass, className].filter(Boolean).join(' ')} {...props} />;
}
