import type { HTMLAttributes } from 'react';

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={['ui-card panel', className].filter(Boolean).join(' ')} {...props} />;
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={['ui-card-header', className].filter(Boolean).join(' ')} {...props} />;
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={['ui-card-title', className].filter(Boolean).join(' ')} {...props} />;
}

export function CardDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={['ui-card-description', className].filter(Boolean).join(' ')} {...props} />;
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={['ui-card-content', className].filter(Boolean).join(' ')} {...props} />;
}

export function CardFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={['ui-card-footer', className].filter(Boolean).join(' ')} {...props} />;
}
