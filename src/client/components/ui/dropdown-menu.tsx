import { createContext, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Check } from 'lucide-react';

interface DropdownMenuContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
  contentRef: RefObject<HTMLDivElement | null>;
  contentId: string;
}

const DropdownMenuContext = createContext<DropdownMenuContextValue | null>(null);

function useDropdownMenuContext(): DropdownMenuContextValue {
  const context = useContext(DropdownMenuContext);
  if (!context) {
    throw new Error('DropdownMenu components must be used within DropdownMenu.');
  }

  return context;
}

export interface DropdownMenuProps {
  children: ReactNode;
}

export function DropdownMenu({ children }: DropdownMenuProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const contentId = useId();

  const value = useMemo<DropdownMenuContextValue>(
    () => ({
      open,
      setOpen,
      triggerRef,
      contentRef,
      contentId,
    }),
    [contentId, open],
  );

  return <DropdownMenuContext.Provider value={value}>{children}</DropdownMenuContext.Provider>;
}

export function DropdownMenuTrigger({ children, className, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  const { open, setOpen, triggerRef, contentId } = useDropdownMenuContext();

  return (
    <button
      type="button"
      ref={triggerRef}
      aria-haspopup="menu"
      aria-expanded={open}
      aria-controls={contentId}
      className={className}
      onClick={() => setOpen(!open)}
      {...props}
    >
      {children}
      <ChevronDown aria-hidden="true" className="dropdown-trigger-icon" />
    </button>
  );
}

interface DropdownMenuContentProps extends HTMLAttributes<HTMLDivElement> {
  align?: 'start' | 'end' | 'center';
  sideOffset?: number;
}

interface DropdownPlacement {
  top: number;
  left: number;
  minWidth: number;
}

function computePlacement(
  trigger: DOMRect,
  contentWidth: number,
  align: 'start' | 'end' | 'center',
  sideOffset: number,
): DropdownPlacement {
  const viewportPadding = 12;
  const maxLeft = window.innerWidth - viewportPadding - contentWidth;
  const startLeft = trigger.left;
  const endLeft = trigger.right - contentWidth;
  const centerLeft = trigger.left + (trigger.width - contentWidth) / 2;

  let left = align === 'end' ? endLeft : align === 'center' ? centerLeft : startLeft;
  left = Math.min(Math.max(left, viewportPadding), Math.max(viewportPadding, maxLeft));

  return {
    top: trigger.bottom + sideOffset,
    left,
    minWidth: Math.max(trigger.width, contentWidth),
  };
}

export function DropdownMenuContent({ children, className, align = 'start', sideOffset = 8, ...props }: DropdownMenuContentProps) {
  const { open, setOpen, triggerRef, contentRef, contentId } = useDropdownMenuContext();
  const [placement, setPlacement] = useState<DropdownPlacement | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPlacement(null);
      return;
    }

    const trigger = triggerRef.current;
    const content = contentRef.current;
    if (!trigger || !content) {
      return;
    }

    const updatePosition = (): void => {
      const triggerRect = trigger.getBoundingClientRect();
      const contentRect = content.getBoundingClientRect();
      setPlacement(computePlacement(triggerRect, contentRect.width || 240, align, sideOffset));
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);

    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [align, contentRef, open, sideOffset, triggerRef]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      const trigger = triggerRef.current;
      const content = contentRef.current;
      if (trigger?.contains(target) || content?.contains(target)) {
        return;
      }

      setOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, setOpen, triggerRef, contentRef]);

  if (!open || typeof document === 'undefined') {
    return null;
  }

  return createPortal(
    <div
      id={contentId}
      ref={contentRef}
      role="menu"
      className={['dropdown-menu-content', className].filter(Boolean).join(' ')}
      style={{
        top: `${placement?.top ?? 0}px`,
        left: `${placement?.left ?? 0}px`,
        minWidth: `${placement?.minWidth ?? 0}px`,
        opacity: placement ? 1 : 0,
        pointerEvents: placement ? 'auto' : 'none',
      }}
      {...props}
    >
      {children}
    </div>,
    document.body,
  );
}

export function DropdownMenuItem({
  children,
  className,
  checked = false,
  onClick,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { checked?: boolean }) {
  const { setOpen } = useDropdownMenuContext();

  return (
    <button
      type="button"
      role="menuitem"
      className={['dropdown-menu-item', className].filter(Boolean).join(' ')}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) {
          setOpen(false);
        }
      }}
      {...props}
      >
      <span className="dropdown-menu-item-label">{children}</span>
      <Check aria-hidden="true" className={['dropdown-menu-item-check', checked ? 'is-visible' : ''].filter(Boolean).join(' ')} />
    </button>
  );
}
