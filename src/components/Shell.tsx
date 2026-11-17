import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, usePathname, useRouter } from 'expo-router';
import { CalendarDays, ChartNoAxesColumnIncreasing, CircleUserRound, ClipboardList, Dumbbell, Ellipsis, House, LockKeyhole, MessageCircle, ScanLine } from 'lucide-react-native';
import { Platform, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useProfiles } from '../profiles';
import { useActiveSession } from '../activeSession';
import { SkipLink } from '../platform/SkipLink';
import { color, radius } from '../theme';
import { useVideoUpload } from '../videoUpload';
import { useWorkspace } from '../workspace';
import { Sheet } from './Sheet';
import { Button, Copy, Loading, Notice } from './ui';
import { Wordmark } from './Wordmark';

const primaryPages = [
  { path: '/', label: 'Overview', icon: House },
  { path: '/sessions', label: 'Sessions', icon: ClipboardList },
  { path: '/workouts', label: 'Workouts', icon: CalendarDays },
  { path: '/explore', label: 'Exercises', icon: Dumbbell },
] as const;

const morePages = [
  { path: '/chat', label: 'Chat', icon: MessageCircle },
  { path: '/form-review', label: 'Form Review', icon: ScanLine },
  { path: '/progress', label: 'Progress', icon: ChartNoAxesColumnIncreasing },
  { path: '/profile', label: 'Profile', icon: CircleUserRound },
] as const;

const pages = [...primaryPages, ...morePages];

export function Shell({ children }: { children: ReactNode }) {
  const { width } = useWindowDimensions();
  const small = width < 690;
  const compact = width < 980;
  const inset = width >= 1440 ? 44 : width >= 900 ? 32 : small ? 14 : 24;
  const pathname = usePathname();
  const fullHeight = pathname === '/chat';
  const router = useRouter();
  const pageName = pathname === '/photo-credits' ? 'Photo credits' : pages.find((page) => page.path === pathname)?.label ?? 'Overview';
  const profile = useProfiles().state?.active;
  const profileName = profile?.details.displayName?.trim() || profile?.username;
  const scroll = useRef<ScrollView>(null);
  const { data, error, reload, notice } = useWorkspace();
  const upload = useVideoUpload();
  const { pendingCount, syncError, storageError, syncPending } = useActiveSession();
  const shown = useRef(false);

  useEffect(() => {
    scroll.current?.scrollTo({ y: 0, animated: false });
    if (Platform.OS !== 'web') return;
    document.title = pageName + ' · Trainer Plus';
    if (shown.current && !document.querySelector('dialog[open]')) {
      document.getElementById('trainer-plus-main')?.focus({ preventScroll: true });
    }
    shown.current = true;
  }, [pathname, pageName]);

  const main = <View role="main" nativeID="trainer-plus-main" tabIndex={-1}
    style={[styles.main, { paddingHorizontal: inset, paddingTop: small ? 21 : 36 }, fullHeight && styles.chatMain]}>
    {notice !== '' && <View style={styles.status}><Notice>{notice}</Notice></View>}
    {storageError && <View style={styles.status}><Notice error>Device storage is unavailable. Keep this tab open until the session is synced.</Notice></View>}
    {pendingCount > 0 && <View style={styles.status}>
      <Notice error={Boolean(syncError)} action={syncError ? <Button compact onPress={syncPending}>Retry sync</Button> : undefined}>
        {`${pendingCount === 1 ? '1 session is' : `${pendingCount} sessions are`} saved on this device and waiting to sync.${syncError ? ` ${syncError}` : ''}`}
      </Notice>
    </View>}
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
    <View style={[styles.shell, small && styles.shellSmall]}>
      <SkipLink />
      {!small && <View role="navigation" accessibilityLabel="Primary" style={[styles.side, compact && styles.sideCompact]}>
        <Brand compact={compact} />
        <View style={styles.navList}>
          {pages.map((page) => <NavigationLink key={page.path} page={page} active={page.path === pathname} />)}
        </View>
        {profileName && <View style={styles.sideBottom}>
          <Link href="/profile" asChild>
            <Pressable accessibilityRole="link" accessibilityLabel={profileName} style={styles.profileLink}>
              <LockKeyhole aria-hidden size={14} color={color.onInk} />
              <Copy size={12} tone={color.onInk} numberOfLines={1} style={styles.profileName}>{profileName}</Copy>
            </Pressable>
          </Link>
        </View>}
      </View>}

      {small && <MobileNavigation pathname={pathname} />}
      <View style={styles.content}>
        {fullHeight ? main : <ScrollView ref={scroll} style={styles.scroll} contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled">{main}</ScrollView>}
      </View>
    </View>
  );
}

