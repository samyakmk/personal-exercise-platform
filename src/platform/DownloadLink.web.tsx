import { useEffect, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import { Download } from 'lucide-react-native';
import { Copy } from '../components/ui';
import { color } from '../theme';
import type { DownloadLinkProps } from './DownloadLink';

function saveFile(data: Blob, filename: string) {
  const objectUrl = URL.createObjectURL(data);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.hidden = true;
  document.body.append(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 15_000);
  }
}

export function DownloadLink({ href, label, compact, accessibilityLabel, validated }: DownloadLinkProps) {
  const pending = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => () => {
    pending.current?.abort();
    pending.current = null;
  }, []);

  async function download(event: MouseEvent<HTMLAnchorElement>) {
    if (!validated || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (pending.current) return;
    const request = new AbortController();
    pending.current = request;
    setBusy(true);
    validated.onStart();
    const timer = setTimeout(() => request.abort(), 30_000);
    try {
      const response = await fetch(href, { credentials: 'include', signal: request.signal });
      if (!response.ok) {
        const failure = await response.json().catch(() => null);
        if (pending.current === request) validated.onError(
          typeof failure?.error === 'string' ? failure.error : 'The download failed. Try again.',
          response.status,
        );
        return;
      }
      if (response.headers.get('content-type')?.split(';', 1)[0] !== 'application/json') {
        if (pending.current === request) validated.onError('Liftmorrow received an unreadable backup. Try again.');
        return;
      }
      const data = await response.blob();
      if (pending.current === request) saveFile(data, validated.filename);
    } catch {
      if (pending.current === request) validated.onError(request.signal.aborted
        ? 'The download took too long. Try again.'
        : 'Could not download. Check your connection and try again.');
    } finally {
      clearTimeout(timer);
      if (pending.current === request) {
        pending.current = null;
        setBusy(false);
      }
    }
  }

  return <a href={href} download={validated?.filename ?? true} aria-label={accessibilityLabel ?? label} onClick={validated ? download : undefined}
    aria-busy={busy || undefined} style={{
    display: 'inline-flex', gap: 7, minHeight: compact ? 35 : 42, alignItems: 'center', alignSelf: 'flex-start',
    padding: compact ? '0 10px' : '0 13px', boxSizing: 'border-box', borderRadius: 9, border: '1px solid ' + color.control,
    background: color.surface, textDecoration: 'none', opacity: busy ? 0.7 : 1,
  }}>
    <Download color={color.plum} size={compact ? 15 : 17} aria-hidden />
    <Copy size={compact ? 12 : 13} weight="semibold">{busy ? 'Preparing download…' : label}</Copy>
  </a>;
}
