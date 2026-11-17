const currentPrefix = 'trainer-plus-';
const previousPrefixes = ['liftmorrow-', 'repform-'];

// Move drafts and live sessions forward lazily in the tab that owns them.
export function readSessionValue(suffix: string) {
  const key = currentPrefix + suffix;
  const saved = sessionStorage.getItem(key);
  if (saved !== null) return saved;
  for (const prefix of previousPrefixes) {
    const previousKey = prefix + suffix;
    const previous = sessionStorage.getItem(previousKey);
    if (previous !== null) {
      try {
        sessionStorage.setItem(key, previous);
        sessionStorage.removeItem(previousKey);
      } catch {
        // Still return the saved data if this tab is at its storage limit.
      }
      return previous;
    }
  }
  return null;
}

export function writeSessionValue(suffix: string, value: string) {
  sessionStorage.setItem(currentPrefix + suffix, value);
}

export function removeSessionValue(suffix: string) {
  for (const prefix of previousPrefixes) sessionStorage.removeItem(prefix + suffix);
  sessionStorage.removeItem(currentPrefix + suffix);
}
