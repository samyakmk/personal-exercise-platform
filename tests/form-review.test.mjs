import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reviewExercise } from '../server/ai.mjs';
import { exercisesById } from '../server/catalog.mjs';
import { selectReviewFrames } from '../server/frames.mjs';
import { assessBirdTurn, assessCoreMotion } from '../server/core-motion.mjs';
import { assessBridge } from '../server/bridge.mjs';
import { assessCurl } from '../server/curl.mjs';
import { assessLunge } from '../server/lunge.mjs';
import { assessPlank } from '../server/plank.mjs';
import { assessPullUp } from '../server/pull-up.mjs';
import { assessPushUp, findPushUpEvidence } from '../server/push-up.mjs';
import { assessRow } from '../server/row.mjs';
import { assessShoulderPress } from '../server/shoulder-press.mjs';
import { assessSquat } from '../server/squat.mjs';

function pose(timestamp, hipY, { confidence = 0.95, mirror = false, elbowX = 2, shoulderY = 80 } = {}) {
  const points = Array.from({ length: 17 }, () => ({ x: 0, y: 0, confidence: 0 }));
  const coordinates = {
    5: [100, shoulderY],
    7: [100 + elbowX, (shoulderY + 168) / 2],
    9: [100, 168],
    11: [220, hipY],
    13: [300, 112 + (hipY - 100) * 0.5],
    15: [380, 126],
  };
  for (const [index, [x, y]] of Object.entries(coordinates)) {
    points[Number(index)] = { x: mirror ? 600 - x : x, y, confidence };
  }
  return { timestamp, points };
}

test('repeated hip deviations preserve direction when the camera view is mirrored', () => {
  for (const mirror of [false, true]) {
    const track = (hipY) => Array.from({ length: 40 }, (_, index) => {
      const lowered = [0, 1, 2].includes(index % 9);
      return pose(index / 4, hipY + (lowered ? 22 : 0), {
        mirror, elbowX: lowered ? 32 : 2, shoulderY: lowered ? 145 : 80,
      });
    });
    assert.match(findPushUpEvidence(track(130))[0].observation, /below/);
    assert.match(findPushUpEvidence(track(65))[0].observation, /above/);
    assert.deepEqual(findPushUpEvidence(track(100)), []);
  }
});

test('a static position with one bad pose sample does not count as a push-up cycle', () => {
  const frames = Array.from({ length: 32 }, (_, index) => pose(index / 4, 65, {
    elbowX: index === 16 ? 38 : 2,
    shoulderY: index === 16 ? 145 : 80,
  }));
  assert.deepEqual(assessPushUp(frames), { coverage: 'no_cycle', evidence: [] });
  const obscured = frames.map(({ timestamp }) => pose(timestamp, 65, { confidence: 0.25 }));
  assert.deepEqual(assessPushUp(obscured), { coverage: 'limited', evidence: [] });
});

test('an isolated deviation and low-confidence keypoints are excluded', () => {
  const track = Array.from({ length: 28 }, (_, index) => pose(index / 4, index === 14 ? 135 : 100, {
    elbowX: index % 7 === 0 ? 44 : 2,
  }));
  assert.deepEqual(findPushUpEvidence(track), []);
  assert.deepEqual(findPushUpEvidence(track.map(({ timestamp }) => pose(timestamp, 130, { confidence: 0.2 }))), []);
});

test('persistent raised hands withhold floor push-up corrections', async () => {
  const frames = Array.from({ length: 44 }, (_, index) => {
    const timestamp = index / 4;
    const { points } = pose(timestamp, 100);
    points[5].y = 40 + 25 * Math.sin(index / 2) ** 2;
    points[9].y = 121;
    points[11].y = 160;
    points[13].y = 207;
    points[15].y = 239;
    return { timestamp, points };
  });
  const assessed = assessPushUp(frames);
  assert.equal(assessed.coverage, 'raised_support');
  assert.deepEqual(assessed.evidence, []);
  assert.equal(assessed.verificationTimes.length, 2);
  const result = await reviewExercise(async () => ({
    verdict: 'observations', summary: 'The person is pushing up.', limitations: 'Side view.', observations: [],
  }), { exercise: exercisesById.get('push-up'), frames: [{ timestamp: 2, image: Buffer.from('frame') }], ...assessed });
  assert.equal(result.verdict, 'insufficient_visibility');
  assert.match(result.summary, /choose Incline Push-Up/);
});

test('frame selection includes measured evidence and stays within the eight-image limit', () => {
  const frames = Array.from({ length: 80 }, (_, index) => ({ timestamp: index / 4 }));
  const selected = selectReviewFrames(frames, [{ timestamp: 3.25, comparisonTimestamp: 4.25 }, { timestamp: 13.75 }]);
  assert.equal(selected.length, 8);
  const times = selected.map(({ timestamp }) => timestamp);
  assert.deepEqual(times, [...new Set(times)].sort((a, b) => a - b));
  assert.ok(times.includes(3.25));
  assert.ok(times.includes(4.25));
  assert.ok(times.includes(13.75));
  assert.equal(selectReviewFrames(frames, frames).length, 8);
});

