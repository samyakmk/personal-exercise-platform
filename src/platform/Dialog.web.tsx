import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { color } from '../theme';

export function Dialog({ children, label, onClose }: { children: ReactNode; label: string; onClose: () => void }) {
  const element = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = element.current;
    const opener = document.activeElement;
    dialog?.showModal();
    return () => {
      if (dialog?.open) dialog.close();
      requestAnimationFrame(() => {
        if (!document.querySelector('dialog[open]') && opener instanceof HTMLElement && opener.isConnected) opener.focus();
      });
    };
  }, []);

  return (
    <dialog
      ref={element}
      aria-label={label}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
      className="repform-dialog"
      style={{
        padding: 0, width: 'min(600px, calc(100% - 26px))', maxHeight: 'calc(100dvh - 32px)', overflow: 'auto',
        border: `1px solid ${color.line}`, borderRadius: 18, background: color.white, color: color.text,
      }}
    >
      {children}
    </dialog>
  );
}
