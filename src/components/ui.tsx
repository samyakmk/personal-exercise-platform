import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { PressableProps, StyleProp, TextInputProps, TextProps, TextStyle, ViewStyle } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import { color, font } from '../theme';

type CopyProps = TextProps & { size?: number; tone?: string; weight?: keyof typeof font };
export function Copy({ size = 14, tone = color.text, weight = 'regular', style, ...props }: CopyProps) {
  return <Text {...props} style={[{ fontFamily: font[weight], fontSize: size, lineHeight: Math.round(size * 1.45), color: tone }, style]} />;
}

export function Display({ children, size = 47, style, tone = color.text, ...props }: CopyProps) {
  return <Copy {...props} size={size} tone={tone} weight="display" style={[{ lineHeight: Math.round(size * 0.97) }, style]}>{children}</Copy>;
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
    primary: { base: color.lime, hover: color.limeHover, ink: color.forest, line: color.lime },
    outline: { base: color.white, hover: color.soft, ink: color.text, line: color.line },
    quiet: { base: 'transparent', hover: color.soft, ink: color.green, line: 'transparent' },
    dark: { base: color.forest, hover: color.forestHover, ink: color.white, line: color.forest },
    danger: { base: color.danger, hover: '#852e30', ink: color.white, line: color.danger },
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

export function IconButton({ label, icon: Icon, onPress, size = 36 }: { label: string; icon: LucideIcon; onPress: () => void; size?: number }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ hovered }) => [
        styles.iconButton, { width: size, height: size, backgroundColor: hovered ? color.soft : color.white },
      ]}
    >
      <Icon size={17} color={color.green} />
    </Pressable>
  );
}

export function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ hovered }) => [
        styles.chip,
        { backgroundColor: selected ? color.forest : hovered ? color.soft : color.white, borderColor: selected ? color.forest : color.line },
      ]}
    >
      <Copy size={13} weight="semibold" tone={selected ? color.white : color.muted}>{label}</Copy>
    </Pressable>
  );
}

export function Tag({ children, style, tone = color.green }: { children: string; style?: StyleProp<ViewStyle>; tone?: string }) {
  return <View style={[styles.tag, style]}><Copy size={10} weight="bold" tone={tone} style={{ letterSpacing: 0.5 }}>{children}</Copy></View>;
}

export function Panel({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.panel, style]}>{children}</View>;
}

export function PageTitle({ title, summary, action }: { title: string; summary: string; action?: ReactNode }) {
  return (
    <View style={styles.pageTitle}>
      <View style={{ flexShrink: 1, gap: 8 }}>
        <Display accessibilityRole="header" size={52}>{title}</Display>
        <Copy tone={color.muted}>{summary}</Copy>
      </View>
      {action}
    </View>
  );
}

export function SectionTitle({ title, summary, action }: { title: string; summary?: string; action?: ReactNode }) {
  return (
    <View style={styles.sectionTitle}>
      <View style={{ flexShrink: 1, gap: 4 }}>
        <Copy accessibilityRole="header" size={21} weight="extra" style={{ letterSpacing: -0.6 }}>{title}</Copy>
        {summary && <Copy size={13} tone={color.muted}>{summary}</Copy>}
      </View>
      {action}
    </View>
  );
}

export function Notice({ children, error, action }: { children: string; error?: boolean; action?: ReactNode }) {
  return (
    <View accessibilityLiveRegion={error ? 'assertive' : 'polite'} style={[styles.notice, { backgroundColor: error ? color.dangerSoft : color.limeSoft }]}>
      <Copy size={13} tone={error ? color.danger : color.green} style={{ flexShrink: 1 }}>{children}</Copy>
      {action}
    </View>
  );
}

export function Empty({ title, message, icon: Icon, action }: { title: string; message: string; icon: LucideIcon; action?: ReactNode }) {
  return (
    <Panel style={styles.empty}>
      <View style={styles.tile}><Icon size={24} color={color.green} /></View>
      <Copy weight="bold" size={17} style={{ textAlign: 'center' }}>{title}</Copy>
      <Copy tone={color.muted} style={{ textAlign: 'center' }}>{message}</Copy>
      {action}
    </Panel>
  );
}

export function Loading({ label }: { label: string }) {
  return <View accessibilityLiveRegion="polite" style={styles.loading}><ActivityIndicator color={color.green} /><Copy tone={color.muted}>{label}</Copy></View>;
}

export function Input({ label, visibleLabel = label, style, ...props }: TextInputProps & { label: string; visibleLabel?: string; style?: StyleProp<TextStyle> }) {
  return (
    <View style={{ gap: 7, flex: 1 }}>
      <Copy size={12} weight="semibold">{visibleLabel}</Copy>
      <TextInput
        {...props}
        accessibilityLabel={label}
        placeholderTextColor={color.faint}
        style={[styles.input, style]}
      />
    </View>
  );
}

export const styles = StyleSheet.create({
  panel: { backgroundColor: color.white, borderColor: color.line, borderWidth: 1, borderRadius: 17 },
  button: { borderWidth: 1, borderRadius: 9, minHeight: 42, paddingHorizontal: 13, gap: 7, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-start' },
  compact: { minHeight: 35, paddingHorizontal: 10 },
  iconButton: { borderRadius: 9, borderColor: color.line, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  chip: { minHeight: 39, justifyContent: 'center', borderWidth: 1, borderRadius: 8, paddingHorizontal: 13 },
  tag: { alignSelf: 'flex-start', backgroundColor: color.soft, borderRadius: 5, paddingHorizontal: 7, paddingVertical: 3 },
  pageTitle: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16, marginBottom: 23 },
  sectionTitle: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  tile: { width: 48, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: color.limeSoft },
  empty: { alignItems: 'center', gap: 10, paddingHorizontal: 20, paddingVertical: 33 },
  loading: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 20 },
  notice: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10, padding: 12, borderRadius: 8 },
  input: { minHeight: 43, borderRadius: 8, borderColor: color.line, borderWidth: 1, paddingHorizontal: 12, fontFamily: font.regular, fontSize: 14, color: color.text, backgroundColor: color.white },
});
