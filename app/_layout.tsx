import { Navigator } from 'expo-router';
import { useFonts } from 'expo-font';
import { StyleSheet, View } from 'react-native';
import { ActiveSessionProvider } from '../src/activeSession';
import { ChatProvider } from '../src/chat';
import { Shell } from '../src/components/Shell';
import { Loading } from '../src/components/ui';
import { TrainingNavigation } from '../src/navigation';
import { ProfilesProvider, useProfiles } from '../src/profiles';
import { ProfileGate } from '../src/screens/Profile';
import { color } from '../src/theme';
import { WorkspaceProvider } from '../src/workspace';
import { VideoUploadProvider } from '../src/videoUpload';

export default function RootLayout() {
  return <Navigator><ProfilesProvider><WorkspaceLayout /></ProfilesProvider></Navigator>;
}

function WorkspaceLayout() {
  const { state, reload } = useProfiles();
  const [loaded, error] = useFonts({
    InstrumentSerif: require('../assets/fonts/InstrumentSerif-Regular.ttf'),
    InterRegular: require('../assets/fonts/Inter-Regular.ttf'),
    InterMedium: require('../assets/fonts/Inter-Medium.ttf'),
    InterSemiBold: require('../assets/fonts/Inter-SemiBold.ttf'),
    InterBold: require('../assets/fonts/Inter-Bold.ttf'),
    InterExtraBold: require('../assets/fonts/Inter-ExtraBold.ttf'),
  });
  if (!loaded && !error) return <View style={styles.loading}><Loading label="Loading Liftmorrow…" /></View>;

  if (!state?.active) return <ProfileGate />;
  const key = state.active.workspaceKey;
  return <WorkspaceProvider key={key} workspaceKey={key} refreshProfile={reload}>
    <TrainingNavigation><ActiveSessionProvider><VideoUploadProvider><ChatProvider>
      <Shell><Navigator.Slot /></Shell>
    </ChatProvider></VideoUploadProvider></ActiveSessionProvider></TrainingNavigation>
  </WorkspaceProvider>;
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: color.canvas },
});
