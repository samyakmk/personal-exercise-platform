const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function angle(a, b, c) {
  const length = distance(a, b) * distance(c, b);
  if (length < 1) return NaN;
  const dot = (a.x - b.x) * (c.x - b.x) + (a.y - b.y) * (c.y - b.y);
  return Math.acos(Math.max(-1, Math.min(1, dot / length))) * 180 / Math.PI;
}

function measureSide(points, side) {
  const [shoulder, elbow, wrist, hip, knee, ankle] = [5, 7, 9, 11, 13, 15].map((index) => points[index + side]);
  const confidence = Math.min(shoulder.confidence, elbow.confidence, wrist.confidence, hip.confidence, knee.confidence, ankle.confidence);
  const length = distance(shoulder, ankle);
  const horizontal = ankle.x - shoulder.x;
  const direction = Math.sign(horizontal);
  const support = (wrist.y - shoulder.y) / length;
  const kneeAngle = angle(hip, knee, ankle);
  const elbowAngle = angle(shoulder, elbow, wrist);

  // Require a side view of a supported body with shoulder, hip, and ankle in order.
  if (!(confidence >= 0.42 && length >= 125 && Math.abs(horizontal) >= 0.8 * length
    && (hip.x - shoulder.x) * direction >= 0.19 * length && (ankle.x - hip.x) * direction >= 0.20 * length
    && support >= 0.045 && kneeAngle >= 138 && Number.isFinite(elbowAngle))) return null;

  const hipOffset = (horizontal * (hip.y - shoulder.y) - (ankle.y - shoulder.y) * (hip.x - shoulder.x)) * direction / length ** 2;
  return { confidence, elbowAngle, hipOffset, support };
}

function contiguousRuns(frames, matches) {
  const runs = [];
  let current = [];
  for (const frame of frames) {
    if (matches(frame)) current.push(frame);
    else if (current.length) {
      runs.push(current);
      current = [];
    }
  }
  if (current.length) runs.push(current);
  return runs;
}

function strongestRun(frames, matches, score, minFrames) {
  const candidates = contiguousRuns(frames, matches).filter((run) => run.length >= minFrames);
  const strongest = candidates.sort((a, b) => b.length - a.length)[0];
  return strongest?.reduce((best, frame) => score(frame) > score(best) ? frame : best);
}

function shallowDescent(frames) {
  const visible = frames.filter(Boolean);
  if (visible.length < 20 || visible.some((frame) => frame.support < 0.23)) return null;

  // Compare the lowest shoulder positions to nearby frames on both sides of the same rep.
  const lows = [];
  for (let index = 2; index < frames.length - 2; index += 1) {
    const before = frames[index - 2];
    const current = frames[index];
    const after = frames[index + 2];
    if (before && current && after && current.elbowAngle < 160
      && before.support >= current.support + 0.045 && after.support >= current.support + 0.045) lows.push(current);
  }
  const distinct = lows.filter((frame, index) => index === 0 || frame.timestamp - lows[index - 1].timestamp >= 0.75);
  if (distinct.length < 2) return null;
  return distinct.reduce((lowest, frame) => frame.support < lowest.support ? frame : lowest);
}

function supportedCycles(frames) {
  const smooth = frames.map((frame, index) => {
    if (!frame) return null;
    const adjacent = frames.slice(Math.max(0, index - 1), index + 2).filter(Boolean);
    if (adjacent.length < 2) return null;
    return {
      ...frame,
      support: adjacent.reduce((total, item) => total + item.support, 0) / adjacent.length,
      elbowAngle: adjacent.reduce((total, item) => total + item.elbowAngle, 0) / adjacent.length,
    };
  });
  const troughs = [];
  for (let index = 1; index < smooth.length - 1; index += 1) {
    const current = smooth[index];
    const previous = smooth[index - 1];
    const next = smooth[index + 1];
    if (!current || !previous || !next || current.support > previous.support || current.support >= next.support) continue;
    const before = smooth.slice(Math.max(0, index - 4), index).filter(Boolean);
    const after = smooth.slice(index + 1, index + 5).filter(Boolean);
    const prominence = Math.min(Math.max(...before.map((item) => item.support)), Math.max(...after.map((item) => item.support))) - current.support;
    if (prominence < 0.028) continue;
    const recent = troughs.at(-1);
    if (!recent || current.timestamp - recent.timestamp >= 0.75) troughs.push({ ...current, prominence });
    else if (prominence > recent.prominence) troughs[troughs.length - 1] = { ...current, prominence };
  }
  return troughs;
}

