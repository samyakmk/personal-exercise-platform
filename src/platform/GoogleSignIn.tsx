import { Notice } from '../components/ui';

export function GoogleSignIn(_props: { clientId: string; onCredential: (credential: string, nonce: string) => Promise<void> }) {
  return <Notice>Open the Trainer Plus website to sign in with Google.</Notice>;
}
