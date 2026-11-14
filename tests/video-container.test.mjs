import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { hasVideoTrack } from '../server/video-container.mjs';

const fixture = (name) => readFile(new URL('./fixtures/' + name, import.meta.url));

function box(type, payload = Buffer.alloc(0)) {
  const bytes = Buffer.alloc(8 + payload.length);
  bytes.writeUInt32BE(bytes.length);
  bytes.write(type, 4);
  payload.copy(bytes, 8);
  return bytes;
}

test('MP4 and QuickTime need video samples and accept classic and fragmented recordings', async () => {
  const handler = Buffer.alloc(12);
  handler.write('vide', 8);
  const fake = Buffer.concat([
    box('ftyp', Buffer.from('isom0000')), box('moov', box('trak', box('mdia', box('hdlr', handler)))),
    box('mdat', Buffer.from([0])),
  ]);
  assert.equal(hasVideoTrack('video/mp4', fake), false);
  const [classic, fragment, mov] = await Promise.all(['synthetic.mp4', 'synthetic-fragmented.mp4', 'synthetic.mov'].map(fixture));
  assert.equal(hasVideoTrack('video/mp4', classic), true);
  assert.equal(hasVideoTrack('video/mp4', fragment), true);
  assert.equal(hasVideoTrack('video/quicktime', mov), true);
  const wrongOffset = Buffer.from(classic);
  wrongOffset.writeUInt32BE(0, wrongOffset.indexOf('stco') + 12);
  assert.equal(hasVideoTrack('video/mp4', wrongOffset), false);
  const wrongTrack = Buffer.from(fragment);
  wrongTrack.writeUInt32BE(9, wrongTrack.indexOf('tfhd') + 8);
  assert.equal(hasVideoTrack('video/mp4', wrongTrack), false);
  assert.equal(hasVideoTrack('video/mp4', fragment.subarray(0, fragment.indexOf('mdat') + 4)), false);
  const wrongFragmentOffset = Buffer.from(fragment);
  wrongFragmentOffset.writeInt32BE(-1, wrongFragmentOffset.indexOf('trun') + 12);
  assert.equal(hasVideoTrack('video/mp4', wrongFragmentOffset), false);
  const tinyMedia = Buffer.concat([fragment.subarray(0, fragment.indexOf('mdat') - 4), box('mdat', Buffer.alloc(1))]);
  assert.equal(hasVideoTrack('video/mp4', tinyMedia), false);
});

test('WebM accepts live unknown-size clusters and requires a block from the video track', async () => {
  const [normal, audio, live, grouped] = await Promise.all([
    'synthetic.webm', 'audio-only.webm', 'synthetic-live.webm', 'synthetic-blockgroup.webm',
  ].map(fixture));
  for (const bytes of [normal, live, grouped]) assert.equal(hasVideoTrack('video/webm', bytes), true);
  assert.equal(hasVideoTrack('video/webm', audio), false);
  const cluster = live.indexOf(Buffer.from([0x1f, 0x43, 0xb6, 0x75]));
  const livePrefix = live.subarray(0, cluster);
  const liveCluster = live.subarray(cluster);
  const wrongTrack = Buffer.from(liveCluster);
  // This generated recording uses an 8-byte unknown size, one timestamp and one SimpleBlock.
  const blockTrack = wrongTrack.indexOf(Buffer.from([0xa3, 0xc9, 0x81])) + 2;
  assert.ok(blockTrack > 2);
  wrongTrack[blockTrack] = 0x82;
  assert.equal(hasVideoTrack('video/webm', Buffer.concat([livePrefix, wrongTrack])), false);
  assert.equal(hasVideoTrack('video/webm', Buffer.concat([livePrefix, wrongTrack, liveCluster])), true);
  assert.equal(hasVideoTrack('video/webm', live.subarray(0, cluster + blockTrack + 5)), false);
});

test('metadata limits reject excessive atoms and elements before a valid video tail', async () => {
  const [mp4, webm] = await Promise.all(['synthetic.mp4', 'synthetic-live.webm'].map(fixture));
  const atom = box('free');
  const cluster = webm.indexOf(Buffer.from([0x1f, 0x43, 0xb6, 0x75]));
  const prefix = webm.subarray(0, cluster);
  const suffix = webm.subarray(cluster);
  const voidElement = Buffer.from([0xec, 0x80]);
  // The same padding is valid when its metadata element count remains small.
  assert.equal(hasVideoTrack('video/mp4', Buffer.concat([mp4, Buffer.alloc(8 * 8, atom)])), true);
  assert.equal(hasVideoTrack('video/webm', Buffer.concat([prefix, Buffer.alloc(16, voidElement), suffix])), true);
  assert.equal(hasVideoTrack('video/mp4', Buffer.concat([mp4, Buffer.alloc(8 * 40_000, atom)])), false);
  assert.equal(hasVideoTrack('video/webm', Buffer.concat([prefix, Buffer.alloc(80_000, voidElement), suffix])), false);
  const cues = Buffer.from([0x1c, 0x53, 0xbb, 0x6b]);
  const beforeCues = webm.subarray(0, webm.indexOf(cues));
  assert.equal(hasVideoTrack('video/webm', Buffer.concat([beforeCues, Buffer.alloc(80_000, voidElement)])), true);
});

test('track limits count declarations even when all track IDs are identical', async () => {
  const fragment = await fixture('synthetic-fragmented.mp4');
  const movie = fragment.indexOf('moov') - 4;
  const movieEnd = movie + fragment.readUInt32BE(movie);
  const track = fragment.indexOf('trak', movie) - 4;
  const trackBytes = fragment.subarray(track, track + fragment.readUInt32BE(track));
  const duplicateMovie = box('moov', Buffer.alloc(trackBytes.length * 257, trackBytes));
  const repeatedMp4 = Buffer.concat([fragment.subarray(0, movie), duplicateMovie, fragment.subarray(movieEnd)]);
  assert.equal(hasVideoTrack('video/mp4', repeatedMp4), false);

  const live = await fixture('synthetic-live.webm');
  const tracks = live.indexOf(Buffer.from([0x16, 0x54, 0xae, 0x6b]));
  const cluster = live.indexOf(Buffer.from([0x1f, 0x43, 0xb6, 0x75]));
  const entry = live.subarray(tracks + 5, cluster);
  const entries = Buffer.alloc(entry.length * 257, entry);
  const size = Buffer.alloc(2);
  size.writeUInt16BE(0x4000 | entries.length);
  const repeatedWebm = Buffer.concat([live.subarray(0, tracks + 4), size, entries, live.subarray(cluster)]);
  assert.equal(hasVideoTrack('video/webm', repeatedWebm), false);
});
