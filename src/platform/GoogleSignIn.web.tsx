import { useEffect, useRef, useState } from 'react';
import { profilesApi } from '../api';
import { Button, Copy, Notice } from '../components/ui';
import { color } from '../theme';

type GoogleIdentity = {
  initialize: (config: { client_id: string; nonce: string; callback: (response: { credential: string }) => void; use_fedcm_for_button: boolean }) => void;
  renderButton: (target: HTMLDivElement, config: { theme: 'outline'; size: 'large'; text: 'continue_with'; shape: 'pill'; width: number }) => void;
};

let scriptLoad: Promise<GoogleIdentity> | undefined;

function loadGoogleSignIn() {
  const identity = () => (window as Window & { google?: { accounts?: { id?: GoogleIdentity } } }).google?.accounts?.id;
  if (scriptLoad) return scriptLoad;
  scriptLoad = new Promise<GoogleIdentity>((resolve, reject) => {
    const loaded = identity();
    if (loaded) { resolve(loaded); return; }
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = () => {
      const google = identity();
      if (google) resolve(google);
      else reject(new Error('Google sign-in did not load.'));
    };
    script.onerror = () => {
      script.remove();
      reject(new Error('Google sign-in did not load.'));
    };
    document.head.appendChild(script);
  }).catch((error) => {
    scriptLoad = undefined;
    throw error;
  });
  return scriptLoad;
}

export type GoogleSignInProps = {
  clientId: string;
  onCredential: (credential: string, nonce: string) => Promise<void>;
};

export function GoogleSignIn({ clientId, onCredential }: GoogleSignInProps) {
  const target = useRef<HTMLDivElement>(null);
  const callback = useRef(onCredential);
  callback.current = onCredential;
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<'loading' | 'ready' | 'signing-in' | 'retry'>('loading');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    const element = target.current;
    setStatus('loading');
    setError('');
    void Promise.all([loadGoogleSignIn(), profilesApi.googleChallenge()]).then(([google, { nonce }]) => {
      if (!active || !element) return;
      let submitting = false;
      google.initialize({
        client_id: clientId,
        nonce,
        use_fedcm_for_button: true,
        callback: ({ credential }) => {
          if (!active || submitting) return;
          submitting = true;
          setStatus('signing-in');
          void callback.current(credential, nonce).catch((failure: Error) => {
            if (!active) return;
            element.replaceChildren();
            setError(failure.message);
            setStatus('retry');
          });
        },
      });
      google.renderButton(element, { theme: 'outline', size: 'large', text: 'continue_with', shape: 'pill', width: 232 });
      setStatus('ready');
    }).catch((failure: Error) => {
      if (!active) return;
      setError(failure.message);
      setStatus('retry');
    });
    return () => {
      active = false;
      element?.replaceChildren();
    };
  }, [attempt, clientId]);

  return <>
    <div ref={target} inert={status === 'signing-in'} aria-busy={status === 'signing-in'} />
    {status === 'loading' && <Copy tone={color.onInk}>Loading Google sign-in…</Copy>}
    {status === 'signing-in' && <Copy tone={color.onInk}>Signing in…</Copy>}
    {status === 'retry' && <Notice error action={<Button compact onPress={() => setAttempt((value) => value + 1)}>Retry</Button>}>
      {error}
    </Notice>}
  </>;
}
