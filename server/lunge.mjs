const position = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

function measure({ timestamp, points }) {
  const [nose, leftEar, rightEar, leftShoulder, rightShoulder, leftHip, rightHip, leftAnkle, rightAnkle] =
    [0, 3, 4, 5, 6, 11, 12, 15, 16].map((id) => points[id]);
  const hip = position(leftHip, rightHip);
  const shoulder = position(leftShoulder, rightShoulder);
  const torso = Math.hypot(hip.x - shoulder.x, hip.y - shoulder.y);
  if (torso < 32 || hip.y - shoulder.y < 0.7 * torso
    || Math.min(leftShoulder.confidence, rightShoulder.confidence, leftHip.confidence, rightHip.confidence) < 0.34
    || Math.min(leftAnkle.confidence, rightAnkle.confidence) < 0.25
    || Math.max(leftAnkle.confidence, rightAnkle.confidence) < 0.35) return null;

  const left = Math.min(leftAnkle.x, rightAnkle.x);
  const right = Math.max(leftAnkle.x, rightAnkle.x);
  const facing = nose.confidence >= 0.35 ? [leftEar, rightEar]
    .filter((ear) => ear.confidence >= 0.35 && Math.abs(nose.x - ear.x) >= 0.065 * torso)
    .map((ear) => Math.sign(nose.x - ear.x)) : [];
  return { timestamp, hip, torso, left, right, facing };
}

function classify(bottom, before, after) {
  const measurements = [before, bottom, after];
  const votes = measurements.flatMap((frame) => frame.facing);
  const balance = votes.reduce((sum, vote) => sum + vote, 0);
  if (votes.length < 2 || Math.abs(balance) / votes.length < 0.6) return null;
  const facing = Math.sign(balance);
  const delta = (foot) => [before, after].map((upright) => (bottom[foot] - upright[foot]) * facing / bottom.torso);
  const feet = [delta('left'), delta('right')];
  const moved = feet.find((deltas) => deltas.every((change) => Math.abs(change) >= 0.68 && Math.sign(change) === Math.sign(deltas[0])));
  const stayed = feet.find((deltas) => deltas.every((change) => Math.abs(change) <= 0.48));
  if (moved && stayed) return moved[0] > 0 ? 'forward_lunge' : 'reverse_lunge';
  const opposite = feet[0][0] * feet[1][0] < 0 && feet[0][1] * feet[1][1] < 0;
  if (opposite && feet.every((deltas) => deltas.every((change) => Math.abs(change) > 0.44))) return 'split_movement';
  return null;
}

function lungeCycles(poses) {
  const frames = poses.map(measure);
  const cycles = [];
  for (let index = 2; index < frames.length - 2; index += 1) {
    const bottom = frames[index];
    if (!bottom || bottom.right - bottom.left < 0.65 * bottom.torso) continue;
    const nearby = frames.slice(index - 2, index + 3).filter(Boolean);
    if (nearby.some((frame) => frame.hip.y > bottom.hip.y)) continue;
    const standing = (frame) => frame && frame.right - frame.left < 0.6 * bottom.torso
      && frame.hip.y < bottom.hip.y - 0.24 * bottom.torso;
    const before = frames.slice(Math.max(0, index - 9), index - 1).findLast(standing);
    const after = frames.slice(index + 2, index + 10).find(standing);
    if (!before || !after) continue;
    const variant = classify(bottom, before, after);
    if (variant && (!cycles.length || bottom.timestamp - cycles.at(-1).bottom >= 0.9)) {
      cycles.push({ variant, before: before.timestamp, bottom: bottom.timestamp, after: after.timestamp });
    }
  }
  return cycles;
}

export function assessLunge(poses) {
  const cycles = lungeCycles(poses);
  const cycle = cycles[0];
  // One complete step can be useful. Contradictory steps make the clip ambiguous.
  if (!cycle || cycles.some(({ variant }) => variant !== cycle.variant)) return null;
  return {
    variant: cycle.variant,
    verificationTimes: [cycle.before, cycle.bottom, cycle.after, ...(cycles.length > 1 ? [cycles.at(-1).bottom] : [])],
  };
}
