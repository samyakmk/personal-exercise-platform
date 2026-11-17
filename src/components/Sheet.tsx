import type { ReactNode } from 'react';
import { View, useWindowDimensions } from 'react-native';
import { X } from 'lucide-react-native';
import { Dialog } from '../platform/Dialog';
import { color } from '../theme';
import { Copy, Display, IconButton } from './ui';

export function Sheet({ title, detail, children, onClose, closeAction, wide, footer }: {
  title: string; detail?: string; children: ReactNode; onClose: () => void; closeAction?: ReactNode; wide?: boolean; footer?: ReactNode;
}) {
  const compact = useWindowDimensions().width < 570;
  return <Dialog label={title} onClose={onClose} wide={wide} footer={footer}>
    <View style={{ gap: 20, padding: compact ? 15 : 26 }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 9, paddingBottom: 13, borderBottomWidth: 1, borderColor: color.line }}>
        <View style={{ gap: 4, flex: 1 }}>
          <Display accessibilityRole="header" aria-level={2} size={compact ? 34 : 42}>{title}</Display>
          {detail && <Copy size={13} tone={color.muted}>{detail}</Copy>}
        </View>
        {closeAction ?? <IconButton label="Close dialog" icon={X} onPress={onClose} />}
      </View>
      {children}
    </View>
  </Dialog>;
}