function NavigationLink({ page, active, mobile, light, onPress }: {
  page: (typeof pages)[number]; active: boolean; mobile?: boolean; light?: boolean; onPress?: () => void;
}) {
  const { path, label, icon: Icon } = page;
  const tone = light ? active ? color.forest : color.text : active ? color.accent : color.onInk;
  return <Link href={path} asChild>
    <Pressable accessibilityRole="link" accessibilityLabel={label} onPress={onPress}
      accessibilityState={Platform.OS === 'web' ? undefined : { selected: active }}
      aria-current={Platform.OS === 'web' && active ? 'page' : undefined}
      dataSet={light && Platform.OS === 'web' ? { secondaryNavigation: 'true' } : undefined}
      style={StyleSheet.flatten([styles.navItem, mobile && styles.tab,
        active && (light ? styles.moreSelected : styles.navActive)])}>
      {active && !mobile && !light && <View aria-hidden style={styles.navMarker} />}
      <Icon aria-hidden size={mobile ? 20 : 18} color={tone} strokeWidth={active ? 2.1 : 1.75} />
      <Copy size={mobile ? 10 : 13} weight={active ? 'semibold' : 'medium'} tone={tone}>{label}</Copy>
    </Pressable>
  </Link>;
}

function MobileNavigation({ pathname }: { pathname: string }) {
  const [open, setOpen] = useState(false);
  const active = morePages.some((page) => page.path === pathname);
  const tone = active ? color.accent : color.onInk;
  return <>
    <View role="navigation" accessibilityLabel="Primary" style={styles.tabs}>
      {primaryPages.map((page) => <NavigationLink key={page.path} page={page} active={page.path === pathname} mobile />)}
      <Pressable accessibilityRole="button" aria-expanded={open}
        onPress={() => setOpen(true)} style={({ hovered }) => [styles.navItem, styles.tab, (active || hovered) && styles.navActive]}>
        <Ellipsis aria-hidden size={20} color={tone} />
        <Copy size={10} weight={active ? 'semibold' : 'medium'} tone={tone}>More</Copy>
      </Pressable>
    </View>
    {open && <Sheet title="More" onClose={() => setOpen(false)}>
      <View style={styles.moreList}>
        {morePages.map((page) => <NavigationLink key={page.path} page={page} active={page.path === pathname}
          light onPress={() => setOpen(false)} />)}
      </View>
    </Sheet>}
  </>;
}

function Brand({ compact }: { compact: boolean }) {
  return <Link href="/" asChild>
    <Pressable accessibilityRole="link" accessibilityLabel="Trainer Plus. Home" style={styles.brand}>
      <Wordmark compact={compact} />
    </Pressable>
  </Link>;
}

const styles = StyleSheet.create({
  shell: { flex: 1, minHeight: 0, backgroundColor: color.canvas, flexDirection: 'row' },
  shellSmall: { flexDirection: 'column-reverse' },
  side: { width: 208, backgroundColor: color.ink, borderRightWidth: 1, borderColor: color.inkLine,
    paddingHorizontal: 13, paddingTop: 17, gap: 27, zIndex: 2 },
  sideCompact: { width: 158, paddingHorizontal: 9 },
  brand: { minHeight: 44, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4, borderRadius: radius.control },
  navList: { gap: 4, borderTopWidth: 1, borderColor: color.inkLine, paddingTop: 12 },
  navItem: { minHeight: 44, paddingHorizontal: 11, borderRadius: radius.control, flexDirection: 'row', alignItems: 'center', gap: 11 },
  navActive: { backgroundColor: color.inkHover },
  navMarker: { position: 'absolute', left: 0, top: 10, bottom: 10, width: 2, backgroundColor: color.accent },
  sideBottom: { marginTop: 'auto', marginBottom: 13, borderTopWidth: 1, borderColor: color.inkLine, paddingTop: 6 },
  profileLink: { minHeight: 36, borderRadius: radius.control, paddingHorizontal: 6, flexDirection: 'row', alignItems: 'center', gap: 8 },
  profileName: { flex: 1, minWidth: 0 },
  content: { flex: 1, minWidth: 0, minHeight: 0 },
  tabs: { flexDirection: 'row', backgroundColor: color.ink, borderTopWidth: 1, borderColor: color.inkLine, gap: 2, padding: 4 },
  tab: { minHeight: 50, flex: 1, flexDirection: 'column', justifyContent: 'center', paddingHorizontal: 0, gap: 2 },
  moreList: { gap: 4 },
  moreSelected: { backgroundColor: color.tint },
  scroll: { flex: 1 },
  scrollContent: { flexGrow: 1 },
  main: { width: '100%', maxWidth: 1380, alignSelf: 'center', paddingBottom: 44, minHeight: '100%' },
  chatMain: { flex: 1, minHeight: 0, paddingBottom: 0 },
  status: { marginBottom: 12 },
});
