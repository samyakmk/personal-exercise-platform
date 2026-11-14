function measureArm(points, side) {
  const [shoulder, elbow, wrist, hip] = [5, 7, 9, 11].map((index) => points[index + side]);
  const torsoLength = Math.hypot(shoulder.x - hip.x, shoulder.y - hip.y);
  const upperArmLength = Math.hypot(shoulder.x - elbow.x, shoulder.y - elbow.y);
  if (Math.min(shoulder.confidence, elbow.confidence, hip.confidence) < 0.4
    || torsoLength < 45 || hip.y - shoulder.y < 25
    || upperArmLength < torsoLength * 0.23 || upperArmLength > torsoLength * 1.05) return null;
  const wristHeight = (shoulder.y - wrist.y) / torsoLength;
  const elbowHeight = (shoulder.y - elbow.y) / torsoLength;
  const forearmLength = Math.hypot(wrist.x - elbow.x, wrist.y - elbow.y);
  const normalizedForearm = forearmLength / torsoLength;
  const upperForearmDot = (shoulder.x - elbow.x) * (wrist.x - elbow.x) + (shoulder.y - elbow.y) * (wrist.y - elbow.y);
  const foldedOverhead = wrist.confidence > 0.3 && normalizedForearm > 0.22 && normalizedForearm < 0.95
    && elbowHeight > 0.28 && wristHeight - elbowHeight < 0.25
    && upperForearmDot / (upperArmLength * forearmLength) > -0.5;
  return {
    elbowHeight,
    wristHeight,
    wristConfidence: wrist.confidence,
    foldedOverhead,
  };
}

function pressBottoms(frames) {
  const bottoms = [];
  for (const [index, frame] of frames.entries()) {
    const before = frames.slice(Math.max(0, index - 4), index).filter((item) => frame.timestamp - item.timestamp <= 0.9);
    const after = frames.slice(index + 1, index + 5).filter((item) => item.timestamp - frame.timestamp <= 0.9);
    if (!before.length || !after.length) continue;
    const nearby = [...before, ...after];
    const height = frame.elbowHeight;
    const prominence = Math.min(Math.max(...before.map((item) => item.elbowHeight)),
      Math.max(...after.map((item) => item.elbowHeight))) - height;
    if (prominence < 0.035 || nearby.some((item) => item.elbowHeight < height)) continue;
    const previous = bottoms.at(-1);
    if (!previous || frame.timestamp - previous.timestamp >= 0.75) bottoms.push(frame);
    else if (height < previous.elbowHeight) bottoms[bottoms.length - 1] = frame;
  }
  return bottoms;
}

function splitStancePress(poses) {
  const frames = poses.flatMap(({ points, timestamp }) => {
    const [shoulder, otherShoulder, wrist, otherWrist, hip, otherHip, ankle, otherAnkle] = [5, 6, 9, 10, 11, 12, 15, 16]
      .map((id) => points[id]);
    if ([shoulder, otherShoulder, hip, otherHip, ankle, otherAnkle].some(({ confidence }) => confidence < 0.45)) return [];
    const shoulderY = (shoulder.y + otherShoulder.y) / 2;
    const hipY = (hip.y + otherHip.y) / 2;
    const torso = hipY - shoulderY;
    if (torso < 60) return [];
    return [{ timestamp, hipY, torso, spread: Math.abs(ankle.x - otherAnkle.x) / torso,
      stagger: Math.abs(ankle.y - otherAnkle.y) / torso,
      overhead: [wrist, otherWrist].every(({ y, confidence }) => confidence >= 0.35 && shoulderY - y >= 0.66 * torso) }];
  });
  for (const standing of frames) {
    if (standing.spread > 0.53 || standing.stagger > 0.18) continue;
    const pressed = frames.filter(({ timestamp, torso, hipY, spread, stagger, overhead }) =>
      timestamp >= standing.timestamp + 0.5 && timestamp <= standing.timestamp + 5
      && overhead && spread >= 0.82 && stagger >= 0.27 && hipY - standing.hipY >= 0.40 * torso);
    if (pressed.length >= 2 && pressed.at(-1).timestamp - pressed[0].timestamp >= 0.25) {
      return [standing.timestamp, pressed[0].timestamp, pressed.at(-1).timestamp];
    }
  }
  return null;
}

export function assessShoulderPress(poses) {
  const compound = splitStancePress(poses);
  if (compound) return { coverage: 'compound_press', evidence: [], verificationTimes: compound };
  const end = poses.at(-1)?.timestamp ?? 0;
  const working = poses.filter(({ timestamp }) => timestamp >= 1.5 && timestamp <= end - 0.75);
  const sides = [0, 1].map((side) => working.flatMap(({ timestamp, points }) => {
    const frame = measureArm(points, side);
    return frame ? [{ ...frame, timestamp }] : [];
  }));
  // Pick one arm for the window so an occlusion cannot swap the track between sides.
  const frames = sides.reduce((best, side) => side.length > best.length ? side : best);
  if (frames.length < Math.max(16, working.length * 0.32)) return { coverage: 'limited', evidence: [] };
  const folded = frames.filter((frame) => frame.foldedOverhead);
  if (folded.length >= 3 && folded.at(-1).timestamp - folded[0].timestamp >= 1.5) {
    return { coverage: 'ambiguous_motion', evidence: [], verificationTimes: folded.slice(-2).map(({ timestamp }) => timestamp) };
  }
  const bottoms = pressBottoms(frames);
  const hasOverheadPosition = frames.some((frame) => frame.wristConfidence >= 0.4 && frame.wristHeight > 0.85);
  if (!hasOverheadPosition || !bottoms.length) return { coverage: 'no_cycle', evidence: [] };
  const lowered = sides.some((side) => side.filter((frame) => frame.elbowHeight < -0.2).length >= 2);
  const short = bottoms.filter((frame) => frame.elbowHeight > 0.22 && frame.wristHeight > 0.7 && frame.wristConfidence >= 0.32);
  const repeated = short.length >= 2 && short.at(-1).timestamp - short[0].timestamp >= 1;
  const evidence = !lowered && repeated && short.length >= bottoms.length * 0.65;
  const lowest = evidence && short.reduce((best, frame) => frame.elbowHeight < best.elbowHeight ? frame : best);
  const second = lowest && short.find((frame) => Math.abs(frame.timestamp - lowest.timestamp) >= 1);
  const high = lowest && frames.filter((frame) => Math.abs(frame.timestamp - lowest.timestamp) <= 0.9
    && frame.elbowHeight >= lowest.elbowHeight + 0.06 && frame.wristConfidence >= 0.4)
    .sort((a, b) => b.elbowHeight - a.elbowHeight)[0];
  return {
    coverage: 'measured',
    evidence: lowest ? [{
      check: 'shoulder_press_short_descent',
      timestamp: lowest.timestamp,
      ...(high && { comparisonTimestamp: high.timestamp }),
      observation: 'In several visible repetitions, the dumbbell on the tracked side stays well above shoulder height at the bottom.',
      cue: 'For a fuller standing press, try lowering toward shoulder height before pressing up again, within a comfortable range.',
    }] : [],
    verificationTimes: [second, high].filter(Boolean).map(({ timestamp }) => timestamp),
  };
}
