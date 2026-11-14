const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function armPosition(points, side) {
  const [shoulder, elbow, wrist] = [5, 7, 9].map((index) => points[index + side]);
  const upper = distance(shoulder, elbow);
  const forearm = distance(elbow, wrist);
  const arm = upper + forearm;
  if (Math.min(shoulder.confidence, elbow.confidence, wrist.confidence) < 0.44 || upper * forearm <= 1
    || arm < 95 || wrist.y > elbow.y + 0.12 * arm || distance(points[5], points[6]) < 0.22 * arm) return null;
  const dot = (shoulder.x - elbow.x) * (wrist.x - elbow.x) + (shoulder.y - elbow.y) * (wrist.y - elbow.y);
  const angle = Math.acos(Math.max(-1, Math.min(1, dot / (upper * forearm)))) * 180 / Math.PI;
  return { angle, wrist, arm, drop: (shoulder.y - wrist.y) / arm };
}

function lowReversals(frames) {
  const smooth = frames.map((frame, index) => {
    if (!frame) return null;
    const nearby = frames.slice(Math.max(0, index - 1), index + 2).filter(Boolean);
    return { ...frame, smoothedDrop: nearby.reduce((sum, item) => sum + item.drop, 0) / nearby.length };
  });
  const lows = [];
  for (let index = 2; index < frames.length - 2; index += 1) {
    const center = smooth[index];
    if (!center || center.smoothedDrop < 0.58 || center.timestamp - (lows.at(-1)?.low.timestamp ?? -Infinity) < 1.05) continue;
    if (smooth.slice(index - 2, index + 3).some((frame) => frame?.smoothedDrop > center.smoothedDrop)) continue;
    const nearTop = (frame) => frame && frame.angle <= 95 && frame.drop <= center.drop - 0.24;
    const before = smooth.slice(Math.max(0, index - 8), index - 1).findLast(nearTop);
    const after = smooth.slice(index + 2, index + 9).find(nearTop);
    if (!before || !after) continue;
    const nearby = frames.slice(index - 2, index + 3).filter((frame) => frame && Math.abs(frame.drop - center.drop) <= 0.16);
    if (nearby.length < 2) continue;
    const low = nearby.reduce((mostExtended, frame) => frame.angle > mostExtended.angle ? frame : mostExtended);
    if ([before, after].some((top) => distance(top.wrist, low.wrist) > 0.34 * low.arm)) continue;
    lows.push({ low, before, after });
  }
  return lows;
}

function swingCheck(poses, side) {
  const frames = poses.flatMap(({ timestamp, points }) => {
    const [shoulder, wrist, hip, ankle] = [5, 9, 11, 15].map((index) => points[index + side]);
    const torso = distance(shoulder, hip);
    if (torso < 65 || Math.min(shoulder.confidence, hip.confidence, ankle.confidence) < 0.44
      || wrist.confidence < 0.35 || wrist.y > shoulder.y + torso * 0.2) return [];
    return [{ timestamp, offset: (ankle.x - hip.x) / torso, handHeight: (shoulder.y - wrist.y) / torso }];
  });
  const swings = [];
  for (const start of frames) {
    if (start.handHeight < 0.42) continue;
    for (const end of frames) {
      const gap = end.timestamp - start.timestamp;
      if (gap >= 0.25 && gap <= 1 && Math.abs(start.handHeight - end.handHeight) >= 0.12
        && Math.abs(end.offset - start.offset) >= 0.64) swings.push({ start, end });
    }
  }
  for (const first of swings) {
    const second = swings.find(({ start }) => start.timestamp >= first.end.timestamp + 0.25);
    if (second) return { first, second };
  }
  return null;
}

function bentArmHold(frames) {
  const visible = frames.filter(Boolean);
  if (visible.length < 8 || visible.length < 0.75 * frames.length) return null;
  const low = visible.reduce((a, b) => a.drop < b.drop ? a : b);
  const high = visible.reduce((a, b) => a.drop > b.drop ? a : b);
  const bent = visible.filter(({ angle, drop }) => angle <= 88 && drop >= 0.14 && drop <= 0.52);
  return bent.length >= 0.85 * visible.length && high.drop - low.drop <= 0.18
    ? [high.timestamp, low.timestamp] : null;
}

export function assessPullUp(poses) {
  const duration = (poses.at(-1)?.timestamp ?? 0) - (poses[0]?.timestamp ?? 0);
  const sides = [0, 1].map((side) => poses.map(({ timestamp, points }) => {
    const arm = armPosition(points, side);
    return arm && { ...arm, timestamp };
  }));
  const overhead = sides.flat().filter((frame) => frame?.drop >= 0.5);
  if (overhead.length >= 4 && overhead.every(({ wrist, arm }) => wrist.y <= arm * 0.04)) {
    return { coverage: 'bar_at_edge', evidence: [] };
  }
  if (duration < 1.75 && overhead.length) return { coverage: 'short_window', evidence: [] };
  const holds = sides.map(bentArmHold);
  if (holds.every(Boolean)) return { coverage: 'no_cycle', evidence: [], verificationTimes: [...new Set(holds.flat())] };
  for (const side of [0, 1]) {
    const swing = swingCheck(poses, side);
    if (swing) return {
      coverage: 'measured', verificationTimes: [swing.second.start.timestamp, swing.second.end.timestamp],
      evidence: [{
        check: 'pull_up_repeated_swing', timestamp: swing.first.end.timestamp, comparisonTimestamp: swing.first.start.timestamp,
        observation: 'Your visible leg position swings noticeably during more than one pull.',
        cue: 'Start from a steadier hang and let your arms and back lead the pull.',
      }],
    };
  }
  let measured = false;
  for (const frames of sides) {
    const visible = frames.filter(Boolean);
    if (visible.length < 8) continue;
    measured = true;
    if (visible.some(({ angle, drop }) => angle >= 156 && drop >= 0.8)) continue;
    const low = lowReversals(frames);
    if (low.length < 2 || low.some(({ low }) => low.angle > 144)) continue;
    return {
      coverage: 'measured',
      verificationTimes: [low[0].before.timestamp, low[0].low.timestamp, low.at(-1).after.timestamp],
      evidence: [{
        check: 'pull_up_short_bottom', timestamp: low[1].low.timestamp, comparisonTimestamp: low[1].after.timestamp,
        observation: 'The visible elbow remains bent as you reverse from lowering into the next pull in several reps.',
        cue: 'Lower until the visible arm is comfortably straight before starting the next pull.',
      }],
    };
  }
  // Quick repeats need more closely spaced samples to show the body swing on both sides of a pull.
  const verificationTimes = duration >= 2 && duration < 4
    ? poses.filter((_, index) => index % 2 === 0).map(({ timestamp }) => timestamp) : [];
  return { coverage: measured ? 'measured' : 'limited', evidence: [], ...(verificationTimes.length && { verificationTimes }) };
}
