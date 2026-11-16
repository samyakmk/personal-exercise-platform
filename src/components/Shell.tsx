import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { Link, usePathname, useRouter } from 'expo-router';
import { CalendarDays, ChartNoAxesColumnIncreasing, CircleUserRound, ClipboardList, Dumbbell, House, LockKeyhole, MessageCircle, Plus, ScanLine } from 'lucide-react-native';
import { Platform, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useTrainingNavigation } from '../navigation';
import { useProfiles } from '../profiles';
import { SkipLink } from '../platform/SkipLink';
import { color } from '../theme';
import { useVideoUpload } from '../videoUpload';
import { useWorkspace } from '../workspace';
import { Button, Copy, Loading, Notice } from './ui';

const pages = [
  { path: '/', label: 'Overview', icon: House },
  { path: '/sessions', label: 'Sessions', icon: ClipboardList },
  { path: '/workouts', label: 'Workouts', icon: CalendarDays },
  { path: '/explore', label: 'Exercises', icon: Dumbbell },
  { path: '/progress', label: 'Progress', icon: ChartNoAxesColumnIncreasing },
  { path: '/form-review', label: 'Form Review', icon: ScanLine },
  { path: '/chat', label: 'Chat', icon: MessageCircle },
  { path: '/profile', label: 'Profile', icon: CircleUserRound },
] as const;

