import { setImmediate } from 'node:timers/promises';
import { exercisesById } from './catalog.mjs';

function calendarText(value) {
  return value.toWellFormed().replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/[;,]/g, '\\$&');
}

function foldCalendarLine(line) {
  const parts = [''];
  let bytes = 0;
  for (const character of line) {
    const width = Buffer.byteLength(character);
    if (bytes + width > 75) {
      parts.push(' ');
      bytes = 1;
    }
    parts[parts.length - 1] += character;
    bytes += width;
  }
  return parts.join('\r\n');
}

function* calendarLines(workouts, now) {
  const stamp = now.toISOString().slice(0, 19).replace(/[-:]/g, '') + 'Z';
  yield 'BEGIN:VCALENDAR';
  yield 'VERSION:2.0';
  yield 'PRODID:-//Liftmorrow//Workouts//EN';
  for (const workout of workouts) {
    yield 'BEGIN:VEVENT';
    yield `UID:${workout.id}@liftmorrow.local`;
    yield `DTSTAMP:${stamp}`;
    yield `DTSTART:${workout.date.replace(/-/g, '')}T${workout.time.replace(':', '')}00`;
    yield `SUMMARY:${calendarText(workout.name)}`;
    yield 'DESCRIPTION:' + calendarText(workout.exercises.map(({ exerciseId, sets, reps, load, setDetails }) => {
      const exercise = exercisesById.get(exerciseId);
      const unit = exercise?.unit === 'seconds' ? 'sec' : 'reps';
      if (setDetails) {
        const lines = setDetails.map((set, index) => (
          `Set ${index + 1}: ${set.reps} ${unit}${set.load ? ` · ${set.load.value} ${set.load.unit}` : ''}`
        ));
        return [exercise?.name ?? exerciseId, ...lines].join('\n');
      }
      return `${exercise?.name ?? exerciseId} · ${sets} × ${reps} ${unit}${load ? ` · ${load.value} ${load.unit}` : ''}`;
    }).concat(workout.notes ? ['', workout.notes] : []).join('\n'));
    yield 'END:VEVENT';
  }
  yield 'END:VCALENDAR';
}

export function workoutCalendar(workouts, now = new Date()) {
  return streamLines(calendarLines(workouts, now), foldCalendarLine);
}

function csvCell(value) {
  const text = String(value ?? '');
  const safe = typeof value === 'string' && /^[\s\uFEFF]*[=+\-@＝＋－＠]/u.test(text) ? "'" + text : text;
  return /[",\r\n]/.test(safe) ? '"' + safe.replace(/"/g, '""') + '"' : safe;
}

function* historyRows(workouts, includeFeedback) {
  const feedback = (source, effort, exerciseNotes) => includeFeedback ? [source, effort, exerciseNotes] : [];
  yield ['\uFEFFDate', 'Time', 'Workout', 'Exercise', 'Sets', 'Reps or seconds', 'Measurement',
    'Weight per dumbbell', 'Weight unit', 'Set number', 'Workout notes',
    ...feedback('Session source', 'Perceived effort (1–10)', 'Exercise notes')];
  for (const { date, time, name, notes, exercises, effort, source } of workouts) {
    if (!exercises.length) yield [date, time, name, '', '', '', '', '', '', '', notes, ...feedback(source, effort)];
    for (const { exerciseId, sets, reps, load, setDetails, notes: exerciseNotes } of exercises) {
      const exercise = exercisesById.get(exerciseId);
      const prefix = [date, time, name, exercise?.name ?? exerciseId];
      const extra = feedback(source, effort, exerciseNotes);
      if (setDetails?.length) {
        for (const [index, set] of setDetails.entries()) {
          yield [...prefix, 1, set.reps, exercise?.unit, set.load?.value, set.load?.unit, index + 1, notes, ...extra];
        }
      } else {
        yield [...prefix, sets, reps, exercise?.unit, load?.value, load?.unit, '', notes, ...extra];
      }
    }
  }
}

async function* streamLines(lines, format) {
  let chunk = '';
  for (const line of lines) {
    chunk += format(line) + '\r\n';
    if (chunk.length >= 32 * 1024) {
      yield chunk;
      chunk = '';
      await setImmediate();
    }
  }
  if (chunk) yield chunk;
}

export function workoutHistoryCsv(workouts, includeFeedback = false) {
  return streamLines(historyRows(workouts, includeFeedback), (row) => row.map(csvCell).join(','));
}
