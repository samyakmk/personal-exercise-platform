export const earliestWorkoutDate = '1900-01-01';
export const latestWorkoutDate = '2199-12-31';

export function dateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}-${String(date.getDate()).padStart(2, '0')}`;
}

export function asDate(day: string) {
  return new Date(day + 'T12:00:00');
}

export function timeKey(date: Date) {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

export function workoutTime(date = new Date()) {
  return { date: dateKey(date), time: timeKey(date) };
}

export function isWorkoutDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < earliestWorkoutDate || value > latestWorkoutDate) return false;
  const date = asDate(value);
  return !Number.isNaN(date.valueOf()) && dateKey(date) === value;
}

export function compareWorkoutTime(a: { date: string; time: string }, b: { date: string; time: string }) {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  return a.time === b.time ? 0 : a.time < b.time ? -1 : 1;
}

export function addDays(day: string, amount: number) {
  const date = asDate(day);
  date.setDate(date.getDate() + amount);
  return dateKey(date);
}

export function weekStart(day: string) {
  return addDays(day, -((asDate(day).getDay() + 6) % 7));
}

export function formatDay(day: string, options: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' }) {
  const date = asDate(day);
  return Number.isNaN(date.valueOf()) ? day : new Intl.DateTimeFormat('en-US', options).format(date);
}

export function formatTime(time: string) {
  const [hours, minutes] = time.split(':').map(Number);
  return `${hours % 12 || 12}:${String(minutes).padStart(2, '0')} ${hours < 12 ? 'AM' : 'PM'}`;
}

export function workoutDay(day: string, today = dateKey()) {
  if (day === today) return 'Today';
  if (day === addDays(today, 1)) return 'Tomorrow';
  return formatDay(day);
}
