import { Link } from 'expo-router';
import { View } from 'react-native';
import { Copy, PageTitle, Panel } from '../src/components/ui';
import { photoCredits } from '../src/photoCredits';
import { color } from '../src/theme';

export default function PhotoCredits() {
  return (
    <View style={{ gap: 12 }}>
      <PageTitle title="Photo credits" summary="Original sources for Repform’s dashboard photo and exercise thumbnails." />
      <Panel style={{ padding: 16, gap: 16 }}>
        {photoCredits.map(({ subject, author, source, rights }) => (
          <View key={subject} style={{ gap: 3 }}>
            <Link href={source} target="_blank" rel="noopener noreferrer">
              <Copy size={15} weight="bold" tone={color.green} style={{ textDecorationLine: 'underline' }}>{subject}</Copy>
            </Link>
            <Copy size={13}>{author}</Copy>
            <Copy size={12} tone={color.muted}>{rights}</Copy>
          </View>
        ))}
      </Panel>
      <Copy size={12} tone={color.muted}>Images were cropped and color-adjusted for Repform.</Copy>
      <Copy size={12} tone={color.muted}>The appearance of U.S. Department of War (DoW) visual information does not imply or constitute DoW endorsement.</Copy>
    </View>
  );
}
