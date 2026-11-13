import { Linking, View } from 'react-native';
import { ExternalLink } from 'lucide-react-native';
import { Button, Copy } from '../components/ui';
import type { Exercise } from '../types';

export function Demonstration({ exercise }: { exercise: Exercise }) {
  const { videoId, creator } = exercise.demonstration;
  return <View style={{ gap: 8 }}>
    <Copy>{creator}</Copy>
    <Button icon={ExternalLink} onPress={() => Linking.openURL('https://www.youtube.com/watch?v=' + encodeURIComponent(videoId))}>Watch on YouTube</Button>
  </View>;
}
