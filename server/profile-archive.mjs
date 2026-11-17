import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

export const profileArchiveFormat = 'trainer-plus-profile';
export const profileArchiveMaxBytes = 96 * 1024 * 1024;

const groups = ['profile', 'revisions', 'equipment', 'bookmarks', 'workouts', 'trainingNotes', 'checkIns', 'clips', 'videos'];
const counts = () => Object.fromEntries(groups.map((key) => [key, { add: 0, same: 0, conflict: 0 }]));

export function createProfileArchive(db, store) {
  const profile = db.prepare('SELECT details FROM local_profile WHERE workspace_id = ?');
  const equipment = db.prepare('SELECT equipment FROM workspace WHERE id = ?');
  const revisions = db.prepare('SELECT saved_at AS savedAt, details FROM profile_revision WHERE workspace_id = ? ORDER BY id');
  const checkIns = db.prepare(`SELECT id, day, text, adjustment, wants_reply AS wantsReply, reply, saved_at AS savedAt
    FROM training_check_in WHERE workspace_id = ? ORDER BY saved_at, rowid`);
  const clips = db.prepare(`SELECT clip.id, exerciseId, filename, mime, size, uploadedAt, digest, training_context, review
    FROM clip LEFT JOIN clip_review ON clip_review.workspace_id = clip.workspace_id AND clip_review.clip_id = clip.id
    WHERE clip.workspace_id = ? ORDER BY uploadedAt, clip.id`);
  const history = db.prepare(`SELECT start_seconds AS startSeconds, sequence, review FROM clip_review_history
    WHERE workspace_id = ? AND clip_id = ? ORDER BY start_seconds, end_seconds`);
  const writeProfile = db.prepare('UPDATE local_profile SET details = ? WHERE workspace_id = ?');
  const addRevision = db.prepare('INSERT INTO profile_revision (workspace_id, saved_at, details) VALUES (?, ?, ?)');
  const writeEquipment = db.prepare('UPDATE workspace SET equipment = ? WHERE id = ?');
  const addBookmark = db.prepare('INSERT INTO exercise_bookmark (workspace_id, exercise_id) VALUES (?, ?)');
  const addNote = db.prepare('INSERT INTO training_note (workspace_id, id, text, kind, exercise_id, saved_at) VALUES (?, ?, ?, ?, ?, ?)');
  const addCheckIn = db.prepare(`INSERT INTO training_check_in (workspace_id, id, day, text, adjustment, wants_reply, reply, saved_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  const attachMedia = db.prepare(`UPDATE clip SET size = ?, digest = ?, representation = lower(hex(randomblob(16)))
    WHERE workspace_id = ? AND id = ? AND size = 0`);
  const clearDeletion = db.prepare('DELETE FROM clip_deletion WHERE workspace_id = ? AND id = ?');
  const addHistory = db.prepare(`INSERT INTO clip_review_history (workspace_id, clip_id, start_seconds, end_seconds, sequence, review)
    VALUES (?, ?, ?, ?, ?, ?)`);
  const addAttempt = db.prepare(`INSERT INTO clip_review_attempt (workspace_id, clip_id, version, sequence, start_seconds, end_seconds)
    VALUES (?, ?, 0, ?, ?, ?) ON CONFLICT (workspace_id, clip_id) DO UPDATE SET version = 0,
    sequence = max(sequence + 1, excluded.sequence), start_seconds = excluded.start_seconds, end_seconds = excluded.end_seconds,
    error = NULL, error_status = NULL, lease_until = NULL, lease_owner = NULL`);

  function transaction(write, operation) {
    db.exec(write ? 'BEGIN IMMEDIATE' : 'BEGIN');
    try {
      const result = operation();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  function read(workspace) {
    return {
      format: profileArchiveFormat, version: 1,
      profile: JSON.parse(profile.get(workspace).details),
      revisions: revisions.all(workspace).map(({ savedAt, details }) => ({ savedAt, details: JSON.parse(details) })),
      equipment: JSON.parse(equipment.get(workspace).equipment), bookmarks: store.bookmarks(workspace),
      workouts: store.workouts(workspace).filter(({ example }) => !example).map(({ revision, ...workout }) => workout),
      trainingNotes: store.trainingNotes(workspace), checkIns: checkIns.all(workspace),
      clips: clips.all(workspace).map(({ training_context, review, ...clip }) => ({
        ...clip, trainingContext: JSON.parse(training_context), review: JSON.parse(review),
        history: history.all(workspace, clip.id).map((section) => ({ ...section, review: JSON.parse(section.review) })),
      })),
    };
  }

  function saveReviews(workspace, clip) {
    const { id, review, history: sections } = clip;
    if (review) store.saveReview(workspace, id, JSON.stringify(review));
    for (const section of sections) {
      addHistory.run(workspace, id, section.startSeconds, section.review.endSeconds ?? 0, section.sequence, JSON.stringify(section.review));
    }
    const sequence = Math.max(review?.sequence ?? 0, ...sections.map((section) => section.sequence));
    if (sequence > 0 && review) addAttempt.run(workspace, id, sequence, review.startSeconds ?? 0, review.endSeconds ?? null);
  }

  return {
    download(workspace, video) {
      return transaction(false, () => {
        const archive = read(workspace);
        // The upload digest can identify original MOV bytes while the stored payload plays as MP4.
        for (const entry of archive.clips) if (entry.size > 0) entry.digest = null;
        const media = archive.clips.filter(({ id, size }) => size > 0 && (video === 'all' || video === id));
        const metadata = JSON.stringify(archive);
        const mediaSize = media.reduce((total, clip) => total + 4 * Math.ceil(clip.size / 3) + 140, 0);
        if (Buffer.byteLength(metadata) + mediaSize > profileArchiveMaxBytes) return null;
        if (!media.length) return metadata;
        for (const entry of media) {
          const clip = store.clip(workspace, entry.id);
          const bytes = Buffer.concat([...store.clipChunks(workspace, entry.id, clip, 0, clip.size)]);
          if (bytes.length !== clip.size) throw new Error('Clip changed during export');
          entry.data = bytes.toString('base64');
          entry.digest = createHash('sha256').update(bytes).digest('hex');
        }
        return JSON.stringify(archive);
      });
    },
    restore(workspace, archive, apply, authorize) {
      return transaction(apply, () => {
        authorize();
        const current = read(workspace);
        const summary = counts();
        const noteIds = new Map(current.trainingNotes.map((note) => [note.id, note]));
        const checkInIds = new Map(current.checkIns.map((entry) => [entry.id, entry]));
        const workoutIds = new Map(current.workouts.map((workout) => [workout.id, workout]));
        const byOccurrence = new Map(current.workouts.filter(({ seriesId }) => seriesId)
          .map((workout) => [`${workout.seriesId}/${workout.seriesIndex}`, workout]));
        const savedClips = new Map(current.clips.map((clip) => [clip.id, clip]));
        const bookmarked = new Set(current.bookmarks);
        const revisionKeys = new Set(current.revisions.map((entry) => JSON.stringify(entry)));

        function result(group, action, save) {
          summary[group][action] += 1;
          if (apply && action === 'add') save();
        }

        function record(group, incoming, previous, save) {
          result(group, !previous ? 'add' : isDeepStrictEqual(previous, incoming) ? 'same' : 'conflict', save);
        }

        if (Object.keys(archive.profile).length) record('profile', archive.profile, Object.keys(current.profile).length ? current.profile : null,
          () => writeProfile.run(JSON.stringify(archive.profile), workspace));
        if (archive.equipment !== null) record('equipment', archive.equipment, current.equipment,
          () => writeEquipment.run(JSON.stringify(archive.equipment), workspace));
        for (const entry of archive.revisions) result('revisions', revisionKeys.has(JSON.stringify(entry)) ? 'same' : 'add',
          () => addRevision.run(workspace, entry.savedAt, JSON.stringify(entry.details)));
        for (const id of archive.bookmarks) result('bookmarks', bookmarked.has(id) ? 'same' : 'add', () => addBookmark.run(workspace, id));
        for (const workout of archive.workouts) {
          const existing = workoutIds.get(workout.id) ?? (workout.seriesId && byOccurrence.get(`${workout.seriesId}/${workout.seriesIndex}`));
          const receipt = store.reservedWorkout(workspace, workout.id);
          if (!existing && receipt) result('workouts', 'conflict');
          else record('workouts', workout, existing, () => {
            if (!store.insertWorkout(workspace, workout)) throw new Error('Workout changed during restore');
          });
        }
        for (const note of archive.trainingNotes) record('trainingNotes', note, noteIds.get(note.id),
          () => addNote.run(workspace, note.id, note.text, note.kind, note.exerciseId, note.savedAt));
        for (const entry of archive.checkIns) record('checkIns', entry, checkInIds.get(entry.id),
          () => addCheckIn.run(workspace, entry.id, entry.day, entry.text, entry.adjustment, entry.wantsReply, entry.reply, entry.savedAt));
        for (const incoming of archive.clips) {
          const { id, bytes, digest, size: _size, history: sections, review, ...fields } = incoming;
          const existing = savedClips.get(id);
          const hasVideo = existing?.size > 0;
          const playableDigest = hasVideo && bytes ? store.clipDigest(workspace, id) : null;
          const knownDigest = hasVideo ? playableDigest : existing?.digest;
          const compatible = !existing || isDeepStrictEqual(fields, {
            exerciseId: existing.exerciseId, filename: existing.filename, mime: existing.mime,
            uploadedAt: existing.uploadedAt, trainingContext: existing.trainingContext,
          }) && (!digest || !knownDigest || digest === knownDigest);
          if (!compatible) {
            result('clips', 'conflict');
            if (bytes) result('videos', 'conflict');
            continue;
          }
          if (!existing) result('clips', 'add', () => {
            clearDeletion.run(workspace, id);
            store.insertClip(workspace, { ...fields, id, digest, bytes: Buffer.alloc(0) });
            saveReviews(workspace, incoming);
          });
          else if ((review || sections.length) && !existing.review && !existing.history.length && !store.reviewPending(workspace, id)) {
            result('clips', 'add', () => saveReviews(workspace, incoming));
          } else {
            const reviewsMatch = isDeepStrictEqual(existing.review, review) && isDeepStrictEqual(existing.history, sections);
            result('clips', reviewsMatch || (!review && !sections.length) ? 'same' : 'conflict');
          }
          if (bytes) {
            const match = hasVideo && playableDigest === digest;
            result('videos', !hasVideo ? 'add' : match ? 'same' : 'conflict', () => {
              attachMedia.run(bytes.length, digest, workspace, id);
              store.writeClipChunks(workspace, id, bytes);
            });
          }
        }
        return summary;
      });
    },
  };
}
