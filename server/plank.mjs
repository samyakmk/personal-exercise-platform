const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function measure(points, side) {
  const [shoulder, elbow, wrist, hip, knee, ankle] = [5, 7, 9, 11, 13, 15].map((index) => points[index + side]);
  const length = distance(shoulder, ankle);
  if (Math.min(elbow.confidence, hip.confidence, knee.confidence, ankle.confidence) < 0.42
    || Math.min(shoulder.confidence, wrist.confidence) < 0.36
    || length < 115) return null;
  const horizontal = ankle.x - shoulder.x;
  const direction = Math.sign(horizontal);
  const thigh = distance(hip, knee);
  const shin = distance(knee, ankle);
  const arm = distance(shoulder, elbow);
  const kneeCosine = ((hip.x - knee.x) * (ankle.x - knee.x) + (hip.y - knee.y) * (ankle.y - knee.y)) / (thigh * shin);
  if (Math.abs(horizontal) < 0.83 * length || kneeCosine > -0.72 || thigh < 0.14 * length || shin < 0.14 * length
    || (hip.x - shoulder.x) * direction < 0.21 * length || (ankle.x - hip.x) * direction < 0.22 * length
    // A diagonal camera can project a floor-supported forearm at a visible slope.
    || elbow.y - shoulder.y < 0.1 * length || Math.abs(wrist.y - elbow.y) > 0.15 * length
    || arm > 0.39 * length || Math.abs(wrist.x - elbow.x) < 0.065 * length) return null;
  const hipOffset = (horizontal * (hip.y - shoulder.y) - (ankle.y - shoulder.y) * (hip.x - shoulder.x)) * direction / length ** 2;
  return { hipOffset, elbow, ankle, length };
}

function sameHold(previous, current) {
  const scale = Math.min(previous.length, current.length);
  return current.timestamp - previous.timestamp <= 0.55 && Math.abs(previous.length - current.length) <= scale * 0.13
    && distance(previous.elbow, current.elbow) <= scale * 0.10 && distance(previous.ankle, current.ankle) <= scale * 0.10;
}

function holdRuns(frames) {
  const runs = [];
  let run = [];
  for (const frame of frames) {
    if (run.length && !sameHold(run.at(-1), frame)) {
      runs.push(run);
      run = [];
    }
    run.push(frame);
  }
  if (run.length) runs.push(run);
  return runs.filter((items) => items.length >= 6 && items.at(-1).timestamp - items[0].timestamp >= 1.25);
}

export function assessPlank(poses) {
  // Follow one side through the hold to keep mirrored views and occlusion from swapping tracks.
  const runs = [0, 1].flatMap((side) => holdRuns(poses.flatMap(({ timestamp, points }) => {
    const frame = measure(points, side);
    return frame ? [{ ...frame, timestamp }] : [];
  })));
  const hold = runs.sort((a, b) => b.length - a.length)[0];
  if (!hold) return { coverage: 'limited', evidence: [] };
  const anchors = [hold[Math.floor(hold.length * 0.25)], hold[Math.floor(hold.length * 0.75)]];
  const fault = [['plank_hip_sag', 1], ['plank_raised_hips', -1]].map(([check, direction]) => ({
    check, direction, frames: hold.filter(({ hipOffset }) => direction * hipOffset >= 0.078),
  })).find(({ frames }) => frames.length >= Math.max(6, Math.ceil(hold.length * 0.65))
    && frames.at(-1).timestamp - frames[0].timestamp >= 1.25);
  const verificationTimes = anchors.map(({ timestamp }) => timestamp);
  if (!fault) return { coverage: 'measured', evidence: [], verificationTimes };
  const first = fault.frames[0];
  const last = fault.frames.at(-1);
  const sag = fault.direction === 1;
  return {
    coverage: 'measured', verificationTimes,
    evidence: [{
      check: fault.check, timestamp: last.timestamp, comparisonTimestamp: first.timestamp,
      observation: `Your hips appear ${sag ? 'below' : 'above'} the shoulder-to-ankle line in several visible moments of the hold.`,
      cue: sag ? 'Brace your abdomen and lift your hips slightly so your shoulders, hips, and heels line up.'
        : 'Lower your hips slightly while keeping your abdomen braced and your forearms planted.',
    }],
  };
}
