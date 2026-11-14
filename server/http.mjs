export function preferredEncoding(header, supported) {
  const weights = new Map();
  for (const entry of (header ?? '').split(',')) {
    const [name, parameter] = entry.trim().toLowerCase().split(';');
    const weight = parameter?.trim().match(/^q=(0(?:\.\d{0,3})?|1(?:\.0{0,3})?|\.\d{1,3})$/);
    weights.set(name, parameter ? (weight ? Number(weight[1]) : 0) : 1);
  }
  const wildcard = weights.get('*') ?? 0;
  let selected = null;
  let highest = 0;
  for (const name of supported) {
    const quality = weights.get(name) ?? wildcard;
    if (quality > highest) {
      selected = name;
      highest = quality;
    }
  }
  return selected;
}

export function closeAfterResponse(req, res) {
  if (req.complete || res.getHeader('Connection') === 'close' ||
    (!req.headers['transfer-encoding'] && !(Number(req.headers['content-length']) > 0))) return;
  if (req.headers.expect?.toLowerCase() !== '100-continue') {
    const socket = req.socket;
    // Let an eager client receive the rejection while bounding how long it can retain the socket.
    req.resume();
    const timer = setTimeout(() => socket.destroy(), 250);
    timer.unref();
    const cancel = () => {
      clearTimeout(timer);
      req.off('end', cancel);
      socket.off('close', cancel);
    };
    req.once('end', cancel);
    socket.once('close', cancel);
    return;
  }
  res.setHeader('Connection', 'close');
}

export function expectRequestBody(req, res) {
  if (req.headers.expect?.toLowerCase() === '100-continue') res.writeContinue();
}
