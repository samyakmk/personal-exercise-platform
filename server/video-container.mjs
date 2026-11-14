const maxMetadataVisits = 32_768;
const maxTracks = 256;
const metadataLimit = Symbol('video metadata limit');

function* boxes(bytes, start, end, budget) {
  for (let offset = start; offset + 8 <= end;) {
    if (--budget.remaining < 0) throw metadataLimit;
    let length = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    let header = 8;
    if (length === 1) {
      if (offset + 16 > end || bytes.readUInt32BE(offset + 8) !== 0) return;
      length = bytes.readUInt32BE(offset + 12);
      header = 16;
    } else if (length === 0) {
      length = end - offset;
    }
    if (length < header || length > end - offset) return;
    yield { type, offset, start: offset + header, end: offset + length };
    offset += length;
  }
}

function child(bytes, parent, type, budget) {
  if (!parent) return undefined;
  for (const box of boxes(bytes, parent.start, parent.end, budget)) if (box.type === type) return box;
  return undefined;
}

function uint32(bytes, box, offset) {
  return box && box.end - box.start >= offset + 4 ? bytes.readUInt32BE(box.start + offset) : 0;
}

function classicSample(bytes, table, budget) {
  const sizes = child(bytes, table, 'stsz', budget) ?? child(bytes, table, 'stz2', budget);
  const count = uint32(bytes, sizes, 8);
  if (!count) return null;
  const fixedSize = uint32(bytes, sizes, 4);
  if (sizes.type === 'stsz' && !fixedSize && count > (sizes.end - sizes.start - 12) / 4) return null;
  if (sizes.type === 'stz2' && (![4, 8, 16].includes(fixedSize) || count > (sizes.end - sizes.start - 12) * 8 / fixedSize)) return null;
  const firstSize = sizes.type === 'stsz' ? fixedSize || uint32(bytes, sizes, 12)
    : fixedSize === 4 ? bytes[sizes.start + 12] >> 4 : bytes.readUIntBE(sizes.start + 12, fixedSize / 8);
  if (!firstSize) return null;
  const offsets = child(bytes, table, 'stco', budget) ?? child(bytes, table, 'co64', budget);
  const width = offsets?.type === 'co64' ? 8 : 4;
  const chunks = uint32(bytes, offsets, 4);
  if (!chunks || chunks > (offsets.end - offsets.start - 8) / width) return null;
  const position = offsets.start + 8;
  const start = width === 4 ? bytes.readUInt32BE(position) : Number(bytes.readBigUInt64BE(position));
  return Number.isSafeInteger(start) && start < bytes.length ? { start, size: firstSize } : null;
}

function fragmentSamples(bytes, fragment, videoTracks, defaultSizes, budget) {
  const samples = [];
  let trackCount = 0;
  for (const track of boxes(bytes, fragment.start, fragment.end, budget)) {
    if (track.type !== 'traf') continue;
    if (++trackCount > maxTracks) throw metadataLimit;
    const header = child(bytes, track, 'tfhd', budget);
    const id = uint32(bytes, header, 4);
    if (!videoTracks.has(id)) continue;
    const flags = uint32(bytes, header, 0);
    if (flags & 0x10000) continue;
    const baseField = flags & 1;
    const base = baseField && header.end - header.start >= 16 ? Number(bytes.readBigUInt64BE(header.start + 8))
      : !baseField && ((flags & 0x20000) || trackCount === 1) ? fragment.offset : null;
    const defaultSize = flags & 0x10
      ? uint32(bytes, header, 8 + (baseField ? 8 : 0) + (flags & 2 ? 4 : 0) + (flags & 8 ? 4 : 0))
      : defaultSizes.get(id) ?? 0;
    for (const run of boxes(bytes, track.start, track.end, budget)) {
      if (run.type !== 'trun') continue;
      const count = uint32(bytes, run, 4);
      const flags = uint32(bytes, run, 0);
      const fields = 8 + ((flags & 1) ? 4 : 0) + ((flags & 4) ? 4 : 0);
      const entryWidth = [0x100, 0x200, 0x400, 0x800].reduce((width, flag) => width + ((flags & flag) ? 4 : 0), 0);
      if (!count || count * entryWidth > run.end - run.start - fields) continue;
      const size = flags & 0x200 ? uint32(bytes, run, fields + (flags & 0x100 ? 4 : 0)) : defaultSize;
      if (!size) continue;
      const relativeOffset = flags & 1 ? bytes.readInt32BE(run.start + 8) : null;
      // A later run can inherit its position from earlier tracks or runs.
      // In that case only the minimum media size can be verified here.
      const start = relativeOffset !== null && base !== null ? base + relativeOffset
        : relativeOffset === null && baseField ? base : null;
      if (start !== null && (!Number.isSafeInteger(start) || start < 0 || start + size > bytes.length)) continue;
      samples.push({ start, size });
    }
  }
  return samples;
}

