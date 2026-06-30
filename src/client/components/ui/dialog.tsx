import { createContext, useContext, type HTMLAttributes, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { Button } from './button.js';

interface DialogContextValue {
  onOpenChange: (open: boolean) => void;
}

const DialogContext = createContext<DialogContextValue | null>(null);

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}

export function Dialog({ open, onOpenChange, children }: DialogProps) {
  if (!open) {
    return null;
  }

  return <DialogContext.Provider value={{ onOpenChange }}>{children}</DialogContext.Provider>;
}

export function DialogContent({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  const context = useContext(DialogContext);

  if (!context) {
    return null;
  }

  return (
    <div className="settings-backdrop" role="presentation" onMouseDown={() => context.onOpenChange(false)}>
      <section
        className={['settings-dialog panel', className].filter(Boolean).join(' ')}
        role="dialog"
        aria-modal="true"
        onMouseDown={(event) => event.stopPropagation()}
        {...props}
      >
        {children}
      </section>
    </div>
  );
}

export function DialogHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={['settings-dialog-header', className].filter(Boolean).join(' ')} {...props} />;
}

export function DialogTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={['ui-dialog-title', className].filter(Boolean).join(' ')} {...props} />;
}

export function DialogDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={['ui-dialog-description', className].filter(Boolean).join(' ')} {...props} />;
}

export function DialogBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={['settings-dialog-body', className].filter(Boolean).join(' ')} {...props} />;
}

export function DialogFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={['settings-dialog-footer', className].filter(Boolean).join(' ')} {...props} />;
}

export function DialogClose({ className, ...props }: HTMLAttributes<HTMLButtonElement>) {
  const context = useContext(DialogContext);
  return (
    <Button
      variant="icon"
      aria-label="Close dialog"
      className={className}
      onClick={() => context?.onOpenChange(false)}
      {...props}
    >
      <X />
    </Button>
  );
}