test('push-up review uses measured adjustments and discards vision-only form claims', async () => {
  const exercise = exercisesById.get('push-up');
  const frames = [{ timestamp: 3, image: Buffer.from('frame') }];
  const evidence = [{ timestamp: 3, observation: 'Hips appear below the line.', cue: 'Brace the trunk.' }];
  const response = async () => ({
    verdict: 'observations', summary: 'This looks like a push-up.', limitations: 'One side is visible.',
    observations: [{ frame: 1, kind: 'strength', observation: 'Perfect alignment.', cue: 'Keep going.' }],
  });
  const withEvidence = await reviewExercise(response, { exercise, frames, evidence, coverage: 'measured' });
  assert.deepEqual(withEvidence.observations, [{ ...evidence[0], kind: 'adjustment' }]);
  const noEvidence = await reviewExercise(response, { exercise, frames, coverage: 'measured' });
  assert.equal(noEvidence.verdict, 'no_clear_issue');
  assert.deepEqual(noEvidence.observations, []);
  const unavailable = await reviewExercise(response, { exercise, frames });
  assert.match(unavailable.summary, /measurements were unavailable/);
  assert.equal(unavailable.verdict, 'insufficient_visibility');
  const limited = await reviewExercise(response, { exercise, frames, evidence, coverage: 'limited' });
  assert.match(limited.summary, /too few usable side-view positions/);
  assert.equal(limited.verdict, 'insufficient_visibility');
  assert.deepEqual(limited.observations, []);
  const mismatch = await reviewExercise(async () => ({
    verdict: 'different_exercise', summary: 'A lunge is visible.', limitations: 'No push-up is visible.', observations: [],
  }), { exercise, frames, evidence, coverage: 'measured' });
  assert.equal(mismatch.verdict, 'different_exercise');
  assert.deepEqual(mismatch.observations, []);
});

test('vision-only adjustments require a second valid frame and preserve both timestamps', async () => {
  const exercise = exercisesById.get('dumbbell-curl');
  const frames = [1, 4, 4.25].map((timestamp) => ({ timestamp, image: Buffer.from('frame') }));
  async function review(comparisonFrame) {
    return reviewExercise(async () => ({
      verdict: 'observations', summary: 'The curl is visible.', limitations: 'One side is visible.',
      observations: [{ frame: 2, comparisonFrame, kind: 'adjustment', observation: 'Your torso leans back.', cue: 'Try keeping your torso steady.' }],
    }), { exercise, frames });
  }
  const supported = await review(1);
  assert.equal(supported.verdict, 'observations');
  assert.equal(supported.observations[0].timestamp, 4);
  assert.equal(supported.observations[0].comparisonTimestamp, 1);
  for (const invalid of [null, 0, 2, 3, 4, 1.5, '1']) {
    const unsupported = await review(invalid);
    assert.equal(unsupported.verdict, 'no_clear_issue');
    assert.deepEqual(unsupported.observations, []);
  }
});

test('vision feedback keeps supported strengths in a no-clear-correction review', async () => {
  const exercise = exercisesById.get('dead-bug');
  const frames = [2, 3].map((timestamp) => ({ timestamp, image: Buffer.from('frame') }));
  const strength = { frame: 1, comparisonFrame: 2, kind: 'strength', observation: 'Your trunk stays steady.', cue: 'Keep the torso quiet.' };
  const review = await reviewExercise(async () => ({
    verdict: 'observations', summary: 'A bird dog hold is visible.', limitations: 'One side is visible.', observations: [strength],
  }), { exercise, frames });
  assert.equal(review.verdict, 'no_clear_issue');
  assert.deepEqual(review.observations, [{ timestamp: 2, comparisonTimestamp: 3, kind: strength.kind, observation: strength.observation, cue: strength.cue }]);
});

test('review keeps one useful point and drops incidental scene commentary', async () => {
  const exercise = exercisesById.get('incline-push-up');
  const frames = [1, 2].map((timestamp) => ({ timestamp, image: Buffer.from('frame') }));
  const adjustment = { frame: 2, comparisonFrame: 1, kind: 'adjustment',
    observation: 'Your hips rise ahead of your chest.', cue: 'Move your hips and chest together.' };
  const review = await reviewExercise(async () => ({
    verdict: 'observations', summary: 'There are bystanders.', limitations: 'There are reflections.',
    observations: [
      { frame: 1, kind: 'strength', observation: 'Other people are in view.', cue: 'Keep going.' },
      adjustment,
      { frame: 1, kind: 'strength', observation: 'Your hands stay on the bench.', cue: 'Keep your hands planted.' },
    ],
  }), { exercise, frames });
  assert.equal(review.summary, '');
  assert.equal(review.limitations, '');
  assert.deepEqual(review.observations, [{ timestamp: 2, comparisonTimestamp: 1, kind: 'adjustment',
    observation: adjustment.observation, cue: adjustment.cue }]);

  const obscured = await reviewExercise(async () => ({
    verdict: 'insufficient_visibility', summary: 'Bystanders cover parts of the movement.', observations: [],
  }), { exercise, frames });
  assert.match(obscured.summary, /working joints visible/);
  const visible = await reviewExercise(async () => ({
    verdict: 'observations', summary: '', observations: [],
  }), { exercise, frames });
  assert.equal(visible.verdict, 'no_clear_issue');
  assert.match(visible.summary, /didn’t see a clear correction/);
});