function mp4Video(bytes, quicktime, budget) {
  let header = false;
  let movie;
  for (const box of boxes(bytes, 0, bytes.length, budget)) {
    if (box.type === 'ftyp' && box.end - box.start >= 8) header = true;
    if (box.type === 'moov') movie = box;
  }
  if ((!header && !quicktime) || !movie) return false;
  const samples = [];
  const videoTracks = new Set();
  const defaultSizes = new Map();
  const defaults = child(bytes, movie, 'mvex', budget);
  if (defaults) {
    for (const item of boxes(bytes, defaults.start, defaults.end, budget)) {
      if (item.type !== 'trex') continue;
      if (defaultSizes.size >= maxTracks) return false;
      defaultSizes.set(uint32(bytes, item, 4), uint32(bytes, item, 16));
    }
  }
  let trackCount = 0;
  for (const track of boxes(bytes, movie.start, movie.end, budget)) {
    if (track.type !== 'trak') continue;
    if (++trackCount > maxTracks) return false;
    const media = child(bytes, track, 'mdia', budget);
    const handler = child(bytes, media, 'hdlr', budget);
    if (uint32(bytes, handler, 8) !== 0x76696465) continue; // 'vide'
    const table = child(bytes, child(bytes, media, 'minf', budget), 'stbl', budget);
    const description = child(bytes, table, 'stsd', budget);
    if (!uint32(bytes, description, 4)) continue;
    const sampleEntry = boxes(bytes, description.start + 8, description.end, budget).next().value;
    if (!sampleEntry || sampleEntry.end - sampleEntry.start < 78) continue;
    const sample = classicSample(bytes, table, budget);
    if (sample) samples.push(sample);
    const trackHeader = child(bytes, track, 'tkhd', budget);
    const trackId = uint32(bytes, trackHeader, bytes[trackHeader?.start] === 1 ? 20 : 12);
    if (trackId) videoTracks.add(trackId);
  }
  if (!videoTracks.size && !samples.length) return false;
  let fragment = [];
  let sampleIndex = 0;
  samples.sort((left, right) => left.start - right.start);
  for (const box of boxes(bytes, 0, bytes.length, budget)) {
    if (box.type === 'moof') fragment = fragmentSamples(bytes, box, videoTracks, defaultSizes, budget);
    if (box.type !== 'mdat' || box.end <= box.start) continue;
    if (fragment.some(({ start, size }) => (start ?? box.start) >= box.start && (start ?? box.start) + size <= box.end)) return true;
    fragment = fragment.filter(({ start }) => start !== null && start >= box.end);
    while (samples[sampleIndex]?.start < box.end) {
      const { start, size } = samples[sampleIndex++];
      if (start >= box.start && start + size <= box.end) return true;
    }
  }
  return false;
}

function variable(bytes, start, end, identifier) {
  if (start >= end) return null;
  const first = bytes[start];
  if (!first) return null;
  const length = Math.clz32(first) - 23;
  if (start + length > end || (identifier && length > 4)) return null;
  const marker = 1 << (8 - length);
  let value = identifier ? first : first - marker;
  let unknown = value === marker - 1;
  for (let offset = start + 1; offset < start + length; offset += 1) {
    value = value * 256 + bytes[offset];
    unknown &&= bytes[offset] === 255;
  }
  return { length, value: !identifier && unknown ? null : value };
}