function limitedDescents(frames, cycles) {
  if (cycles.length < 2) return null;
  const ranked = [...cycles].sort((a, b) => a.support - b.support);
  if (ranked[Math.floor(ranked.length * 0.2)].support < 0.295 || ranked[0].support < 0.26) return null;
  const high = ranked.filter((frame) => frame.elbowAngle >= 125);
  const valid = frames.filter(Boolean);
  if (valid.length < 15 || high.length < Math.max(2, Math.ceil(cycles.length * 0.6))) return null;
  return high[0];
}

function raisedHips(frames) {
  const candidates = frames.filter((frame) => frame?.elbowAngle >= 145 && frame.hipOffset <= -0.07);
  // Exclude an isolated setup or dismount by requiring the raised position to recur.
  const repeated = candidates.filter((frame) => candidates.some((other) => Math.abs(other.timestamp - frame.timestamp) >= 1.5));
  if (repeated.length < 6 || !repeated.some((frame) => frame.hipOffset <= -0.10)) return null;
  const lastQuarter = frames.length * 0.75;
  const preferred = repeated.filter((frame) => frames.indexOf(frame) < lastQuarter);
  return (preferred.length ? preferred : repeated)
    .reduce((highest, frame) => frame.hipOffset < highest.hipOffset ? frame : highest);
}

function possibleIncline({ points }) {
  return [0, 1].map((side) => {
    const [shoulder, wrist, hip, ankle] = [5, 9, 11, 15].map((index) => points[index + side]);
    const length = distance(shoulder, ankle);
    if (Math.min(shoulder.confidence, wrist.confidence, hip.confidence, ankle.confidence) < 0.40 || length < 100) return false;
    // Perspective can shift image heights, so use the geometry only to withhold floor-specific cues.
    return ankle.y - wrist.y > 0.24 * length && ankle.y - shoulder.y > 0.48 * length
      && ankle.y > hip.y && distance(shoulder, wrist) < 0.48 * length;
  }).some(Boolean);
}

export function assessPushUp(poses) {
  const end = poses.at(-1)?.timestamp ?? 0;
  const initialTrim = end < 5 ? 0.25 : 1.5;
  const inWindow = ({ timestamp }) => timestamp >= initialTrim && timestamp < end - 0.5;
  const working = poses.filter(inWindow);
  const raised = working.filter(possibleIncline);
  if (raised.length >= Math.max(6, Math.ceil(working.length * 0.25))) {
    return { coverage: 'raised_support', evidence: [], verificationTimes: [raised[0].timestamp, raised.at(-1).timestamp] };
  }
  const frames = poses.map(({ timestamp, points }) => {
    if (!inWindow({ timestamp })) return null;
    const sides = [measureSide(points, 0), measureSide(points, 1)].filter(Boolean);
    const visible = sides.sort((a, b) => b.confidence - a.confidence)[0];
    return visible && { ...visible, timestamp };
  });
  const valid = frames.filter(Boolean);
  if (valid.length < 8) return { coverage: 'limited', evidence: [] };
  const cycles = supportedCycles(frames);
  const distinctBends = valid.filter((frame) => frame.elbowAngle < 148);
  const movingSupport = valid.filter((frame) => frame.support < 0.28 && frame.elbowAngle < 150);
  const highSupport = valid.filter((frame) => frame.support > 0.32 && frame.elbowAngle >= 145);
  const separatedPhases = movingSupport.length >= 3 && highSupport.length >= 3
    && movingSupport.some((low) => highSupport.some((high) => Math.abs(high.timestamp - low.timestamp) >= 0.5));
  const motion = (cycles.length >= 1 && (distinctBends.length >= 2 || cycles.length >= 2)) || separatedPhases;
  if (!motion) return { coverage: 'no_cycle', evidence: [] };

  const sag = strongestRun(frames, (frame) => frame?.elbowAngle >= 145 && frame.hipOffset >= 0.075, (frame) => frame.hipOffset, 4);
  const pike = raisedHips(frames);
  const shallow = shallowDescent(frames) ?? limitedDescents(frames, cycles);
  const evidence = [
    sag && {
      check: 'push_up_hip_sag',
      timestamp: sag.timestamp,
      observation: 'In this supported position, your hips appear below the line from shoulders to ankles.',
      cue: 'Brace your abs and glutes before lowering. Try to move your chest and hips together.',
    },
    pike && {
      check: 'push_up_raised_hips',
      timestamp: pike.timestamp,
      observation: 'In this supported position, your hips appear above the line from shoulders to ankles.',
      cue: 'Start with a long body line and keep the hips from rising ahead of the chest.',
    },
    shallow && {
      check: 'push_up_shallow_descent',
      timestamp: shallow.timestamp,
      observation: 'Several visible descents appear shallow relative to your top position.',
      cue: 'If you can keep your body aligned, try lowering a little farther before pressing back up.',
    },
  ].filter(Boolean);
  return { coverage: 'measured', evidence };
}

export function findPushUpEvidence(poses) {
  return assessPushUp(poses).evidence;
}
