const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const visible = (points, minimum = 0.35) => points.every(({ confidence }) => confidence >= minimum);

function corePose({ timestamp, points }) {
  const shoulders = points.slice(5, 7);
  const wrists = points.slice(9, 11);
  const hips = points.slice(11, 13);
  const knees = points.slice(13, 15);
  const ankles = points.slice(15, 17);
  if (!visible([...shoulders, ...hips])) return null;
  const shoulder = midpoint(...shoulders);
  const hip = midpoint(...hips);
  const scale = distance(shoulder, hip);
  const horizontal = hip.x - shoulder.x;
  if (scale < 45 || Math.abs(horizontal) < scale * 0.83) return null;
  return { timestamp, shoulder, hip, scale, direction: Math.sign(horizontal), shoulders, hips, wrists, knees, ankles };
}

function supportsUpperBody(frame, hand) {
  return hand.y - frame.shoulder.y > 0.52 * frame.scale && Math.abs(hand.x - frame.shoulder.x) < 0.48 * frame.scale;
}

function selectMoments(frames) {
  const last = frames.at(-1);
  if (frames.length < 5 || last.timestamp - frames[0].timestamp < 1.25) return null;
  return [...new Set([frames[0], frames[Math.floor(frames.length / 2)], last].map(({ timestamp }) => timestamp))];
}

function quadrupedLegMotion(frames) {
  const supported = frames.filter((frame) => visible(frame.wrists) && frame.wrists.every((hand) => supportsUpperBody(frame, hand)));
  if (supported.length < 0.78 * frames.length) return null;
  const stable = supported.filter((frame) => frame.direction === supported[0].direction
    && frame.wrists.every((hand, side) => distance(hand, supported[0].wrists[side]) < 0.20 * frame.scale));
  // Incomplete observations can hide the reaching hand of a genuine bird dog.
  if (stable.length < 0.78 * frames.length) return null;
  for (const side of [0, 1]) {
    const usable = stable.filter(({ knees }) => visible([knees[side], knees[1 - side]], 0.26));
    if (!usable.length) continue;
    const lowest = usable.reduce((a, b) => a.knees[side].y > b.knees[side].y ? a : b);
    const lifted = usable.filter((frame) => lowest.knees[side].y - frame.knees[side].y > 0.36 * frame.scale
      && frame.knees[1 - side].y - frame.hip.y > 0.50 * frame.scale);
    if (lifted.length < 2 || lifted.at(-1).timestamp - lifted[0].timestamp < 0.25) continue;
    const verificationTimes = selectMoments(stable);
    if (verificationTimes) return { variant: 'quadruped_leg_only',
      verificationTimes: [...new Set([lowest.timestamp, lifted[0].timestamp, lifted.at(-1).timestamp, ...verificationTimes])] };
  }
  return null;
}

function supineCrunchMotion(frames) {
  const raisedLegs = frames.filter(({ scale, hip, knees, ankles }) => visible([...knees, ...ankles])
    && distance(...knees) < 0.24 * scale && distance(...ankles) < 0.28 * scale
    && knees.every((point) => hip.y - point.y > 0.47 * scale)
    && ankles.every((point) => hip.y - point.y > 0.88 * scale));
  if (raisedLegs.length < 0.77 * frames.length) return null;
  const reaches = raisedLegs.filter(({ wrists, scale, direction, hip }) => visible(wrists, 0.30)
    && distance(...wrists) < 0.20 * scale
    && wrists.every((hand) => hip.y - hand.y > 0.74 * scale && (hip.x - hand.x) * direction > 0.25 * scale));
  const flat = reaches.find(({ hip, shoulder, scale }) => hip.y - shoulder.y < 0.10 * scale);
  const lifted = reaches.find(({ hip, shoulder, scale }) => hip.y - shoulder.y > 0.18 * scale);
  const verificationTimes = selectMoments(reaches);
  return flat && lifted && verificationTimes ? {
    variant: 'synchronous_toe_touch', verificationTimes: [...new Set([flat.timestamp, lifted.timestamp, ...verificationTimes])],
  } : null;
}

