const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const sides = [0, 1];

function kneeAngle(hip, knee, ankle, thigh, shin) {
  const cosine = ((hip.x - knee.x) * (ankle.x - knee.x) + (hip.y - knee.y) * (ankle.y - knee.y)) / (thigh * shin);
  return Math.acos(Math.max(-1, Math.min(1, cosine))) * 180 / Math.PI;
}

function sideMeasurement(points, side) {
  const [shoulder, hip, knee, ankle] = [5, 11, 13, 15].map((index) => points[index + side]);
  const confidence = Math.min(shoulder.confidence, hip.confidence, knee.confidence, ankle.confidence);
  const thigh = distance(hip, knee);
  const shin = distance(knee, ankle);
  const torso = distance(shoulder, hip);
  const ratio = thigh / shin;
  if (!(confidence >= 0.42 && ratio > 0.45 && ratio < 1.65 && torso >= 35
    && hip.y - shoulder.y > 0.25 * torso && thigh >= 22 && shin >= 22)) return null;
  const oppositeHip = points[12 - side];
  if (oppositeHip.confidence >= 0.50 && Math.abs(hip.x - oppositeHip.x) > 0.75 * thigh) return null;
  return {
    kneeAngle: kneeAngle(hip, knee, ankle, thigh, shin),
    hipHeight: (ankle.y - hip.y) / (thigh + shin),
    thighSlope: (knee.y - hip.y) / thigh,
  };
}

function squatBottoms(frames) {
  const bottoms = [];
  for (let index = 2; index < frames.length - 2; index += 1) {
    const bottom = frames[index];
    const previous = frames[index - 1];
    const next = frames[index + 1];
    if (!bottom || !previous || !next || bottom.hipHeight >= previous.hipHeight
      || bottom.hipHeight > next.hipHeight || bottom.kneeAngle > 126) continue;
    const before = frames.slice(Math.max(0, index - 6), index - 1).filter(Boolean);
    const after = frames.slice(index + 2, index + 7).filter(Boolean);
    const prominence = Math.min(Math.max(...before.map((frame) => frame.hipHeight)),
      Math.max(...after.map((frame) => frame.hipHeight))) - bottom.hipHeight;
    if (prominence < 0.14) continue;
    const last = bottoms.at(-1);
    if (!last || bottom.timestamp - last.timestamp >= 0.9) bottoms.push(bottom);
    else if (bottom.hipHeight < last.hipHeight) bottoms[bottoms.length - 1] = bottom;
  }
  return bottoms;
}

function frontalFrame(points) {
  const [leftShoulder, rightShoulder, leftHip, rightHip, leftKnee, rightKnee] =
    [5, 6, 11, 12, 13, 14].map((id) => points[id]);
  if (Math.min(leftShoulder.confidence, rightShoulder.confidence, leftHip.confidence, rightHip.confidence,
    leftKnee.confidence, rightKnee.confidence) < 0.35) return false;
  const torso = (distance(leftShoulder, leftHip) + distance(rightShoulder, rightHip)) / 2;
  if (torso < 35) return false;
  const left = (leftKnee.x - leftHip.x) / torso;
  const right = (rightKnee.x - rightHip.x) / torso;
  // A frontal camera can project the knees outward in opposite directions.
  return left * right < 0 && Math.abs((left + right) / 2) < 0.18 && Math.max(Math.abs(left), Math.abs(right)) > 0.16;
}

function hasFrontalView(poses) {
  const visible = poses.flatMap(({ points }) => {
    const [leftShoulder, rightShoulder, leftHip, rightHip, leftAnkle, rightAnkle] = [5, 6, 11, 12, 15, 16].map((id) => points[id]);
    if (Math.min(leftShoulder.confidence, rightShoulder.confidence, leftHip.confidence, rightHip.confidence,
      leftAnkle.confidence, rightAnkle.confidence) < 0.39) return [];
    const torso = (distance(leftShoulder, leftHip) + distance(rightShoulder, rightHip)) / 2;
    if (torso < 35) return [];
    return [Math.abs(leftAnkle.x - rightAnkle.x) > 0.85 * torso && Math.abs(leftAnkle.y - rightAnkle.y) < 0.18 * torso
      && Math.abs(leftShoulder.x - rightShoulder.x) > 0.65 * torso && Math.abs(leftShoulder.y - rightShoulder.y) < 0.20 * torso];
  });
  return visible.length >= 8 && visible.filter(Boolean).length >= Math.ceil(visible.length * 0.5);
}

function possibleDeeperRep(points, side) {
  const [hip, knee, ankle] = [11, 13, 15].map((index) => points[index + side]);
  const thigh = distance(hip, knee);
  const shin = distance(knee, ankle);
  return Math.min(hip.confidence, knee.confidence, ankle.confidence) >= 0.55 && thigh >= 22 && shin >= 22
    && (knee.y - hip.y) / thigh <= 0.55 && kneeAngle(hip, knee, ankle, thigh, shin) <= 92;
}

export function assessSquat(poses) {
  if (hasFrontalView(poses)) return { coverage: 'limited', evidence: [] };
  const end = poses.at(-1)?.timestamp ?? 0;
  // Keep each leg's measurements together. Switching sides mid-rep can hide a
  // real bottom or create an artificial one.
  const tracks = sides.map((side) => {
    const frames = poses.map(({ timestamp, points }) => {
      if (timestamp < 0.5 || timestamp > end - 0.25) return null;
      const measurement = frontalFrame(points) ? null : sideMeasurement(points, side);
      return measurement && { ...measurement, timestamp };
    });
    const valid = frames.filter(Boolean);
    return { valid, bottoms: valid.length >= 12 ? squatBottoms(frames) : [] };
  });
  const usable = tracks.filter(({ valid }) => valid.length >= 12);
  if (!usable.length) return { coverage: 'limited', evidence: [] };
  const valid = usable.flatMap((track) => track.valid);
  const bottoms = usable.sort((a, b) => b.bottoms.length - a.bottoms.length || b.valid.length - a.valid.length)[0].bottoms;
  if (!bottoms.length) return { coverage: 'no_cycle', evidence: [] };

  // A single deeper sample can suppress a range cue, even if the shoulder
  // was obscured and the frame could not be used to track a full repetition.
  const shallow = bottoms.filter((bottom) => bottom.kneeAngle >= 90 && bottom.thighSlope >= 0.5);
  const deeper = valid.some((frame) => frame.kneeAngle < 85 && frame.thighSlope < 0.35)
    || poses.some(({ timestamp, points }) => timestamp >= bottoms[0].timestamp - 0.75
      && timestamp <= bottoms.at(-1).timestamp + 0.75 && sides.some((side) => possibleDeeperRep(points, side)));
  const enough = shallow.length >= 2 && shallow.length >= bottoms.length * 0.7 && !deeper;
  const frame = enough && shallow.reduce((best, item) => item.thighSlope < best.thighSlope ? item : best);
  return {
    coverage: 'measured',
    verificationTimes: [bottoms[0].timestamp, bottoms.at(-1).timestamp],
    evidence: frame ? [{
      check: 'squat_short_depth',
      timestamp: frame.timestamp,
      comparisonTimestamp: shallow.find((item) => item !== frame).timestamp,
      observation: 'At several visible low points, your hips stay well above your knees.',
      cue: 'If a deeper squat is your goal, try lowering a little farther while keeping both feet planted.',
    }] : [],
  };
}
