import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { IconName } from '../assets/manifest';
import { chromeStyle } from './theme';
import { PixelIcon } from './PixelSprite';
import { PixelButton } from './PixelButton';
import { PixelScroll } from './PixelScroll';

interface PanelProps {
  title?: ReactNode;
  icon?: IconName;
  /** Extra controls shown on the right of the title bar. */
  actions?: ReactNode;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

/** Framed panel using the panel_frame 9-slice. */
export function PixelPanel({ title, icon, actions, className, style, children }: PanelProps) {
  return (
    <section className={`px-panel ${className ?? ''}`} style={{ ...chromeStyle('panel_frame'), ...style }}>
      {(title || actions) && (
        <header className="px-panel-title">
          {icon && <PixelIcon name={icon} size={1} />}
          <span>{title}</span>
          <span className="px-spacer" />
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}

interface ModalProps {
  open: boolean;
  title: ReactNode;
  icon?: IconName;
  onClose?: () => void;
  width?: number | string;
  footer?: ReactNode;
  children?: ReactNode;
}

/**
 * Modal dialog with the modal_frame 9-slice, closes on Escape or backdrop click. The body is a
 * PixelScroll that gets the focus, so the arrow keys and Page Up / Down scroll it right away.
 */
export function PixelModal({ open, title, icon, onClose, width = 560, footer, children }: ModalProps) {
  const ref = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    (body.current ?? ref.current)?.focus({ preventScroll: true });
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div
      className="px-modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        className="px-modal"
        style={{ ...chromeStyle('modal_frame'), width }}
      >
        <header className="px-modal-head">
          {icon && <PixelIcon name={icon} size={2} />}
          <span className="px-modal-title">{title}</span>
          {onClose && <PixelButton icon="close_x" onClick={onClose} aria-label="Close" title="CLOSE" />}
        </header>
        <PixelScroll autoHide className="px-modal-body" viewportRef={body}>
          {children}
        </PixelScroll>
        {footer && <footer className="px-modal-foot">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}
