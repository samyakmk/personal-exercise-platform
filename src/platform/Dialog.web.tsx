import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { color, radius } from '../theme';

export function Dialog({ children, label, onClose, wide, footer }: {
  children: ReactNode; label: string; onClose: () => void; wide?: boolean; footer?: ReactNode;
}) {
  const element = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = element.current;
    let opener: Element | null = null;
    let openedPath = '';
    let disposed = false;
    function show() {
      if (!dialog || disposed) return;
      opener = document.activeElement;
      openedPath = window.location.pathname;
      dialog.showModal();
    }

    // Child effects run first when a parent and its nested dialog mount together.
    if (dialog?.parentElement?.closest('dialog:not([open])')) queueMicrotask(show);
    else show();
    return () => {
      disposed = true;
      if (dialog?.open) dialog.close();
      requestAnimationFrame(() => {
        if (document.querySelector('dialog[open]')) return;
        if (openedPath === window.location.pathname && opener instanceof HTMLElement && opener !== document.body && opener.isConnected) {
          opener.focus();
        } else if (document.activeElement === document.body || document.activeElement === null) {
          document.getElementById('trainer-plus-main')?.focus({ preventScroll: true });
        }
      });
    };
  }, []);

  useEffect(() => {
    const dialog = element.current;
    if (dialog?.open && !dialog.contains(document.activeElement)) {
      dialog.querySelector<HTMLElement>('button:not(:disabled)')?.focus();
    }
  }, [label]);

  return (
    <dialog
      ref={element}
      aria-label={label}
      onCancel={(event) => {
        if (event.target !== event.currentTarget) return;
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
      className="trainer-plus-dialog"
      style={{
        padding: 0, width: `min(${wide ? 1050 : 600}px, calc(100% - 26px))`, maxHeight: 'calc(100dvh - 32px)', overflow: footer ? 'hidden' : 'auto',
        border: `1px solid ${color.line}`, borderRadius: radius.panel, background: color.surface, color: color.text,
      }}
    >
      {footer ? <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100dvh - 34px)' }}>
        <div style={{ overflow: 'auto', minHeight: 0, flex: '1 1 auto' }}>{children}</div>
        {footer}
      </div> : children}
    </dialog>
  );
}
