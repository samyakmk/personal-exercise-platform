import { useState } from 'react';
import { View } from 'react-native';
import { Notice } from '../components/ui';
import { color } from '../theme';

export function VideoPlayer({ uri, label, onError }: { uri: string; label: string; onError?: () => void }) {
  const [failed, setFailed] = useState(false);
  return <View style={{ gap: 8 }}>
    <video
      aria-label={label}
      src={uri}
      controls
      playsInline
      preload="metadata"
      onError={() => { setFailed(true); onError?.(); }}
      style={{ width: '100%', maxHeight: 350, aspectRatio: '16/9', backgroundColor: color.forest, borderRadius: 10 }}
    />
    {failed && <Notice error>This video could not be played in your browser.</Notice>}
  </View>;
}
