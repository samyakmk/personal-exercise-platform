import { View } from 'react-native';
import { ExternalLink } from 'lucide-react-native';
import { Copy } from '../components/ui';
import { color, font } from '../theme';
import type { Exercise } from '../types';

export function Demonstration({ exercise }: { exercise: Exercise }) {
  if (!exercise.demonstration) return null;
  const { videoId, creator, provider, source } = exercise.demonstration;
  const id = encodeURIComponent(videoId);
  const vimeo = provider === 'vimeo';
  const embed = vimeo ? `https://player.vimeo.com/video/${id}?dnt=1`
    : `https://www.youtube-nocookie.com/embed/${id}?rel=0&playsinline=1`;
  const watch = vimeo ? `https://vimeo.com/${id}` : `https://www.youtube.com/watch?v=${id}`;
  const linkStyle = { display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: font.semibold, fontSize: 12, color: color.plum } as const;
  return <View style={{ gap: 9 }}>
    <iframe
      title={exercise.name + ' demonstration'}
      src={embed}
      allow="autoplay; encrypted-media; picture-in-picture"
      allowFullScreen
      referrerPolicy="strict-origin-when-cross-origin"
      style={{ width: '100%', aspectRatio: '16 / 9', minHeight: 200, border: 0, borderRadius: 10, background: color.ink }}
    />
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
      {source ? <a href={source} target="_blank" rel="noreferrer" style={linkStyle}>{creator}</a>
        : <Copy size={12} tone={color.muted}>{creator}</Copy>}
      <a href={watch} target="_blank" rel="noreferrer" style={linkStyle}>
        {vimeo ? 'Watch on Vimeo' : 'Watch on YouTube'} <ExternalLink size={13} color={color.plum} />
      </a>
    </View>
  </View>;
}
