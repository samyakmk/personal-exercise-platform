import type { ReactNode } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import type { PressableProps, StyleProp, TextInputProps, TextProps, TextStyle, ViewStyle } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import { color, font, radius } from '../theme';

type CopyProps = TextProps & { size?: number; tone?: string; weight?: keyof typeof font };
export function Copy({ size = 14, tone = color.text, weight = 'regular', style, ...props }: CopyProps) {
  return <Text {...props} style={[{ fontFamily: font[weight], fontSize: size, lineHeight: Math.round(size * 1.45), color: tone }, style]} />;
}

export function VisuallyHidden({ children }: { children: string }) {
  return <Copy style={styles.visuallyHidden}>{children}</Copy>;
}

export function Display({ children, size = 47, style, tone = color.text, ...props }: CopyProps) {
  return <Copy {...props} size={size} tone={tone} weight="display" style={[{ lineHeight: Math.round(size * 1.1), letterSpacing: -size * 0.038 }, style]}>{children}</Copy>;
}

export function EditorialTitle({ title, emphasisTone = color.forest, ...props }: CopyProps & { title: string; emphasisTone?: string }) {
  const split = title.lastIndexOf(' ');
  return <Display {...props}>{split < 0 ? title : <>
    {title.slice(0, split + 1)}<Text style={{ color: emphasisTone, fontStyle: 'italic' }}>{title.slice(split + 1)}</Text>
  </>}</Display>;
}

export function Label({ size = 11, tone = color.forest, style, ...props }: CopyProps) {
  return <Copy {...props} weight="mono" size={size} tone={tone} style={[styles.label, style]} />;
}

type ButtonProps = Omit<PressableProps, 'style' | 'children'> & {
  children: string;
  icon?: LucideIcon;
  end?: LucideIcon;
  kind?: 'primary' | 'outline' | 'quiet' | 'dark' | 'inverse' | 'danger';
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
};
export function Button({ children, icon: Icon, end: End, kind = 'outline', compact, style, disabled, ...props }: ButtonProps) {
  const palette = {
    primary: { base: color.accent, hover: color.accentHover, ink: color.ink, line: color.accent },
    outline: { base: color.surface, hover: color.soft, ink: color.text, line: color.control },
    quiet: { base: 'transparent', hover: color.soft, ink: color.forest, line: 'transparent' },
    dark: { base: color.ink, hover: color.inkHover, ink: color.surface, line: color.ink },
    inverse: { base: 'transparent', hover: color.inkHover, ink: color.surface, line: color.control },
    danger: { base: color.danger, hover: color.dangerHover, ink: color.surface, line: color.danger },
  }[kind];
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      {...props}
      style={({ hovered, pressed }) => [
        styles.button,
        { backgroundColor: hovered || pressed ? palette.hover : palette.base, borderColor: palette.line, opacity: disabled ? 0.55 : 1 },
        compact && styles.compact,
        style,
      ]}
    >
      {Icon && <Icon aria-hidden size={compact ? 15 : 17} color={palette.ink} />}
      <Copy size={compact ? 13 : 14} weight="semibold" tone={palette.ink} style={{ flexShrink: 1 }}>{children}</Copy>
      {End && <End aria-hidden size={16} color={palette.ink} />}
    </Pressable>
  );
}

export function IconButton({ label, icon: Icon, onPress, size = 40, disabled = false }: {
  label: string; icon: LucideIcon; onPress: () => void; size?: number; disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ hovered }) => [
        styles.iconButton, { width: size, height: size, opacity: disabled ? 0.45 : 1, backgroundColor: hovered ? color.soft : color.surface },
      ]}
    >
      <Icon size={17} color={color.forest} />
    </Pressable>
  );
}

export function Chip({ label, selected, onPress, disabled }: { label: string; selected: boolean; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      accessibilityState={Platform.OS === 'web' ? undefined : { selected }}
      aria-pressed={Platform.OS === 'web' ? selected : undefined}
      onPress={onPress}
      style={({ hovered }) => [
        styles.chip,
        { backgroundColor: selected ? color.tint : hovered ? color.soft : color.surface,
          borderColor: selected ? color.forest : color.control, opacity: disabled ? 0.6 : 1 },
      ]}
    >
      <Copy size={12} weight={selected ? 'bold' : 'medium'} tone={selected ? color.forest : color.text}>{label}</Copy>
    </Pressable>
  );
}

export function ViewTab({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" aria-pressed={selected} onPress={onPress}
    style={({ hovered }) => [styles.viewTab, { borderBottomColor: selected ? color.forest : 'transparent' },
      hovered && { backgroundColor: color.soft }]}>
    <Copy size={13} weight={selected ? 'bold' : 'medium'} tone={selected ? color.forest : color.muted}>{label}</Copy>
  </Pressable>;
}

export function Tag({ children, style, tone = color.forest }: { children: string; style?: StyleProp<ViewStyle>; tone?: string }) {
  return <View style={[styles.tag, style]}><Label size={10} tone={tone}>{children}</Label></View>;
}

export function Panel({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.panel, style]}>{children}</View>;
}