const segmentElements = new Set([0x1f43b675, 0x1654ae6b, 0x1c53bb6b, 0x1549a966, 0x114d9b74, 0x1941a469, 0x1043a770, 0x1254c367]);

function* elements(bytes, start, end, budget, level) {
  for (let offset = start; offset < end;) {
    if (--budget.remaining < 0) throw metadataLimit;
    const id = variable(bytes, offset, end, true);
    if (!id) return;
    if (level === 'cluster' && segmentElements.has(id.value)) {
      yield { id: id.value, offset };
      return;
    }
    const size = variable(bytes, offset + id.length, end, false);
    if (!size) return;
    const data = offset + id.length + size.length;
    const unknownCluster = level === 'segment' && id.value === 0x1f43b675 && size.value === null;
    if (size.value === null && id.value !== 0x18538067 && !unknownCluster) return;
    let next = size.value === null ? end : data + size.value;
    if (next > end) return;
    yield { id: id.value, offset, start: data, end: next, unknownCluster };
    // Live recorders can end an unknown-size Cluster by starting another segment-level element.
    if (unknownCluster) {
      for (const part of elements(bytes, data, end, budget, 'cluster')) {
        if (!segmentElements.has(part.id)) continue;
        next = part.offset;
        break;
      }
    }
    offset = next;
  }
}

function videoBlock(bytes, block, tracks) {
  const track = variable(bytes, block.start, block.end, false);
  return track && tracks.has(track.value) && block.end - block.start > track.length + 3;
}

function segmentVideo(bytes, segment, budget) {
  const tracks = new Set();
  let trackCount = 0;
  for (const part of elements(bytes, segment.start, segment.end, budget, 'segment')) {
    if (part.id !== 0x1654ae6b) continue;
    for (const track of elements(bytes, part.start, part.end, budget)) {
      if (track.id !== 0xae) continue;
      if (++trackCount > maxTracks) throw metadataLimit;
      let number = 0;
      let video = false;
      let codec = false;
      for (const { id, start, end } of elements(bytes, track.start, track.end, budget)) {
        if (id === 0xd7 && end > start && end - start <= 6) number = bytes.readUIntBE(start, end - start);
        if (id === 0x83 && end - start === 1) video = bytes[start] === 1;
        if (id === 0x86 && end - start >= 3) codec = bytes.toString('ascii', start, start + 2) === 'V_';
      }
      if (number && video && codec) tracks.add(number);
    }
    if (tracks.size) break;
  }
  if (!tracks.size) return false;
  for (const part of elements(bytes, segment.start, segment.end, budget, 'segment')) {
    if (part.id === 0x1f43b675) {
      for (const block of elements(bytes, part.start, part.end, budget, part.unknownCluster ? 'cluster' : undefined)) {
        if (block.id === 0xa3 && videoBlock(bytes, block, tracks)) return true;
        if (block.id === 0xa0) {
          for (const item of elements(bytes, block.start, block.end, budget)) {
            if (item.id === 0xa1 && videoBlock(bytes, item, tracks)) return true;
          }
        }
      }
    }
  }
  return false;
}

function webmVideo(bytes, budget) {
  const top = elements(bytes, 0, bytes.length, budget);
  const header = top.next().value;
  if (header?.id !== 0x1a45dfa3) return false;
  let isWebm = false;
  for (const { id, start, end } of elements(bytes, header.start, header.end, budget)) {
    if (id === 0x4282 && end - start === 4 && bytes.toString('ascii', start, end) === 'webm') isWebm = true;
  }
  if (!isWebm) return false;
  for (const segment of top) {
    if (segment.id === 0x18538067 && segmentVideo(bytes, segment, budget)) return true;
  }
  return false;
}

export function hasVideoTrack(mime, bytes) {
  // Count metadata visits across all passes while skipping entire encoded media payloads.
  const budget = { remaining: maxMetadataVisits };
  try {
    return mime === 'video/webm' ? webmVideo(bytes, budget) : mp4Video(bytes, mime === 'video/quicktime', budget);
  } catch (error) {
    if (error === metadataLimit) return false;
    throw error;
  }
}
