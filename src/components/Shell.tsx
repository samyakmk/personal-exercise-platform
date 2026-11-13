import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { Link, usePathname } from 'expo-router';
import { ChevronRight, CalendarDays, Dumbbell, House, Plus, Video, Zap } from 'lucide-react-native';
import { Platform, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useTrainingNavigation } from '../navigation';
import { color } from '../theme';
import { useWorkspace } from '../workspace';
import { Button, Copy, Loading, Notice } from './ui';

const pages = [
  { path: '/', label: 'Overview', icon: House },
  { path: '/explore', label: 'Exercises', icon: Dumbbell },
  { path: '/workouts', label: 'Workouts', icon: CalendarDays },
  { path: '/form-review', label: 'Form Review', icon: Video },
] as const;

export function Shell({ children }: { children: ReactNode }) {
  const width = useWindowDimensions().width;
  const desktop = width >= 960;
  const pathname = usePathname();
  const training = useTrainingNavigation();
  const scroll = useRef<ScrollView>(null);
  useEffect(() => scroll.current?.scrollTo({ y: 0, animated: false }), [pathname]);
  const { data, error, reload, notice } = useWorkspace();

  const nav = pages.map(({ path, label, icon: Icon }) => {
    const active = path === pathname;
    return (
      <Link key={path} href={path} asChild>
        <Pressable
          accessibilityRole="link"
          accessibilityState={{ selected: active }}
          style={StyleSheet.flatten([styles.navItem, !desktop && styles.navSmall, active && { backgroundColor: '#e9f3d6' }])}
        >
          <Icon size={desktop ? 18 : 17} color={active ? '#314a25' : color.muted} strokeWidth={active ? 2.25 : 1.8} />
          <Copy size={desktop ? 13 : 11} weight={active ? 'bold' : 'medium'} tone={active ? '#263e20' : color.muted}>{label}</Copy>
        </Pressable>
      </Link>
    );
  });

  return (
    <View style={[styles.shell, desktop && { flexDirection: 'row' }]}>
      {desktop && <View role="navigation" accessibilityLabel="Primary" style={styles.side}>
        <Brand />
        <View style={styles.navList}>{nav}</View>
        <View style={styles.sideBottom}>
          <View style={styles.avatar}><Dumbbell size={15} color={color.green} /></View>
          <View style={{ flex: 1 }}>
            <Copy size={12} weight="bold">My workspace</Copy>
            <Copy size={11} tone={color.muted}>Demo data</Copy>
          </View>
        </View>
      </View>}
      <View style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
        <View style={[styles.top, { paddingHorizontal: desktop ? 32 : 16 }]}>
          {desktop ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Copy size={13} tone={color.muted}>Workspace</Copy>
            <ChevronRight size={12} color="#79857a" />
            <Copy size={13} weight="semibold">{pathname === '/photo-credits' ? 'Photo credits' : pages.find((page) => page.path === pathname)?.label ?? 'Overview'}</Copy>
          </View> : <Brand />}
          <Button icon={Plus} kind="dark" compact style={{ alignSelf: 'center' }} onPress={() => training.open({ type: 'schedule' })}>New workout</Button>
        </View>
        {!desktop && <View role="navigation" accessibilityLabel="Primary" style={styles.topNav}>{nav}</View>}
        <ScrollView ref={scroll} style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">
          <View role="main" style={[styles.main, { paddingHorizontal: desktop ? 32 : width < 480 ? 14 : 22 }]}>
            {notice !== '' && <View style={styles.status}><Notice>{notice}</Notice></View>}
            {data ? children : error
              ? <Notice error action={<Button compact onPress={reload}>Retry</Button>}>{error}</Notice>
              : <Loading label="Loading your workspace…" />}
          </View>
        </ScrollView>
      </View>
    </View>
  );
}

function Brand() {
  return <Link href="/" asChild>
    <Pressable accessibilityRole="link" accessibilityLabel="Repform home" style={styles.brand}>
      <View style={styles.brandMark}><Zap size={20} color={color.forest} fill={color.forest} strokeWidth={1.7} /></View>
      <Copy weight="extra" size={21} style={{ letterSpacing: -1.25 }}>repform<TextDot /></Copy>
    </Pressable>
  </Link>;
}

function TextDot() {
  return <Copy size={21} weight="extra" tone="#66872b">.</Copy>;
}

const styles = StyleSheet.create({
  shell: { flex: 1, minHeight: 0, backgroundColor: color.canvas },
  side: { width: 220, borderRightWidth: 1, borderColor: color.line, backgroundColor: '#fafbf7', paddingHorizontal: 16, paddingTop: 20, gap: 29 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 9, alignSelf: 'flex-start' },
  brandMark: { width: 34, height: 34, borderRadius: 9, backgroundColor: color.lime, alignItems: 'center', justifyContent: 'center' },
  navList: { gap: 5 },
  navItem: { minHeight: 44, paddingHorizontal: 11, borderRadius: 8, flexDirection: 'row', alignItems: 'center', gap: 11 },
  navSmall: { flex: 1, paddingHorizontal: 4, justifyContent: 'center', gap: 5 },
  topNav: { flexDirection: 'row', backgroundColor: '#fafbf7', borderBottomWidth: 1, borderColor: color.line, paddingHorizontal: 10, paddingBottom: 6, gap: 3 },
  top: { height: 67, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#fafbf7', borderBottomWidth: 1, borderColor: color.line },
  sideBottom: { marginTop: 'auto', marginBottom: 17, borderTopWidth: 1, borderColor: color.line, paddingTop: 14, flexDirection: 'row', alignItems: 'center', gap: 9 },
  avatar: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 9, backgroundColor: '#e8efdc' },
  main: { width: '100%', maxWidth: 1460, alignSelf: 'center', paddingTop: 25, paddingBottom: 40, ...(Platform.OS === 'web' ? { minHeight: '100%' } : {}) },
  status: { marginBottom: 12 },
});