test('measured review keeps one local cue or a supported strength', async () => {
  const exercise = exercisesById.get('push-up');
  const frames = [1, 2].map((timestamp) => ({ timestamp, image: Buffer.from('frame') }));
  const response = async () => ({
    verdict: 'observations', summary: '',
    observations: [{ frame: 1, comparisonFrame: 2, kind: 'strength',
      observation: 'Your hips and shoulders move together.', cue: 'Keep that body line as you lower.' }],
  });
  const alignment = { timestamp: 1, observation: 'Your hips drop below your shoulders and ankles.', cue: 'Brace before lowering.' };
  const depth = { timestamp: 2, observation: 'Several descents look shallow.', cue: 'Try lowering a little farther.' };
  const options = { exercise, frames, coverage: 'measured' };
  const withEvidence = await reviewExercise(response, { ...options, evidence: [alignment, depth] });
  assert.deepEqual(withEvidence.observations, [{ ...alignment, kind: 'adjustment' }]);
  const clean = await reviewExercise(response, options);
  assert.equal(clean.verdict, 'no_clear_issue');
  assert.equal(clean.observations.length, 1);
  assert.equal(clean.observations[0].kind, 'strength');
  assert.equal(clean.observations[0].comparisonTimestamp, 2);
});

test('core reviews require a supported correction category and comparison', async () => {
  const exercise = exercisesById.get('dead-bug');
  const frames = [0, 1].map((timestamp) => ({ timestamp, image: Buffer.from('frame') }));
  const adjustment = { frame: 2, comparisonFrame: 1, kind: 'adjustment', observation: 'The trunk shifts.', cue: 'Keep the trunk steady.' };
  for (const [check, verdict] of [[null, 'no_clear_issue'], ['dead_bug_trunk_shift', 'observations']]) {
    const review = await reviewExercise(async ({ schema }) => {
      assert.ok(schema.properties.observations.items.properties.check.enum.includes('dead_bug_trunk_shift'));
      return { verdict: 'observations', summary: 'A dead bug is visible.', limitations: 'One side is visible.',
        observations: [{ ...adjustment, check }] };
    }, { exercise, frames });
    assert.equal(review.verdict, verdict);
    if (check) assert.equal(review.observations[0].check, check);
    else assert.deepEqual(review.observations, []);
  }
  const subtle = await reviewExercise(async () => ({
    verdict: 'observations', summary: 'A dead bug is visible.', limitations: 'One side is visible.',
    observations: [{ ...adjustment, observation: 'A small ribcage shift is visible.', check: 'dead_bug_trunk_shift' }],
  }), { exercise, frames });
  assert.equal(subtle.verdict, 'no_clear_issue');
  assert.deepEqual(subtle.observations, []);
});

test('core movement checks distinguish planted-hand lifts from a visible arm reach', () => {
  const sequence = (mode) => Array.from({ length: 20 }, (_, index) => {
    const lift = index >= 6 && index <= 12;
    const points = Array.from({ length: 17 }, () => ({ x: 0, y: 0, confidence: 0 }));
    const joints = {
      5: [120, 140], 6: [124, 140], 9: [122, 225],
      10: lift && mode === 'reach' ? [55, 145] : [126, 225],
      11: [220, 146], 12: [224, 146], 13: [225, lift ? 179 : 230], 14: [228, 231],
    };
    for (const [id, [x, y]] of Object.entries(joints)) {
      points[Number(id)] = { x, y, confidence: mode === 'occluded' && id === '10' ? 0.15 : 0.9 };
    }
    return { timestamp: index / 4, points };
  });
  assert.equal(assessCoreMotion('bird-dog', sequence('planted')).variant, 'quadruped_leg_only');
  assert.equal(assessCoreMotion('bird-dog', sequence('reach')), null);
  assert.equal(assessCoreMotion('bird-dog', sequence('occluded')), null);
});

