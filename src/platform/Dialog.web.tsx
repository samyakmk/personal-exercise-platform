import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { color } from '../theme';

export function Dialog({ children, label, onClose, wide }: { children: ReactNode; label: string; onClose: () => void; wide?: boolean }) {
  const element = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = element.current;
    const opener = document.activeElement;
    dialog?.showModal();
    return () => {
      if (dialog?.open) dialog.close();
      requestAnimationFrame(() => {
        if (document.querySelector('dialog[open]')) return;
        if (opener instanceof HTMLElement && opener !== document.body && opener.isConnected) {
          opener.focus();
        } else if (document.activeElement === document.body || document.activeElement === null) {
          document.getElementById('liftmorrow-main')?.focus({ preventScroll: true });
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
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
      className="liftmorrow-dialog"
      style={{
        padding: 0, width: `min(${wide ? 1050 : 600}px, calc(100% - 26px))`, maxHeight: 'calc(100dvh - 32px)', overflow: 'auto',
        border: `1px solid ${color.line}`, borderRadius: 18, background: color.surface, color: color.text,
      }}
    >
      {children}
    </dialog>
  );
}
