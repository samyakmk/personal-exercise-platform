const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

function elbowCosine(shoulder, elbow, wrist) {
  const upper = distance(shoulder, elbow);
  const lower = distance(elbow, wrist);
  return upper > 0 && lower > 0
    ? ((shoulder.x - elbow.x) * (wrist.x - elbow.x) + (shoulder.y - elbow.y) * (wrist.y - elbow.y)) / (upper * lower)
    : NaN;
}

function rowPositions(poses, side) {
  return poses.flatMap(({ points, timestamp }) => {
    const [shoulder, elbow, wrist, hip] = [5, 7, 9, 11].map((index) => points[index + side]);
    const [support, supportElbow, supportWrist, otherHip] = [5, 7, 9, 11].map((index) => points[index + 1 - side]);
    if ([shoulder, support, elbow, supportElbow, supportWrist, hip, otherHip].some(({ confidence }) => confidence < 0.34)
      || wrist.confidence < 0.25 || elbowCosine(support, supportElbow, supportWrist) > -0.83) return [];
    const shoulders = midpoint(shoulder, support);
    const hips = midpoint(hip, otherHip);
    const scale = distance(shoulders, hips);
    const reach = (wrist.y - supportWrist.y) / scale;
    const bend = elbowCosine(shoulder, elbow, wrist);
    if (scale < 70 || Math.abs(shoulders.x - hips.x) < 0.65 * scale || !Number.isFinite(bend)) return [];
    return [{ timestamp, reach, bend, rotation: (support.y - shoulder.y) / scale,
      pitch: (hips.y - shoulders.y) / scale }];
  });
}

function repeatedTurn(positions) {
  const peaks = [];
  for (const low of positions) {
    if (low.bend > -0.72 || low.reach < 0.14) continue;
    const high = positions.find((frame) => frame.timestamp >= low.timestamp + 0.5 && frame.timestamp <= low.timestamp + 1.65
      && frame.bend >= -0.22 && frame.reach <= -0.78 && frame.rotation >= 0.58
      && frame.rotation - low.rotation >= 0.62 && frame.pitch - low.pitch >= 0.21);
    if (high && (!peaks.length || high.timestamp - peaks.at(-1).high.timestamp >= 0.9)) peaks.push({ low, high });
  }
  return peaks;
}

export function assessRow(poses) {
  const sides = [0, 1].map((side) => rowPositions(poses, side));
  const [left, right] = sides;
  const positions = left.length >= right.length ? left : right;
  if (positions.length < 8) return { coverage: 'limited', evidence: [] };
  const low = positions.reduce((a, b) => a.reach > b.reach ? a : b);
  const high = positions.reduce((a, b) => a.reach < b.reach ? a : b);
  const verificationTimes = [low.timestamp, high.timestamp];
  if (low.reach - high.reach < 0.20) return { coverage: 'no_cycle', evidence: [], verificationTimes };
  const [first, second] = repeatedTurn(positions);
  if (!second) return { coverage: 'measured', evidence: [], verificationTimes };
  return { coverage: 'measured', verificationTimes: [first.high.timestamp, second.high.timestamp], evidence: [{
    check: 'dumbbell_row_trunk_turn', timestamp: second.high.timestamp, comparisonTimestamp: second.low.timestamp,
    observation: 'Your working shoulder and chest turn upward as you pull on more than one visible rep.',
    cue: 'Keep your chest facing the floor and pull your elbow toward your hip. Shorten the pull if needed to keep your torso steady.',
  }] };
}
