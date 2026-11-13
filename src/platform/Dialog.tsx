import type { ReactNode } from 'react';
import { Modal, ScrollView, View } from 'react-native';
import { color } from '../theme';

export function Dialog({ children, label, onClose }: { children: ReactNode; label: string; onClose: () => void }) {
  return <Modal transparent animationType="fade" onRequestClose={onClose}>
    <View style={{ flex: 1, justifyContent: 'center', padding: 14, backgroundColor: '#101e1799' }}>
      <ScrollView accessibilityLabel={label} accessibilityViewIsModal style={{ maxHeight: '92%', borderRadius: 18, backgroundColor: color.white }} keyboardShouldPersistTaps="handled">
        {children}
      </ScrollView>
    </View>
  </Modal>;
}