export function Shell({ children }: { children: ReactNode }) {
  const { width } = useWindowDimensions();
  const compact = width < 820;
  const small = width < 560;
  const inset = width >= 1440 ? 44 : width >= 900 ? 32 : small ? 14 : 24;
  const pathname = usePathname();
  const fullHeight = pathname === '/chat';
  const router = useRouter();
  const pageName = pathname === '/photo-credits' ? 'Photo credits' : pages.find((page) => page.path === pathname)?.label ?? 'Overview';
  const training = useTrainingNavigation();
  const profile = useProfiles().state?.active;
  const scroll = useRef<ScrollView>(null);
  const { data, error, reload, notice } = useWorkspace();
  const upload = useVideoUpload();
  const shown = useRef(false);

  useEffect(() => {
    scroll.current?.scrollTo({ y: 0, animated: false });
    if (Platform.OS !== 'web') return;
    document.title = pageName + ' · Liftmorrow';
    if (shown.current && !document.querySelector('dialog[open]')) {
      document.getElementById('liftmorrow-main')?.focus({ preventScroll: true });
    }
    shown.current = true;
  }, [pathname, pageName]);

  const main = <View role="main" nativeID="liftmorrow-main" tabIndex={-1}
    style={[styles.main, { paddingHorizontal: inset, paddingTop: small ? 24 : 34 }, fullHeight && styles.chatMain]}>
    {notice !== '' && <View style={styles.status}><Notice>{notice}</Notice></View>}
    {data && error && <View style={styles.status}>
      <Notice error action={<Button compact onPress={reload}>Refresh workspace</Button>}>
        Showing your last loaded workspace. The latest changes could not be fetched.
      </Notice>
    </View>}
    {pathname !== '/form-review' && (upload.progress !== null || upload.uploadFailed) && <View style={styles.status}>
      <Notice error={upload.progress === null} action={<Button kind="quiet" compact onPress={() => router.navigate('/form-review')}>Open Form Review</Button>}>
        {upload.progress === null ? 'The video upload needs attention.' : 'Video upload in progress.'}
      </Notice>
    </View>}
    {data ? children : error
      ? <Notice error action={<Button compact onPress={reload}>Retry</Button>}>{error}</Notice>
      : <Loading label="Loading your workspace…" />}
  </View>;

  return (
    <View style={styles.shell}>
      <SkipLink />
      <View role="navigation" accessibilityLabel="Primary" style={[styles.side, compact && styles.sideCompact, small && styles.sideSmall]}>
        <Brand compact={compact} />
        <View style={styles.navList}>
          {pages.map(({ path, label, icon: Icon }) => {
            const active = path === pathname;
            const tone = active ? color.plum : color.muted;
            return <Link key={path} href={path} asChild>
              <Pressable accessibilityRole="link" accessibilityLabel={label}
                accessibilityState={Platform.OS === 'web' ? undefined : { selected: active }}
                aria-current={Platform.OS === 'web' && active ? 'page' : undefined}
                dataSet={compact && Platform.OS === 'web' ? { railLabel: label } : undefined}
                style={StyleSheet.flatten([styles.navItem, compact && styles.navCompact, active && styles.navActive])}>
                {active && <View aria-hidden style={styles.navMarker} />}
                <Icon aria-hidden size={19} color={tone} strokeWidth={active ? 2.1 : 1.75} />
                {!compact && <Copy size={13} weight={active ? 'semibold' : 'medium'} tone={tone}>{label}</Copy>}
              </Pressable>
            </Link>;
          })}
        </View>
        {!compact && <View style={styles.sideBottom}>
          <LockKeyhole aria-hidden size={14} color={color.muted} />
          <Copy size={12} tone={color.muted} numberOfLines={1} style={{ flex: 1 }}>{profile ? '@' + profile.username : 'Private workspace'}</Copy>
        </View>}
      </View>

      <View style={styles.content}>
        <View role="banner" style={styles.top}>
          <View style={[styles.topContent, { paddingHorizontal: inset }]}>
            <Copy size={13} weight="semibold" tone={color.muted}>{pageName}</Copy>
            {pathname !== '/workouts' && pathname !== '/sessions' && !fullHeight && <Button icon={Plus} kind="dark" compact style={{ alignSelf: 'center' }}
              onPress={() => training.open({ type: 'schedule' })}>New workout</Button>}
          </View>
        </View>
        {fullHeight ? main : <ScrollView ref={scroll} style={styles.scroll} contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled">{main}</ScrollView>}
      </View>
    </View>
  );
}

function Brand({ compact }: { compact: boolean }) {
  return <Link href="/" asChild>
    <Pressable accessibilityRole="link" accessibilityLabel="Liftmorrow. Home" style={StyleSheet.flatten([styles.brand, compact && { justifyContent: 'center' }])}>
      <View aria-hidden style={styles.brandMark}>
        <View style={[styles.markStroke, { height: 13 }]} />
        <View style={[styles.markStroke, { height: 20 }]} />
        <View style={[styles.markStroke, { height: 27 }]} />
      </View>
      {!compact && <Copy weight="extra" size={23} style={{ letterSpacing: -1.4 }}>liftmorrow<Copy weight="extra" tone={color.plum} size={23}>.</Copy></Copy>}
    </Pressable>
  </Link>;
}

const styles = StyleSheet.create({
  shell: { flex: 1, minHeight: 0, backgroundColor: color.canvas, flexDirection: 'row' },
  side: { width: 204, borderRightWidth: 1, borderColor: color.line, backgroundColor: color.rail, paddingHorizontal: 14, paddingTop: 20, gap: 34, zIndex: 2 },
  sideCompact: { width: 68, paddingHorizontal: 8 },
  sideSmall: { width: 52, paddingHorizontal: 5, paddingTop: 13, gap: 24 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 3 },
  brandMark: { width: 35, height: 35, borderRadius: 10, backgroundColor: color.ink, gap: 3, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'center' },
  markStroke: { width: 3, borderRadius: 3, backgroundColor: color.accent, transform: [{ rotate: '20deg' }] },
  navList: { gap: 5 },
  navItem: { minHeight: 43, paddingHorizontal: 11, borderRadius: 7, flexDirection: 'row', alignItems: 'center', gap: 10 },
  navCompact: { paddingHorizontal: 0, justifyContent: 'center' },
  navActive: { backgroundColor: color.tint },
  navMarker: { position: 'absolute', left: 0, top: 12, bottom: 12, width: 2, borderRadius: 2, backgroundColor: color.plum },
  sideBottom: { marginTop: 'auto', marginBottom: 20, borderTopWidth: 1, borderColor: color.line, paddingTop: 14,
    paddingHorizontal: 7, flexDirection: 'row', alignItems: 'center', gap: 8 },
  content: { flex: 1, minWidth: 0, minHeight: 0 },
  top: { height: 61, justifyContent: 'center', backgroundColor: color.canvas, borderBottomWidth: 1, borderColor: color.line },
  topContent: { width: '100%', maxWidth: 1380, alignSelf: 'center', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  scroll: { flex: 1 },
  scrollContent: { flexGrow: 1 },
  main: { width: '100%', maxWidth: 1380, alignSelf: 'center', paddingBottom: 44, minHeight: '100%' },
  chatMain: { flex: 1, minHeight: 0, paddingBottom: 0, paddingTop: 0 },
  status: { marginBottom: 12 },
});
