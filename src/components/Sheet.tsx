import type { ReactNode } from 'react';
import { View } from 'react-native';
import { X } from 'lucide-react-native';
import { Dialog } from '../platform/Dialog';
import { color } from '../theme';
import { Copy, IconButton } from './ui';

export function Sheet({ title, detail, children, onClose }: { title: string; detail?: string; children: ReactNode; onClose: () => void }) {
  return <Dialog label={title} onClose={onClose}>
    <View style={{ gap: 17, padding: 23 }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 9 }}>
        <View style={{ gap: 4, flex: 1 }}>
          <Copy accessibilityRole="header" size={23} weight="extra" style={{ letterSpacing: -0.7 }}>{title}</Copy>
          {detail && <Copy size={13} tone={color.muted}>{detail}</Copy>}
        </View>
        <IconButton label="Close dialog" icon={X} onPress={onClose} />
      </View>
      {children}
    </View>
  </Dialog>;
}
