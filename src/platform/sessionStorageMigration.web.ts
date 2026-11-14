// Move drafts and live sessions forward lazily in the tab that owns them.
export function readSessionValue(key: string, suffix: string) {
  const saved = sessionStorage.getItem(key);
  if (saved !== null) return saved;
  const previousKey = 'repform-' + suffix;
  const previous = sessionStorage.getItem(previousKey);
  if (previous !== null) {
    try {
      sessionStorage.setItem(key, previous);
      sessionStorage.removeItem(previousKey);
    } catch {
      // Still return the saved data if this tab is at its storage limit.
    }
  }
  return previous;
}

export function removeSessionValue(key: string, suffix: string) {
  sessionStorage.removeItem('repform-' + suffix);
  sessionStorage.removeItem(key);
}