export function PageTitle({ title, summary, action }: { title: string; summary?: string; action?: ReactNode }) {
  const { width } = useWindowDimensions();
  return (
    <View style={styles.pageTitle}>
      <View style={{ flexShrink: 1, gap: 8 }}>
        <EditorialTitle accessibilityRole="header" aria-level={1} size={width < 420 ? 38 : width < 650 ? 46 : 60} title={title} />
        {summary && <Copy tone={color.muted} style={{ maxWidth: 630 }}>{summary}</Copy>}
      </View>
      {action && <View>{action}</View>}
    </View>
  );
}

export function SectionTitle({ title, summary, action, level = 2 }: {
  title: string; summary?: string; action?: ReactNode; level?: 2 | 3;
}) {
  return (
    <View style={styles.sectionTitle}>
      <View style={{ flexShrink: 1, gap: 5 }}>
        <Display accessibilityRole="header" aria-level={level} size={25}>{title}</Display>
        {summary && <Copy size={13} tone={color.muted}>{summary}</Copy>}
      </View>
      {action}
    </View>
  );
}

export function Notice({ children, error, action }: { children: string; error?: boolean; action?: ReactNode }) {
  return (
    <View style={[styles.notice, { backgroundColor: error ? color.dangerSoft : color.tint }]}>
      <View role={error ? 'alert' : 'status'} accessibilityLiveRegion={error ? 'assertive' : 'polite'} style={{ flexShrink: 1 }}>
        <Copy size={13} tone={error ? color.danger : color.forest}>{children}</Copy>
      </View>
      {action}
    </View>
  );
}

export function Empty({ title, message, icon: Icon, action }: { title: string; message?: string; icon: LucideIcon; action?: ReactNode }) {
  return (
    <Panel style={styles.empty}>
      <View style={styles.tile}><Icon size={24} color={color.forest} /></View>
      <Display accessibilityRole="header" aria-level={2} size={25} style={{ textAlign: 'center' }}>{title}</Display>
      {message && <Copy tone={color.muted} style={{ textAlign: 'center' }}>{message}</Copy>}
      {action && <View style={styles.emptyAction}>{action}</View>}
    </Panel>
  );
}

export function Loading({ label }: { label: string }) {
  return <View role="status" accessibilityLiveRegion="polite" style={styles.loading}>
    <ActivityIndicator color={color.forest} /><Copy tone={color.muted}>{label}</Copy>
  </View>;
}

export function Input({ label, visibleLabel = label, hideLabel = false, icon: Icon, style, ...props }: TextInputProps & {
  label: string; visibleLabel?: string; hideLabel?: boolean; icon?: LucideIcon; style?: StyleProp<TextStyle>;
}) {
  return (
    <View style={{ gap: 7, flex: 1, minWidth: 0 }}>
      {!hideLabel && <Copy size={12} weight="semibold">{visibleLabel}</Copy>}
      <View style={Icon && { justifyContent: 'center' }}>
        <TextInput
          {...props}
          accessibilityLabel={label}
          placeholderTextColor={color.faint}
          style={[styles.input, Icon && { paddingLeft: 37 }, style]}
        />
        {Icon && <View pointerEvents="none" aria-hidden style={{ position: 'absolute', left: 12 }}>
          <Icon size={16} color={color.muted} />
        </View>}
      </View>
    </View>
  );
}

export const styles = StyleSheet.create({
  panel: { backgroundColor: color.surface, borderColor: color.line, borderWidth: 1, borderRadius: radius.panel },
  button: { borderWidth: 1, borderRadius: radius.control, minHeight: 46, paddingHorizontal: 13, gap: 7, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-start', maxWidth: '100%' },
  compact: { minHeight: 39, paddingHorizontal: 10 },
  iconButton: { borderRadius: radius.control, borderColor: color.control, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  chip: { minHeight: 38, justifyContent: 'center', borderWidth: 1, borderRadius: radius.control, paddingHorizontal: 10 },
  viewTab: { paddingHorizontal: 10, paddingVertical: 10, borderBottomWidth: 2, justifyContent: 'center', minHeight: 42 },
  tag: { alignSelf: 'flex-start', backgroundColor: color.soft, borderRadius: 2, paddingHorizontal: 7, paddingVertical: 3 },
  label: { textTransform: 'uppercase', letterSpacing: 1.12 },
  pageTitle: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 16, paddingBottom: 15, borderBottomWidth: 1, borderColor: color.line },
  sectionTitle: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  tile: { width: 48, height: 48, borderRadius: radius.panel, alignItems: 'center', justifyContent: 'center', backgroundColor: color.tint },
  empty: { alignItems: 'center', gap: 8, paddingHorizontal: 20, paddingVertical: 24 },
  emptyAction: { maxWidth: '100%', marginTop: 2 },
  loading: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 20 },
  notice: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10, padding: 12, borderRadius: radius.control },
  input: { minHeight: 43, borderRadius: radius.control, borderColor: color.control, borderWidth: 1, paddingHorizontal: 12, fontFamily: font.regular, fontSize: 14, color: color.text, backgroundColor: color.surface },
  visuallyHidden: { position: 'absolute', width: 1, height: 1, overflow: 'hidden' },
});