test('authoritative local core mismatches return without calling the provider', async () => {
  const frames = [0, 1].map((timestamp) => ({ timestamp, image: Buffer.from('frame') }));
  const respond = async () => assert.fail('Local mismatch should not call the provider');
  for (const [exerciseId, coreMotion, summary] of [
    ['bird-dog', 'quadruped_leg_only', /Both hands stay down/],
    ['dead-bug', 'double_knee_to_chest', /knee-to-chest stretch/],
    ['dead-bug', 'single_straight_leg_raise', /straight-leg raise/],
    ['dead-bug', 'paired_knee_rotation', /lying rotation stretch/],
  ]) {
    const exercise = exercisesById.get(exerciseId);
    const review = await reviewExercise(respond, { exercise, frames, coreMotion, coverage: 'measured' });
    assert.equal(review.verdict, 'different_exercise');
    assert.match(review.summary, summary);
    assert.deepEqual(review.observations, []);
  }
  const reason = new Error('Cancelled');
  await assert.rejects(reviewExercise(respond, {
    exercise: exercisesById.get('bird-dog'), frames, coreMotion: 'quadruped_leg_only',
    signal: AbortSignal.abort(reason),
  }), (error) => error === reason);
});

test('a two-leg tuck with a sustained hold is distinguished from alternating dead-bug reaches', () => {
  function sequence(alternates, mirror) {
    return Array.from({ length: 20 }, (_, index) => {
      const tucked = index >= 6;
      const points = Array.from({ length: 17 }, () => ({ x: 0, y: 0, confidence: 0 }));
      for (const side of [0, 1]) {
        const reaches = tucked && !alternates;
        const bent = alternates && (!tucked || side !== Math.floor(index / 5) % 2);
        for (const [joint, x, y] of [
          [5, 100, 150], [11, 200, 156], [9, reaches ? 151 : 208, reaches ? 102 : 147],
          [13, reaches ? 121 : bent ? 206 : 274, reaches ? 110 : bent ? 78 : 148],
          [15, reaches ? 185 : bent ? 274 : 331, reaches ? 84 : bent ? 88 : 161],
        ]) points[joint + side] = { x: mirror ? 600 - x : x, y: y + 3 * side, confidence: 0.85 };
      }
      return { timestamp: index / 4, points };
    });
  }
  for (const mirror of [false, true]) {
    const motion = assessCoreMotion('dead-bug', sequence(false, mirror));
    assert.equal(motion.variant, 'double_knee_to_chest');
    assert.equal(motion.verificationTimes[0], 0);
    assert.equal(assessCoreMotion('dead-bug', sequence(true, mirror)), null);
    assert.equal(assessCoreMotion('dead-bug', sequence(false, mirror).slice(7)).variant, 'missing_raised_knee');
  }
});

test('a straight-leg raise needs one visibly extended leg throughout the other leg’s lift', () => {
  const frames = Array.from({ length: 24 }, (_, index) => {
    const lifted = index >= 5 && index <= 14;
    const points = Array.from({ length: 17 }, () => ({ x: 0, y: 0, confidence: 0 }));
    for (const side of [0, 1]) {
      const up = side === 0 && lifted;
      for (const [joint, x, y] of [
        [5, 100, 150], [11, 200, 150], [13, up ? 225 : 310, up ? 56 : 159], [15, up ? 253 : 428, up ? -49 : 176],
      ]) points[joint + side] = { x, y: y + 4 * side, confidence: 0.92 };
    }
    return { timestamp: index / 4, points };
  });
  assert.equal(assessCoreMotion('dead-bug', frames).variant, 'single_straight_leg_raise');
  const supportedKneeBent = frames.map(({ timestamp, points }) => ({ timestamp, points: points.map((point, index) => {
    if (index === 14) return { ...point, x: 205, y: 65 };
    if (index === 16) return { ...point, x: 292, y: 70 };
    return point;
  }) }));
  assert.equal(assessCoreMotion('dead-bug', supportedKneeBent), null);
});

test('a paired knee rotation needs both legs to move together from raised to lowered positions', () => {
  function frames(paired) {
    return Array.from({ length: 20 }, (_, index) => {
      const points = Array.from({ length: 17 }, () => ({ x: 0, y: 0, confidence: 0 }));
      for (const side of [0, 1]) {
        const lowered = index >= 7 && (paired || side === 0);
        const offset = !paired && side === 1 ? -64 : 0;
        for (const [joint, x, y] of [[5, 100, 150], [11, 200, 156], [13, 246 + offset, lowered ? 200 : 106],
          [15, 296 + offset, lowered ? 190 : 155]]) points[joint + side] = { x, y: y + 6 * side, confidence: 0.9 };
      }
      return { timestamp: index / 4, points };
    });
  }
  assert.equal(assessCoreMotion('dead-bug', frames(true)).variant, 'paired_knee_rotation');
  assert.notEqual(assessCoreMotion('dead-bug', frames(false))?.variant, 'paired_knee_rotation');
});

