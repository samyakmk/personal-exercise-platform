const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const average = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

function position({ timestamp, points }) {
  const joints = [5, 11, 13, 15].map((index) => points.slice(index, index + 2));
  if (joints.some((pair) => pair.some(({ confidence }) => confidence < 0.32))) return null;
  const [shoulder, hip, knee, ankle] = joints.map((pair) => average(...pair));
  const scale = distance(shoulder, hip);
  const direction = Math.sign(hip.x - shoulder.x);
  if (scale < 55 || (knee.x - hip.x) * direction < 0.20 * scale
    || Math.abs(ankle.x - knee.x) > 0.55 * scale || ankle.y - knee.y < 0.38 * scale
    || Math.abs(joints[3][0].y - joints[3][1].y) > 0.26 * scale
    || Math.abs(hip.x - shoulder.x) < 0.70 * scale) return null;
  const rise = (shoulder.y - hip.y) / scale;
  const offset = ((knee.x - shoulder.x) * (hip.y - shoulder.y) - (knee.y - shoulder.y) * (hip.x - shoulder.x))
    * direction / (distance(shoulder, knee) * scale);
  return { timestamp, shoulder, ankle, scale, rise, offset };
}

function highRuns(frames) {
  const runs = [];
  let run = [];
  for (const frame of frames) {
    if (!frame || frame.rise < 0.42 || frame.offset > -0.085
      || (run.length && frame.timestamp - run.at(-1).timestamp > 0.55)) {
      if (run.length >= 3) runs.push(run);
      run = [];
      if (!frame || frame.rise < 0.42 || frame.offset > -0.085) continue;
    }
    run.push(frame);
  }
  if (run.length >= 3) runs.push(run);
  return runs;
}

export function assessBridge(poses) {
  const series = poses.map(position);
  const frames = series.filter(Boolean);
  if (frames.length < 8 || frames.length < 0.60 * poses.length) return { coverage: 'limited', evidence: [] };
  const high = frames.reduce((best, frame) => frame.rise > best.rise ? frame : best);
  const low = frames.reduce((best, frame) => frame.rise < best.rise ? frame : best);
  const verificationTimes = [low.timestamp, high.timestamp];
  if (high.rise < 0.16) return { coverage: 'no_cycle', evidence: [], verificationTimes };

  const peaks = highRuns(series).map((run) => run.reduce((best, frame) => frame.offset < best.offset ? frame : best));
  for (const [index, first] of peaks.entries()) {
    const second = peaks.slice(index + 1).find((peak) => peak.timestamp - first.timestamp >= 1.0
      && distance(peak.shoulder, first.shoulder) < 0.20 * first.scale
      && distance(peak.ankle, first.ankle) < 0.20 * first.scale
      && frames.some(({ timestamp, rise }) => timestamp > first.timestamp && timestamp < peak.timestamp && rise < 0.22));
    if (second) return { coverage: 'measured', verificationTimes, evidence: [{
      check: 'glute_bridge_trunk_shift', timestamp: second.timestamp, comparisonTimestamp: first.timestamp,
      observation: 'Your hips rise above the shoulder-to-knee line at the top of more than one lift.',
      cue: 'Finish the lift at a comfortable height while keeping your ribs and pelvis steady.',
    }] };
  }
  return { coverage: 'measured', evidence: [], verificationTimes };
}
