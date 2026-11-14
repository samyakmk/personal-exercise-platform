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
  yield 'PRODID:-//Repform//Workouts//EN';
  for (const workout of workouts) {
    yield 'BEGIN:VEVENT';
    yield `UID:${workout.id}@repform.local`;
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

function* historyRows(workouts) {
  yield ['\uFEFFDate', 'Time', 'Workout', 'Exercise', 'Sets', 'Reps or seconds', 'Measurement',
    'Weight per dumbbell', 'Weight unit', 'Set number', 'Workout notes'];
  for (const { date, time, name, notes, exercises } of workouts) {
    for (const { exerciseId, sets, reps, load, setDetails } of exercises) {
      const exercise = exercisesById.get(exerciseId);
      const prefix = [date, time, name, exercise?.name ?? exerciseId];
      if (setDetails) {
        for (const [index, set] of setDetails.entries()) {
          yield [...prefix, 1, set.reps, exercise?.unit, set.load?.value, set.load?.unit, index + 1, notes];
        }
      } else {
        yield [...prefix, sets, reps, exercise?.unit, load?.value, load?.unit, '', notes];
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

export function workoutHistoryCsv(workouts) {
  return streamLines(historyRows(workouts), (row) => row.map(csvCell).join(','));
}
