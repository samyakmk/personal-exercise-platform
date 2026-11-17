import type { ReactNode } from 'react';
import { Modal, ScrollView, View } from 'react-native';
import { color, radius } from '../theme';

export function Dialog({ children, label, onClose, footer }: {
  children: ReactNode; label: string; onClose: () => void; wide?: boolean; footer?: ReactNode;
}) {
  return <Modal transparent animationType="fade" onRequestClose={onClose}>
    <View style={{ flex: 1, justifyContent: 'center', padding: 14, backgroundColor: '#101e1799' }}>
      <View accessibilityLabel={label} accessibilityViewIsModal
        style={{ maxHeight: '92%', borderRadius: radius.panel, backgroundColor: color.surface, overflow: 'hidden' }}>
        <ScrollView keyboardShouldPersistTaps="handled" style={{ flexShrink: 1 }}>{children}</ScrollView>
        {footer}
      </View>
    </View>
  </Modal>;
}