test('conflicting local core evidence withholds visual form corrections', async () => {
  const exercise = exercisesById.get('dead-bug');
  const frames = [0, 1].map((timestamp) => ({ timestamp, image: Buffer.from('frame') }));
  const review = await reviewExercise(async ({ content }) => {
    assert.match(content[0].text, /flutter kicks/);
    return {
      verdict: 'observations', summary: 'The dead bug is visible.', limitations: 'One side is visible.',
      observations: [{ frame: 2, comparisonFrame: 1, kind: 'adjustment', observation: 'The leg drops.', cue: 'Reach farther.' }],
    };
  }, { exercise, frames, coreMotion: 'straight_leg_flutter' });
  assert.equal(review.verdict, 'insufficient_visibility');
  assert.deepEqual(review.observations, []);
  const missing = await reviewExercise(async () => ({
    verdict: 'observations', summary: 'A dead bug is visible.', limitations: 'One side is visible.', observations: [],
  }), { exercise, frames, coreMotion: 'missing_raised_knee' });
  assert.equal(missing.verdict, 'insufficient_visibility');
  assert.match(missing.summary, /knee staying above the hip/);
});

test('a bridge cue requires two distinct high positions separated by a return', () => {
  const sequence = ({ repeat, above, mirror }) => Array.from({ length: 25 }, (_, index) => {
    const high = index >= 4 && index <= 8 || repeat && index >= 14 && index <= 19;
    const points = Array.from({ length: 17 }, () => ({ x: 0, y: 0, confidence: 0 }));
    for (const side of [0, 1]) {
      for (const [id, x, y] of [[5, 100, 150], [11, 200, high ? above ? 91 : 117 : 151],
        [13, 272, 94], [15, 276, 159]]) {
        points[id + side] = { x: mirror ? 600 - x : x, y: y + side * 4, confidence: 0.88 };
      }
    }
    return { timestamp: index / 4, points };
  });
  for (const mirror of [false, true]) {
    const result = assessBridge(sequence({ repeat: true, above: true, mirror }));
    assert.equal(result.evidence[0].check, 'glute_bridge_trunk_shift');
    assert.equal(assessBridge(sequence({ repeat: false, above: true, mirror })).evidence.length, 0);
    assert.equal(assessBridge(sequence({ repeat: true, above: false, mirror })).evidence.length, 0);
  }
});

test('bird-dog trunk-turn evidence needs contrasting reaches and both hip and shoulder movement', () => {
  const sequence = ({ turns, hipMoves = true }) => Array.from({ length: 16 }, (_, index) => {
    const first = index < 8;
    const points = Array.from({ length: 17 }, () => ({ x: 0, y: 0, confidence: 0 }));
    const width = turns && first ? 52 : 12;
    const hips = turns && first && hipMoves ? 37 : 10;
    const coordinates = {
      5: [120, 140 - width / 2], 6: [120, 140 + width / 2],
      9: first ? [25, 150] : [122, 225], 10: first ? [122, 225] : [25, 150],
      11: [220, 150 - hips / 2], 12: [220, 150 + hips / 2],
      15: first ? [232, 230] : [330, 160], 16: first ? [330, 160] : [232, 230],
    };
    for (const [id, [x, y]] of Object.entries(coordinates)) points[Number(id)] = { x, y, confidence: 0.9 };
    return { timestamp: index / 4, points };
  });
  assert.equal(assessBirdTurn(sequence({ turns: true })).check, 'bird_dog_pelvis_rotation');
  assert.equal(assessBirdTurn(sequence({ turns: true, hipMoves: false })), null);
  assert.equal(assessBirdTurn(sequence({ turns: false })), null);
  assert.equal(assessBirdTurn(sequence({ turns: true }).slice(0, 8)), null);
});

test('a row torso cue requires repeated pulls with a separate supporting arm', () => {
  function sequence({ turn = true, repeat = true, mirror = false, movingSupport = false }) {
    return Array.from({ length: 34 }, (_, index) => {
      const lift = [7, 8, ...(repeat ? [19, 20] : [])].includes(index);
      const points = Array.from({ length: 17 }, () => ({ x: 0, y: 0, confidence: 0 }));
      const joints = {
        5: [220, lift && turn ? 125 : 208], 6: [242, 219],
        7: lift ? [189, 113] : [220, 274], 8: movingSupport && lift ? [235, 248] : [243, 279],
        9: lift ? [184, 147] : [220, 369], 10: movingSupport && lift ? [209, 226] : [243, 339],
        11: [105, 205], 12: [115, 213],
      };
      for (const [id, [x, y]] of Object.entries(joints)) points[Number(id)] = { x: mirror ? 640 - x : x, y, confidence: 0.9 };
      return { timestamp: index / 4, points };
    });
  }
  for (const mirror of [false, true]) {
    assert.equal(assessRow(sequence({ mirror })).evidence[0].check, 'dumbbell_row_trunk_turn');
    assert.equal(assessRow(sequence({ mirror, turn: false })).evidence.length, 0);
    assert.equal(assessRow(sequence({ mirror, repeat: false })).evidence.length, 0);
    assert.equal(assessRow(sequence({ mirror, movingSupport: true })).evidence.length, 0);
  }
});