function kneeToChestMotion(frames) {
  const paired = frames.filter(({ scale, knees, ankles }) => visible([...knees, ...ankles], 0.30)
    && distance(...knees) < 0.34 * scale && distance(...ankles) < 0.32 * scale);
  if (paired.length < 0.78 * frames.length) return null;
  const setup = paired.find(({ direction, hip, knees, ankles, scale }) =>
    (midpoint(...knees).x - hip.x) * direction > 0.52 * scale && (midpoint(...ankles).x - hip.x) * direction > 0.9 * scale);
  if (!setup) return null;
  const tucked = paired.filter(({ timestamp, direction, hip, knees, ankles, wrists, scale }) => {
    if (timestamp <= setup.timestamp || !visible(wrists, 0.28)) return false;
    const knee = midpoint(...knees);
    const ankle = midpoint(...ankles);
    return (hip.x - knee.x) * direction > 0.65 * scale && hip.y - ankle.y > 0.55 * scale
      && wrists.every((hand) => distance(hand, knee) < 0.72 * scale && distance(hand, ankle) < 0.72 * scale);
  });
  const hold = selectMoments(tucked);
  return hold ? { variant: 'double_knee_to_chest', verificationTimes: [setup.timestamp, ...hold] } : null;
}

function extendedKnee(hip, knee, ankle) {
  const thigh = distance(hip, knee);
  const shin = distance(knee, ankle);
  return thigh > 0 && shin > 0
    && ((hip.x - knee.x) * (ankle.x - knee.x) + (hip.y - knee.y) * (ankle.y - knee.y)) / (thigh * shin) < -0.85;
}

function separateLegRaise(frames) {
  for (const side of [0, 1]) {
    const other = 1 - side;
    const grounded = frames.filter(({ scale, direction, hips, knees, ankles }) =>
      visible([hips[other], knees[other], ankles[other]], 0.32)
      && (knees[other].x - hips[other].x) * direction > 0.74 * scale
      && (ankles[other].x - hips[other].x) * direction > 1.45 * scale
      && ankles[other].y >= hips[other].y - 0.10 * scale
      && extendedKnee(hips[other], knees[other], ankles[other]));
    if (grounded.length < 0.85 * frames.length) continue;
    const low = grounded.find(({ scale, hips, knees, ankles }) => visible([knees[side], ankles[side]])
      && ankles[side].y >= hips[side].y - 0.12 * scale && extendedKnee(hips[side], knees[side], ankles[side]));
    const lifts = grounded.filter(({ scale, hips, knees, ankles }) => visible([knees[side], ankles[side]])
      && hips[side].y - knees[side].y > 0.37 * scale && hips[side].y - ankles[side].y > 0.85 * scale
      && extendedKnee(hips[side], knees[side], ankles[side]));
    if (low && lifts.length >= 3 && lifts.at(-1).timestamp - lifts[0].timestamp >= 0.75) {
      return { variant: 'single_straight_leg_raise', verificationTimes: [low.timestamp, lifts[0].timestamp, lifts.at(-1).timestamp] };
    }
  }
  return null;
}

function flutterKickMotion(frames) {
  const extended = frames.filter(({ scale, direction, hip, wrists, knees, ankles }) => visible([...wrists, ...knees, ...ankles])
    && wrists.every((hand) => distance(hip, hand) < 0.40 * scale)
    && knees.every((knee, side) => (knee.x - hip.x) * direction > 0.20 * scale && extendedKnee(hip, knee, ankles[side])));
  if (extended.length < 0.70 * frames.length) return null;
  const high = (side) => extended.find(({ ankles, scale }) => ankles[1 - side].y - ankles[side].y > 0.38 * scale);
  const left = high(0);
  const right = high(1);
  const verificationTimes = selectMoments(extended);
  return left && right && verificationTimes ? {
    variant: 'straight_leg_flutter', verificationTimes: [...new Set([left.timestamp, right.timestamp, ...verificationTimes])],
  } : null;
}

