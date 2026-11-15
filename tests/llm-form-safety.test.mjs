import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reviewExercise } from '../server/ai.mjs';
import { exercisesById } from '../server/catalog.mjs';

const frames = [1, 1.25, 2.5].map((timestamp) => ({ timestamp, image: Buffer.from('synthetic frame') }));
const adjustment = { frame: 1, comparisonFrame: 3, kind: 'adjustment',
  observation: 'One dumbbell moves out from above your forearm.', cue: 'Try keeping the weight over the forearm as you lower.' };
const run = (exerciseId, output, options) => reviewExercise(async () => output,
  { exercise: exercisesById.get(exerciseId), frames, ...options });
const findings = (...observations) => ({ verdict: 'observations', summary: '', observations });

test('valid-schema form feedback cannot deliver clear injury claims or instructions to keep lifting through pain', async () => {
  for (const patch of [
    { observation: 'This motion will injure your shoulder.' },
    { cue: 'Take 800mg ibuprofen and press through pain.' },
    { cue: 'Press through your pain.' },
    { observation: 'Your technique is completely safe.' },
    { observation: 'This movement is safe.' },
    { observation: 'This exercise can be performed safely with any weight.' },
  ]) {
    const feedback = await run('dumbbell-bench-press', findings({ ...adjustment, ...patch }));
    assert.equal(feedback.verdict, 'no_clear_issue');
    assert.deepEqual(feedback.observations, []);
  }
  // A specific, visible technique point can still be selected.
  assert.equal((await run('dumbbell-bench-press', findings(adjustment))).observations[0].cue, adjustment.cue);
});

test('form review uses a neutral alternative when a verdict summary makes a diagnosis', async () => {
  for (const summary of ['You have a torn rotator cuff.', 'You have a slipped disc.']) {
    for (const verdict of ['insufficient_visibility', 'different_exercise']) {
      const feedback = await run('incline-push-up', { verdict, summary, observations: [] });
      assert.equal(feedback.verdict, verdict);
      assert.notEqual(feedback.summary, summary);
      assert.deepEqual(feedback.observations, []);
    }
  }
});

test('neither measured nor vision review turns a single still into a strength across the exercise', async () => {
  for (const exercise of ['push-up', 'fedb-dumbbell-shoulder-press', 'dead-bug']) {
    const point = { ...adjustment, kind: 'strength', observation: 'The visible working joints move together.' };
    for (const comparisonFrame of [null, 1, 2, 5]) {
      const feedback = await run(exercise, findings({ ...point, comparisonFrame }), { coverage: 'measured' });
      assert.equal(feedback.verdict, 'no_clear_issue');
      assert.deepEqual(feedback.observations, []);
    }
    const feedback = await run(exercise, findings(point), { coverage: 'measured' });
    assert.equal(feedback.observations[0].comparisonTimestamp, 2.5);
  }
});