test('curl rocking requires two distinct lifts and both visible torso tracks', async () => {
  const exercise = exercisesById.get('dumbbell-curl');
  function repetitions({ mirror = false, repeat = true, clean = false, occluded = false } = {}) {
    return Array.from({ length: 32 }, (_, index) => {
      const timestamp = index / 4;
      const curl = [7, 8, 15, 16, 23, 24].includes(index);
      const lean = !clean && (index === 5 || repeat && [13, 21].includes(index));
      const { points } = pose(timestamp, 210);
      for (const side of [0, 1]) {
        const hip = 240 + side * 12;
        const shoulder = hip + (lean ? 28 : 0);
        const joints = [[5, shoulder, 115], [7, shoulder, 155], [9, shoulder + (curl ? 20 : 0), curl ? 132 : 195], [11, hip, 210]];
        for (const [joint, x, y] of joints) points[joint + side] = { x: mirror ? 640 - x : x, y, confidence: side && occluded ? 0.2 : 0.93 };
      }
      return { timestamp, points };
    });
  }
  const result = assessCurl(repetitions());
  assert.equal(result.evidence[0].check, 'curl_torso_rocking');
  assert.equal(result.verificationTimes.length, 2);
  assert.deepEqual(assessCurl(repetitions({ mirror: true })).evidence, result.evidence);
  for (const options of [{ repeat: false }, { clean: true }, { occluded: true }]) {
    assert.deepEqual(assessCurl(repetitions(options)).evidence, []);
  }
  const frames = [{ timestamp: 1, image: Buffer.from('frame') }];
  const verify = (verdict) => async () => ({ verdict, summary: 'Exercise identity.', limitations: 'Side view.', observations: [] });
  assert.equal((await reviewExercise(verify('observations'), { exercise, frames, ...result })).observations[0].check, 'curl_torso_rocking');
  assert.deepEqual((await reviewExercise(verify('different_exercise'), { exercise, frames, ...result })).observations, []);
});

test('pull-up cues need repeated low reversals on one visible arm', async () => {
  const exercise = exercisesById.get('pull-up');
  function repetitions({ mirror = false, full = false, count = 3 } = {}) {
    const cycle = [0, 1, 2, 3, 4, 3, 2, 1];
    return Array.from({ length: 8 * count }, (_, index) => {
      const timestamp = index / 4;
      const phase = cycle[index % cycle.length];
      const { points } = pose(timestamp, 240);
      const near = [[0, 90, 140, 115, 65, 100], [15, 120, 135, 120, 65, 100], [25, 145, 120, 130, 65, 100],
        [40, 174, 85, 145, 65, 100], [50, 198, 97, 159, 65, 100]][phase];
      if (full && phase === 4) near.splice(0, 4, 65, 216, 65, 158);
      for (const side of [0, 1]) {
        const [sx, sy, ex, ey, wx, wy] = near;
        for (const [joint, x, y] of [[5, sx, sy], [7, ex, ey], [9, wx, wy]]) {
          const projected = x + side * 100;
          points[joint + side] = { x: mirror ? 600 - projected : projected, y, confidence: 0.92 };
        }
      }
      return { timestamp, points };
    });
  }
  const result = assessPullUp(repetitions());
  assert.equal(result.evidence[0]?.check, 'pull_up_short_bottom');
  assert.deepEqual(assessPullUp(repetitions({ mirror: true })).evidence, result.evidence);
  assert.deepEqual(assessPullUp(repetitions({ count: 1 })).evidence, []);
  assert.deepEqual(assessPullUp(repetitions({ full: true })).evidence, []);
  const verify = (verdict) => async () => ({ verdict, summary: 'Movement identity.', limitations: 'The chin is outside the view.', observations: [] });
  const frames = [{ timestamp: 1, image: Buffer.from('frame') }];
  assert.equal((await reviewExercise(verify('observations'), { exercise, frames, ...result })).observations[0].check, 'pull_up_short_bottom');
  assert.deepEqual((await reviewExercise(verify('different_exercise'), { exercise, frames, ...result })).observations, []);
  const brief = assessPullUp(repetitions().slice(0, 6));
  const cropped = assessPullUp(repetitions().map(({ timestamp, points }) => ({
    timestamp, points: points.map((point) => ({ ...point, y: point.y - 100 })),
  })));
  const hold = assessPullUp(repetitions().map(({ timestamp }, index) => {
    const points = pose(timestamp, 200).points;
    for (const side of [0, 1]) {
      for (const [joint, x, y] of [[5, 100, 165], [7, 174, 250], [9, 210, 110]]) {
        points[joint + side] = { x: x + side * 105, y: y - index, confidence: 0.95 };
      }
    }
    return { timestamp, points };
  }));
  assert.equal(brief.coverage, 'short_window');
  assert.equal(cropped.coverage, 'bar_at_edge');
  assert.equal(hold.coverage, 'no_cycle');
  for (const clip of [brief, cropped, hold]) {
    const feedback = await reviewExercise(verify('observations'), { exercise, frames, ...clip });
    assert.equal(feedback.verdict, 'insufficient_visibility');
    assert.deepEqual(feedback.observations, []);
  }
  const swing = repetitions({ full: true }).map(({ timestamp, points }, index) => ({
    timestamp, points: points.map((point, joint) => {
      if ([11, 12].includes(joint)) return { ...points[joint - 6], y: points[joint - 6].y + 110 };
      if ([15, 16].includes(joint)) {
        const shoulder = points[joint - 10];
        return { ...shoulder, x: shoulder.x + (index % 8 === 1 ? 78 : -20), y: shoulder.y + 215 };
      }
      return point;
    }),
  }));
  assert.equal(assessPullUp(swing).evidence[0]?.check, 'pull_up_repeated_swing');
  const withoutEvidence = await reviewExercise(async () => ({
    verdict: 'observations', summary: 'Pull-up.', limitations: 'One side is visible.',
    observations: [{ frame: 1, kind: 'adjustment', observation: 'Unsupported claim.', cue: 'Change it.' }],
  }), { exercise, frames, coverage: 'measured' });
  assert.equal(withoutEvidence.verdict, 'no_clear_issue');
  assert.deepEqual(withoutEvidence.observations, []);
});

