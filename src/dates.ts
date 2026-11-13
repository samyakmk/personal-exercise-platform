export function dateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}-${String(date.getDate()).padStart(2, '0')}`;
}

export function asDate(day: string) {
  return new Date(day + 'T12:00:00');
}

export function addDays(day: string, amount: number) {
  const date = asDate(day);
  date.setDate(date.getDate() + amount);
  return dateKey(date);
}

export function formatDay(day: string, options: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' }) {
  const date = asDate(day);
  return Number.isNaN(date.valueOf()) ? day : new Intl.DateTimeFormat('en-US', options).format(date);
}

export function formatTime(time: string) {
  const [hours, minutes] = time.split(':').map(Number);
  return `${hours % 12 || 12}:${String(minutes).padStart(2, '0')} ${hours < 12 ? 'AM' : 'PM'}`;
}

export function workoutDay(day: string) {
  const today = dateKey();
  if (day === today) return 'Today';
  if (day === addDays(today, 1)) return 'Tomorrow';
  return formatDay(day);
}
