import { View } from 'react-native';
import { ExternalLink } from 'lucide-react-native';
import { Copy } from '../components/ui';
import { color, font } from '../theme';
import type { Exercise } from '../types';

export function Demonstration({ exercise }: { exercise: Exercise }) {
  const { videoId, creator } = exercise.demonstration;
  const id = encodeURIComponent(videoId);
  return <View style={{ gap: 9 }}>
    <iframe
      title={exercise.name + ' demonstration'}
      src={`https://www.youtube-nocookie.com/embed/${id}?rel=0&playsinline=1`}
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
      allowFullScreen
      referrerPolicy="strict-origin-when-cross-origin"
      style={{ width: '100%', aspectRatio: '16 / 9', minHeight: 200, border: 0, borderRadius: 10, background: color.forest }}
    />
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
      <Copy size={12} tone={color.muted}>{creator}</Copy>
      <a href={`https://www.youtube.com/watch?v=${id}`} target="_blank" rel="noreferrer"
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: font.semibold, fontSize: 12, color: color.green }}>
        Watch on YouTube <ExternalLink size={13} color={color.green} />
      </a>
    </View>
  </View>;
}
