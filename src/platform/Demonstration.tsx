import { Linking, View } from 'react-native';
import { ExternalLink } from 'lucide-react-native';
import { Button, Copy } from '../components/ui';
import type { Exercise } from '../types';

export function Demonstration({ exercise }: { exercise: Exercise }) {
  if (!exercise.demonstration) return null;
  const { videoId, creator, provider } = exercise.demonstration;
  const vimeo = provider === 'vimeo';
  const url = (vimeo ? 'https://vimeo.com/' : 'https://www.youtube.com/watch?v=') + encodeURIComponent(videoId);
  return <View style={{ gap: 8 }}>
    <Copy>{creator}</Copy>
    <Button icon={ExternalLink} onPress={() => Linking.openURL(url)}>{vimeo ? 'Watch on Vimeo' : 'Watch on YouTube'}</Button>
  </View>;
}
