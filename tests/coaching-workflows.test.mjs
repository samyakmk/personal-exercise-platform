import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { workoutSafetyReply, pauseWorkoutReply, urgentWorkoutReply } from '../shared/session-safety.mjs';
import { createOpenAi } from '../server/ai.mjs';
import { analyzeClip } from '../server/analyze-clip.mjs';
import { exercisesById } from '../server/catalog.mjs';
import { normalizeClipTrainingContext } from '../server/clip-training-context.mjs';
import { lookupTrainingHistory } from '../server/training-chat.mjs';

test('training history lookups use completed logs, true dates and the session behind the result', () => {
  const exerciseId = 'dumbbell-curl';
  const workout = (id, date, weight, overrides = {}) => ({
    id, name: id, date, time: '09:00', status: 'completed',
    exercises: [{ exerciseId, setDetails: [{ reps: 10, load: weight }] }], ...overrides,
  });
  const workouts = [workout('Older', '2026-11-08', { value: 20, unit: 'kg' }),
    workout('Week one', '2026-11-09', { value: 30, unit: 'lb' }),
    workout('Sample', '2026-11-12', { value: 50, unit: 'kg' }, { example: true }),
    workout('Latest', '2026-11-15', { value: 25, unit: 'lb' }),
    workout('Future', '2026-11-16', { value: 100, unit: 'kg' }, { time: '18:00' })];
  const current = { date: '2026-11-16', time: '12:00' };
  const week = lookupTrainingHistory(workouts, current, { kind: 'week', week: 'last' });
  assert.match(week.reply, /2 completed sessions from 2026-11-09 through 2026-11-15/);
  assert.equal(week.week, '2026-11-09');
  assert.deepEqual(week.sources.map(({ id }) => id), ['Latest', 'Week one']);
  const latest = lookupTrainingHistory(workouts, current, { kind: 'weight', weight: 'latest', exerciseId });
  assert.match(latest.reply, /25 lb per dumbbell/);
  assert.equal(latest.sources[0].id, 'Latest');
  const heaviest = lookupTrainingHistory(workouts, current, { kind: 'weight', weight: 'heaviest', exerciseId });
  assert.match(heaviest.reply, /20 kg per dumbbell/);
  assert.equal(heaviest.sources[0].id, 'Older');
});

test('the safety shortcut distinguishes current reports from explicit negation and old, resolved history', () => {
  for (const message of ["I didn't feel any pain and my trainer wants me to progress slowly.",
    'Last year I injured my knee, but it’s healed. How many sessions did I log last week?',
    'I have a history of knee pain.', 'No chest pain or difficulty breathing.']) {
    assert.equal(workoutSafetyReply(message), null, message);
  }
  assert.equal(workoutSafetyReply('That injury was last year, but now my knee hurts.'), pauseWorkoutReply);
  assert.equal(workoutSafetyReply('I don’t have chest pain, but I can’t catch my breath.'), urgentWorkoutReply);
  assert.equal(workoutSafetyReply('I have chest pain from an injury last year.'), urgentWorkoutReply);
});

test('form reviews distinguish observed strengths from unsupported cues and record deployed model configuration', async () => {
  const exercise = exercisesById.get('dumbbell-bench-press');
  const frames = [0, 1, 2, 3].map((timestamp) => ({ timestamp, image: Buffer.from('synthetic') }));
  const analyses = async (comparisonFrame) => {
    const responder = createOpenAi({ key: 'synthetic', model: 'test-general', formModel: 'test-form', fetchImpl: async (_url, { body }) => {
      const payload = JSON.parse(body);
      assert.equal(payload.model, 'test-form');
      return Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({
        verdict: 'observations', summary: '', observations: [{ kind: 'strength', frame: 1, comparisonFrame,
          observation: 'The dumbbells stayed level on both sides.', cue: 'Keep the dumbbells level.' }],
      }) }] }] });
    } });
    return analyzeClip(responder, Buffer.alloc(0), { exercise, mime: 'video/mp4', sampleFrames: async () => frames });
  };
  const strength = await analyses(2);
  assert.deepEqual(strength.coverage.assessed, ['The visible positions cited with the cue']);
  assert.equal(strength.coverage.source, 'visual');
  assert.deepEqual(strength.modelConfiguration, { critique: 'test-form', detection: 'test-general', reference: 'test-general' });
  const unsupported = await analyses(null);
  assert.deepEqual(unsupported.observations, []);
  assert.deepEqual(unsupported.coverage.assessed, []);
  assert.match(unsupported.summary, /didn’t establish/);
});

test('clip workout context validates stable IDs, catalog movement, and set bounds', () => {
  const context = { sessionId: randomUUID(), workoutId: randomUUID(), exerciseId: 'push-up', setNumber: 2 };
  assert.deepEqual(normalizeClipTrainingContext({ ...context, unexpected: 'ignored' }), context);
  assert.equal(normalizeClipTrainingContext({ ...context, setNumber: 31 }), null);
  assert.equal(normalizeClipTrainingContext({ ...context, exerciseId: 'unknown' }), null);
  assert.equal(normalizeClipTrainingContext({ ...context, workoutId: 'not-a-workout' }), null);
});
