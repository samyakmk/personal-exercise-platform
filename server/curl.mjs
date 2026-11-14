function measure(points) {
  return [0, 1].map((side) => {
    const [shoulder, elbow, wrist, hip] = [5, 7, 9, 11].map((index) => points[index + side]);
    const torso = Math.hypot(shoulder.x - hip.x, shoulder.y - hip.y);
    const tilt = Math.atan2(shoulder.x - hip.x, hip.y - shoulder.y) * 180 / Math.PI;
    const upper = Math.atan2(elbow.x - shoulder.x, elbow.y - shoulder.y) * 180 / Math.PI;
    const length = Math.hypot(shoulder.x - elbow.x, shoulder.y - elbow.y) * Math.hypot(wrist.x - elbow.x, wrist.y - elbow.y);
    const dot = (shoulder.x - elbow.x) * (wrist.x - elbow.x) + (shoulder.y - elbow.y) * (wrist.y - elbow.y);
    const bend = length > 1 ? Math.acos(Math.max(-1, Math.min(1, dot / length))) * 180 / Math.PI : NaN;
    return { hip, torso, tilt, upper, bend, torsoConfidence: Math.min(shoulder.confidence, hip.confidence),
      armConfidence: Math.min(shoulder.confidence, elbow.confidence, wrist.confidence) };
  });
}

function repetitions(frames, side) {
  const pairs = [];
  for (const low of frames) {
    const { bend, armConfidence } = low.sides[side];
    if (!(bend >= 142 && armConfidence >= 0.35 && Math.abs(low.tilt) >= 12 && Math.abs(low.tilt) <= 38)) continue;
    for (const high of frames) {
      const duration = high.timestamp - low.timestamp;
      if (duration < 0.5 || duration > 1.35 || Math.abs(high.tilt) > 9) continue;
      const start = low.sides[side];
      const finish = high.sides[side];
      const difference = Math.abs(low.tilt - high.tilt);
      const consistent = low.sides.every((from, index) => {
        const to = high.sides[index];
        return (from.tilt - to.tilt) * Math.sign(low.tilt - high.tilt) >= 7
          && Math.abs(from.torso - to.torso) <= from.torso * 0.24;
      });
      if (difference >= 12 && consistent && finish.bend <= 117 && finish.armConfidence >= 0.26 && Math.abs(finish.upper) <= 47
        && Math.hypot(start.hip.x - finish.hip.x, start.hip.y - finish.hip.y) <= start.torso * 0.32) {
        pairs.push({ low: low.timestamp, high: high.timestamp, difference, direction: Math.sign(low.tilt) });
      }
    }
  }
  return pairs.sort((a, b) => b.difference - a.difference);
}

export function assessCurl(poses) {
  const end = poses.at(-1)?.timestamp ?? 0;
  const frames = poses.flatMap(({ timestamp, points }) => {
    if (timestamp < 1 || timestamp > end - 0.75) return [];
    const sides = measure(points);
    if (sides.some(({ torso, torsoConfidence }) => torso < 44 || torsoConfidence < 0.48)
      || Math.abs(sides[0].tilt - sides[1].tilt) > 12) return [];
    return [{ timestamp, sides, tilt: (sides[0].tilt + sides[1].tilt) / 2 }];
  });
  // Compare the same arm and require both torso tracks to move similarly on two distinct lifts.
  for (const side of [0, 1]) {
    const pairs = repetitions(frames, side);
    for (const first of pairs) {
      const another = pairs.find((pair) => pair.direction === first.direction
        && Math.abs(pair.low - first.low) >= 1.2 && Math.abs(pair.high - first.high) >= 1.2
        && (pair.low >= first.high || first.low >= pair.high));
      if (!another) continue;
      return {
        coverage: 'measured', verificationTimes: [another.low, another.high],
        evidence: [{
          check: 'curl_torso_rocking', timestamp: first.high, comparisonTimestamp: first.low,
          observation: 'Your torso shifts noticeably as you lift the dumbbell in more than one visible rep.',
          cue: 'Start tall and keep your torso steady as you bend your elbow. Try a lighter dumbbell if you need momentum to lift.',
        }],
      };
    }
  }
  return { coverage: frames.length >= 8 ? 'measured' : 'limited', evidence: [] };
}
