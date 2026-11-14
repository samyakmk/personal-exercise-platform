import type { ReactNode } from 'react';
import { View, useWindowDimensions } from 'react-native';
import { X } from 'lucide-react-native';
import { Dialog } from '../platform/Dialog';
import { color } from '../theme';
import { Copy, Display, IconButton } from './ui';

export function Sheet({ title, detail, children, onClose, wide }: { title: string; detail?: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const compact = useWindowDimensions().width < 570;
  return <Dialog label={title} onClose={onClose} wide={wide}>
    <View style={{ gap: 20, padding: compact ? 15 : 26 }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 9 }}>
        <View style={{ gap: 4, flex: 1 }}>
          <Display accessibilityRole="header" aria-level={2} size={compact ? 34 : 42}>{title}</Display>
          {detail && <Copy size={13} tone={color.muted}>{detail}</Copy>}
        </View>
        <IconButton label="Close dialog" icon={X} onPress={onClose} />
      </View>
      {children}
    </View>
  </Dialog>;
}