test('a sustained forearm plank deviation keeps its direction in a mirrored camera', () => {
  const poses = (hipY, mirror = false, crop = false) => Array.from({ length: 16 }, (_, index) => {
    const { timestamp, points } = pose(index / 4, typeof hipY === 'function' ? hipY(index) : hipY, { mirror });
    points[7] = { x: mirror ? 500 : 100, y: 152, confidence: 0.95 };
    points[9] = { x: mirror ? 546 : 54, y: 151, confidence: 0.95 };
    points[13].y = (points[11].y + points[15].y) / 2;
    if (crop) points[15].confidence = 0.1;
    return { timestamp, points };
  });
  for (const mirror of [false, true]) {
    const sag = assessPlank(poses(135, mirror));
    assert.equal(sag.evidence[0].check, 'plank_hip_sag');
    assert.ok(sag.evidence[0].comparisonTimestamp < sag.evidence[0].timestamp);
    assert.equal(assessPlank(poses(75, mirror)).evidence[0].check, 'plank_raised_hips');
    assert.deepEqual(assessPlank(poses(100, mirror)).evidence, []);
    assert.deepEqual(assessPlank(poses((index) => index === 8 ? 135 : 100, mirror)).evidence, []);
    assert.equal(assessPlank(poses(135, mirror, true)).coverage, 'limited');
  }
  const diagonal = poses(100).map(({ timestamp, points }) => {
    points[9].y += 43;
    points[9].confidence = 0.39;
    return { timestamp, points };
  });
  assert.equal(assessPlank(diagonal).coverage, 'measured');
  assert.deepEqual(assessPlank(diagonal).evidence, []);
});

test('a standing press range cue needs repeated overhead troughs and yields to deeper evidence', () => {
  function sequence({ deep = false, wristConfidence = 0.8 } = {}) {
    return Array.from({ length: 48 }, (_, index) => {
      const points = Array.from({ length: 17 }, () => ({ x: 0, y: 0, confidence: 0 }));
      const height = deep && [20, 28].includes(index) ? -30 : [65, 55, 32, 56][index % 4];
      points[5] = { x: 200, y: 210, confidence: 0.8 };
      points[7] = { x: 243, y: 210 - height, confidence: 0.8 };
      points[9] = { x: 253, y: 210 - height - 49, confidence: wristConfidence };
      points[11] = { x: 200, y: 310, confidence: 0.8 };
      return { timestamp: index / 4, points };
    });
  }
  assert.equal(assessShoulderPress(sequence()).evidence[0].check, 'shoulder_press_short_descent');
  assert.deepEqual(assessShoulderPress(sequence({ deep: true })).evidence, []);
  assert.deepEqual(assessShoulderPress(sequence({ wristConfidence: 0.15 })), { coverage: 'no_cycle', evidence: [] });
});

test('a standing press is separated from a step into a lowered split stance with the press', async () => {
  function frames(steps) {
    return Array.from({ length: 24 }, (_, index) => {
      const lowered = index >= 6 && index <= 16;
      const hipY = lowered ? 355 : 300;
      const points = Array.from({ length: 17 }, () => ({ x: 0, y: 0, confidence: 0 }));
      for (const side of [0, 1]) {
        for (const [joint, x, y] of [
          [5, 210 + side * 30, hipY - 100], [11, 210 + side * 30, hipY],
          [9, 190 + side * 70, lowered ? hipY - 195 : hipY - 95],
          [15, 207 + side * (lowered && steps ? 113 : 37), 430 + side * (lowered && steps ? 34 : 0)],
        ]) points[joint + side] = { x, y, confidence: 0.9 };
      }
      return { timestamp: index / 4, points };
    });
  }
  const assessed = assessShoulderPress(frames(true));
  assert.equal(assessed.coverage, 'compound_press');
  assert.notEqual(assessShoulderPress(frames(false)).coverage, 'compound_press');
  const review = await reviewExercise(async () => assert.fail('Local mismatch should not call the provider'), {
    exercise: exercisesById.get('dumbbell-shoulder-press'), frames: [{ timestamp: 0, image: Buffer.from('frame') }], ...assessed,
  });
  assert.equal(review.verdict, 'different_exercise');
  assert.match(review.summary, /lunge with an overhead press/);
});

