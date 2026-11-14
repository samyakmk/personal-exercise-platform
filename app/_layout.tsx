import { Slot } from 'expo-router';
import { useFonts } from 'expo-font';
import { StyleSheet, View } from 'react-native';
import { Shell } from '../src/components/Shell';
import { Loading } from '../src/components/ui';
import { TrainingNavigation } from '../src/navigation';
import { color } from '../src/theme';
import { WorkspaceProvider } from '../src/workspace';
import { VideoUploadProvider } from '../src/videoUpload';

export default function RootLayout() {
  return <WorkspaceProvider><WorkspaceLayout /></WorkspaceProvider>;
}

function WorkspaceLayout() {
  const [loaded, error] = useFonts({
    InstrumentSerif: require('../assets/fonts/InstrumentSerif-Regular.ttf'),
    InterRegular: require('../assets/fonts/Inter-Regular.ttf'),
    InterMedium: require('../assets/fonts/Inter-Medium.ttf'),
    InterSemiBold: require('../assets/fonts/Inter-SemiBold.ttf'),
    InterBold: require('../assets/fonts/Inter-Bold.ttf'),
    InterExtraBold: require('../assets/fonts/Inter-ExtraBold.ttf'),
  });
  if (!loaded && !error) return <View style={styles.loading}><Loading label="Loading Repform…" /></View>;

  return <TrainingNavigation><VideoUploadProvider><Shell><Slot /></Shell></VideoUploadProvider></TrainingNavigation>;
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: color.canvas },
});