function missingRaisedKnee(frames) {
  const usable = frames.filter(({ knees, ankles }) => visible([...knees, ...ankles], 0.32));
  const moments = selectMoments(usable);
  if (usable.length < 0.72 * frames.length || !moments) return null;
  const hasRaisedKnee = frames.some(({ hip, knees, scale }) => knees.some((knee) => knee.confidence >= 0.35
    && Math.abs(hip.x - knee.x) < 0.43 * scale && hip.y - knee.y >= 0.52 * scale));
  return hasRaisedKnee ? null : { variant: 'missing_raised_knee', verificationTimes: moments };
}

function pairedKneeRotation(frames) {
  const paired = frames.filter(({ direction, hip, knees, ankles, scale }) => visible([...knees, ...ankles], 0.33)
    && Math.abs(knees[0].x - knees[1].x) < 0.22 * scale && Math.abs(ankles[0].x - ankles[1].x) < 0.20 * scale
    && (midpoint(...knees).x - hip.x) * direction > 0.25 * scale);
  if (paired.length < 0.8 * frames.length) return null;
  const up = paired.find(({ hip, knees, scale }) => midpoint(...knees).y < hip.y - 0.32 * scale);
  if (!up) return null;
  const down = paired.filter(({ hip, knees, scale, timestamp }) => timestamp >= up.timestamp + 1
    && midpoint(...knees).y > hip.y + 0.26 * scale);
  return down.length >= 3 ? { variant: 'paired_knee_rotation', verificationTimes: [up.timestamp, down[0].timestamp, down.at(-1).timestamp] } : null;
}

function birdReach(frames, side) {
  return frames.flatMap((frame) => {
    const { direction, shoulder, hip, scale, wrists, ankles, shoulders, hips, timestamp } = frame;
    const arm = wrists[side];
    const leg = ankles[1 - side];
    if (!visible([arm, leg, wrists[1 - side]], 0.44)
      || (shoulder.x - arm.x) * direction < 0.75 * scale || arm.y - shoulder.y > 0.65 * scale
      || (leg.x - hip.x) * direction < 0.8 * scale || !supportsUpperBody(frame, wrists[1 - side])) return [];
    return [{ timestamp, shoulderSpan: distance(...shoulders) / scale, hipSpan: distance(...hips) / scale }];
  });
}

export function assessBirdTurn(poses) {
  const frames = poses.map(corePose).filter(Boolean);
  const [first, second] = [0, 1].map((side) => birdReach(frames, side));
  if (first.length < 2 || second.length < 2) return null;
  const median = (items, key) => items.map((frame) => frame[key]).sort((a, b) => a - b)[Math.floor(items.length / 2)];
  const sideOn = [first, second].sort((a, b) => median(a, 'shoulderSpan') - median(b, 'shoulderSpan'));
  const [narrow, wide] = sideOn;
  if (median(wide, 'shoulderSpan') - median(narrow, 'shoulderSpan') < 0.31
    || median(wide, 'hipSpan') - median(narrow, 'hipSpan') < 0.14) return null;
  return {
    check: 'bird_dog_pelvis_rotation',
    timestamp: wide[Math.floor(wide.length / 2)].timestamp,
    comparisonTimestamp: narrow[Math.floor(narrow.length / 2)].timestamp,
    observation: 'Your trunk appears to turn between the two reaches.',
    cue: 'Keep your chest and hips facing the floor as you reach. Shorten the reach if needed to stay steady.',
  };
}

export function assessCoreMotion(exercise, poses) {
  if (poses.length < 10) return null;
  const frames = poses.map(corePose).filter(Boolean);
  if (exercise === 'dead-bug') {
    const lowerBodyFrames = poses.filter(({ points }) => [0, 1].some((side) => visible(
      [points[5 + side], points[11 + side], points[13 + side], points[15 + side]], 0.32,
    )));
    if (lowerBodyFrames.length < 0.20 * poses.length) return { variant: 'lower_body_obscured', verificationTimes: [] };
  }
  if (frames.length < Math.max(8, 0.75 * poses.length)) return null;
  if (exercise === 'bird-dog') return quadrupedLegMotion(frames);
  return exercise === 'dead-bug'
    ? kneeToChestMotion(frames) ?? separateLegRaise(frames) ?? supineCrunchMotion(frames) ?? flutterKickMotion(frames)
      ?? pairedKneeRotation(frames) ?? missingRaisedKnee(frames) : null;
}