test('squat depth requires repeated visible lows and withholds a cue for mixed or frontal clips', () => {
  function sequence({ mixed = false, front = false } = {}) {
    return Array.from({ length: 40 }, (_, index) => {
      const phase = (1 - Math.cos(2 * Math.PI * (index % 10) / 10)) / 2;
      const depth = mixed && index >= 20 && index < 30 ? 100 : 62;
      const points = Array.from({ length: 17 }, () => ({ x: 0, y: 0, confidence: 0 }));
      for (const side of [0, 1]) {
        const offset = front ? (side ? 1 : -1) * 50 : 4 * side;
        const hipY = 205 + depth * phase;
        const leg = front ? (side ? 1 : -1) : 1;
        const locations = {
          5: [250 + offset + (front ? 0 : 9 * phase), hipY - 90],
          11: [250 + offset - (front ? 0 : 23 * phase), hipY],
          13: [256 + offset + leg * 48 * phase, 298 + 24 * phase],
          15: [254 + offset + (front ? 11 * leg : 0), 400],
        };
        for (const [id, [x, y]] of Object.entries(locations)) points[Number(id) + side] = { x, y, confidence: 0.8 };
      }
      return { timestamp: index / 4, points };
    });
  }
  const shallow = assessSquat(sequence());
  assert.equal(shallow.evidence[0].check, 'squat_short_depth');
  assert.ok(Math.abs(shallow.evidence[0].timestamp - shallow.evidence[0].comparisonTimestamp) >= 0.9);
  assert.deepEqual(assessSquat(sequence({ mixed: true })).evidence, []);
  assert.deepEqual(assessSquat(sequence({ front: true })), { coverage: 'limited', evidence: [] });
});

test('lunge identification compares the step with standing positions on both sides of a rep', () => {
  function sequence(variant, { mirror = false, hidden = false } = {}) {
    return [0, 0, 0.2, 0.5, 0.8, 1, 0.8, 0.5, 0.2, 0, 0].map((split, index) => {
      const points = Array.from({ length: 17 }, () => ({ x: 0, y: 0, confidence: 0 }));
      const lower = split * 80;
      const leftStep = variant === 'reverse_lunge' ? -120 : variant === 'split_movement' ? -60 : 0;
      const rightStep = variant === 'forward_lunge' ? 120 : variant === 'split_movement' ? 60 : 0;
      const positions = {
        0: [320, 120 + lower], 3: [298, 125 + lower], 4: [296, 125 + lower],
        5: [292, 150 + lower], 6: [308, 150 + lower],
        11: [292, 250 + lower], 12: [308, 250 + lower],
        15: [284 + leftStep * split, 420], 16: [316 + rightStep * split, 420],
      };
      for (const [id, [x, y]] of Object.entries(positions)) {
        points[id] = { x: mirror ? 640 - x : x, y, confidence: hidden && id === '16' ? 0.15 : 0.8 };
      }
      return { timestamp: index / 4, points };
    });
  }
  for (const variant of ['reverse_lunge', 'forward_lunge', 'split_movement']) {
    for (const mirror of [false, true]) {
      const measured = assessLunge(sequence(variant, { mirror }));
      assert.equal(measured.variant, variant);
      assert.ok(measured.verificationTimes[0] < measured.verificationTimes[1]);
      assert.ok(measured.verificationTimes[1] < measured.verificationTimes[2]);
    }
  }
  assert.equal(assessLunge(sequence('reverse_lunge', { hidden: true })), null);
  assert.equal(assessLunge(sequence('reverse_lunge').slice(2, 7)), null);
});

test('a reverse-lunge review withholds feedback when the step direction is unclear or different', async () => {
  const exercise = exercisesById.get('reverse-lunge');
  const frames = [0, 1, 2].map((timestamp) => ({ timestamp, image: Buffer.from('frame') }));
  const respond = async () => ({
    verdict: 'observations', summary: 'A reverse lunge is visible.', limitations: 'Side view.',
    observations: [{ frame: 2, comparisonFrame: 1, kind: 'adjustment', observation: 'The front heel lifts.', cue: 'Keep the foot planted.' }],
  });
  for (const [lungeMotion, verdict] of [[undefined, 'insufficient_visibility'], ['forward_lunge', 'different_exercise'],
    ['split_movement', 'different_exercise'], ['reverse_lunge', 'observations']]) {
    const review = await reviewExercise(respond, { exercise, frames, lungeMotion });
    assert.equal(review.verdict, verdict);
    assert.equal(review.observations.length, Number(verdict === 'observations'));
  }
});
