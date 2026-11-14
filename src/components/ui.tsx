import type { ReactNode } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { PressableProps, StyleProp, TextInputProps, TextProps, TextStyle, ViewStyle } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import { color, font } from '../theme';

type CopyProps = TextProps & { size?: number; tone?: string; weight?: keyof typeof font };
export function Copy({ size = 14, tone = color.text, weight = 'regular', style, ...props }: CopyProps) {
  return <Text {...props} style={[{ fontFamily: font[weight], fontSize: size, lineHeight: Math.round(size * 1.45), color: tone }, style]} />;
}

export function VisuallyHidden({ children }: { children: string }) {
  return <Copy style={styles.visuallyHidden}>{children}</Copy>;
}

export function Display({ children, size = 47, style, tone = color.text, ...props }: CopyProps) {
  return <Copy {...props} size={size} tone={tone} weight="display" style={[{ lineHeight: Math.round(size * 1.02), letterSpacing: -0.45 }, style]}>{children}</Copy>;
}

type ButtonProps = Omit<PressableProps, 'style' | 'children'> & {
  children: string;
  icon?: LucideIcon;
  end?: LucideIcon;
  kind?: 'primary' | 'outline' | 'quiet' | 'dark' | 'danger';
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
};
export function Button({ children, icon: Icon, end: End, kind = 'outline', compact, style, disabled, ...props }: ButtonProps) {
  const palette = {
    primary: { base: color.accent, hover: color.accentHover, ink: color.ink, line: color.accent },
    outline: { base: color.surface, hover: color.soft, ink: color.text, line: color.control },
    quiet: { base: 'transparent', hover: color.soft, ink: color.plum, line: 'transparent' },
    dark: { base: color.ink, hover: color.inkHover, ink: color.surface, line: color.ink },
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
      {Icon && <Icon size={compact ? 15 : 17} color={palette.ink} />}
      <Copy size={compact ? 12 : 13} weight="semibold" tone={palette.ink}>{children}</Copy>
      {End && <End size={16} color={palette.ink} />}
    </Pressable>
  );
}

export function IconButton({ label, icon: Icon, onPress, size = 36, disabled = false }: {
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
      <Icon size={17} color={color.plum} />
    </Pressable>
  );
}

export function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={Platform.OS === 'web' ? undefined : { selected }}
      aria-pressed={Platform.OS === 'web' ? selected : undefined}
      onPress={onPress}
      style={({ hovered }) => [
        styles.chip,
        { backgroundColor: selected ? color.tint : hovered ? color.soft : color.surface, borderColor: selected ? color.plum : color.control },
      ]}
    >
      <Copy size={12} weight={selected ? 'bold' : 'medium'} tone={selected ? color.plum : color.text}>{label}</Copy>
    </Pressable>
  );
}

export function ViewTab({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" aria-pressed={selected} onPress={onPress}
    style={({ hovered }) => [styles.viewTab, { borderBottomColor: selected ? color.plum : 'transparent' },
      hovered && { backgroundColor: color.soft }]}>
    <Copy size={13} weight={selected ? 'bold' : 'medium'} tone={selected ? color.plum : color.muted}>{label}</Copy>
  </Pressable>;
}

export function Tag({ children, style, tone = color.plum }: { children: string; style?: StyleProp<ViewStyle>; tone?: string }) {
  return <View style={[styles.tag, style]}><Copy size={10} weight="bold" tone={tone} style={{ letterSpacing: 0.5 }}>{children}</Copy></View>;
}

export function Panel({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.panel, style]}>{children}</View>;
}

export function PageTitle({ title, summary, action }: { title: string; summary: string; action?: ReactNode }) {
  return (
    <View style={styles.pageTitle}>
      <View style={{ flexShrink: 1, gap: 8 }}>
        <Display accessibilityRole="header" aria-level={1} size={58}>{title}</Display>
        <Copy tone={color.muted} style={{ maxWidth: 630 }}>{summary}</Copy>
      </View>
      {action}
    </View>
  );
}

export function SectionTitle({ title, summary, action, level = 2 }: {
  title: string; summary?: string; action?: ReactNode; level?: 2 | 3;
}) {
  return (
    <View style={styles.sectionTitle}>
      <View style={{ flexShrink: 1, gap: 4 }}>
        <Copy accessibilityRole="header" aria-level={level} size={18} weight="bold" style={{ letterSpacing: -0.4 }}>{title}</Copy>
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
        <Copy size={13} tone={error ? color.danger : color.plum}>{children}</Copy>
      </View>
      {action}
    </View>
  );
}

export function Empty({ title, message, icon: Icon, action }: { title: string; message: string; icon: LucideIcon; action?: ReactNode }) {
  return (
    <Panel style={styles.empty}>
      <View style={styles.tile}><Icon size={24} color={color.plum} /></View>
      <Copy accessibilityRole="header" aria-level={2} weight="bold" size={17} style={{ textAlign: 'center' }}>{title}</Copy>
      <Copy tone={color.muted} style={{ textAlign: 'center' }}>{message}</Copy>
      {action}
    </Panel>
  );
}

export function Loading({ label }: { label: string }) {
  return <View role="status" accessibilityLiveRegion="polite" style={styles.loading}>
    <ActivityIndicator color={color.plum} /><Copy tone={color.muted}>{label}</Copy>
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
  panel: { backgroundColor: color.surface, borderColor: color.line, borderWidth: 1, borderRadius: 12 },
  button: { borderWidth: 1, borderRadius: 9, minHeight: 42, paddingHorizontal: 13, gap: 7, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-start' },
  compact: { minHeight: 35, paddingHorizontal: 10 },
  iconButton: { borderRadius: 8, borderColor: color.control, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  chip: { minHeight: 34, justifyContent: 'center', borderWidth: 1, borderRadius: 7, paddingHorizontal: 10 },
  viewTab: { paddingHorizontal: 10, paddingVertical: 10, borderBottomWidth: 2, justifyContent: 'center', minHeight: 42 },
  tag: { alignSelf: 'flex-start', backgroundColor: color.soft, borderRadius: 5, paddingHorizontal: 7, paddingVertical: 3 },
  pageTitle: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 14, marginBottom: 11 },
  sectionTitle: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  tile: { width: 48, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: color.tint },
  empty: { alignItems: 'center', gap: 10, paddingHorizontal: 20, paddingVertical: 33 },
  loading: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 20 },
  notice: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10, padding: 12, borderRadius: 8 },
  input: { minHeight: 43, borderRadius: 8, borderColor: color.control, borderWidth: 1, paddingHorizontal: 12, fontFamily: font.regular, fontSize: 14, color: color.text, backgroundColor: color.surface },
  visuallyHidden: { position: 'absolute', width: 1, height: 1, overflow: 'hidden' },
});
