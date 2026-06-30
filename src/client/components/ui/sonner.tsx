import type { ComponentProps } from 'react';
import { Toaster as SonnerToaster, toast, useSonner } from 'sonner';
import 'sonner/dist/styles.css';

export function Toaster(props: ComponentProps<typeof SonnerToaster>) {
  const { toasts } = useSonner();

  if (toasts.length === 0) {
    return null;
  }

  return (
    <SonnerToaster
      theme="dark"
      richColors
      closeButton
      containerAriaLabel=" "
      hotkey={[]}
      className="sonner-toaster"
      toastOptions={{
        className: 'sonner-toast',
        descriptionClassName: 'sonner-toast-description',
      }}
      {...props}
    />
  );
}

export { toast };
