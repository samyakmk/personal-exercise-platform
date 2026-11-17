import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { workoutSafetyReply } from '../shared/session-safety.mjs';
import { AiError, rankExercises } from './ai.mjs';
import { analyzeClip } from './analyze-clip.mjs';
import { exercisesById } from './catalog.mjs';
import { reviewWindowSeconds } from './frames.mjs';
import { answerSessionQuestion } from './session-coach.mjs';
import { answerTrainingChat } from './training-chat.mjs';

export const reviewVersion = 30;

const interrupted = 'Analysis was interrupted. Try again when you’re ready.';
const busy = 'The service is busy. Try again shortly.';
const cancelled = 'cancelled';
const maxActiveReviews = 3;
const reviewConflict = 'This video is already being analyzed. Wait for that review to finish.';

function reviewError({ error, errorStatus }) {
  if (!error || !/\b(?:AI|OpenAI)\b/.test(error)) return error ?? interrupted;
  return errorStatus === 422 ? 'Couldn’t review this clip. Try a different clip or section.' : 'Analysis could not finish. Try again.';
}

export function createCoaching(store, { respond, sampleFrames, estimate, reviewLeaseMs = 20_000, reviewHeartbeatMs = 1_000 } = {}) {
  const pending = new Map();
  const workspaceLimits = new Map();
  const ranked = new Map();
  const minute = 60_000;
  let globalLimit = { starts: 0, until: 0 };
  let shutdown;

  function admit(workspace) {
    if (shutdown) throw new AiError(503, interrupted);
    if (!respond) throw new AiError(503, 'The service is currently unavailable.');
    const now = Date.now();
    for (const [id, limit] of workspaceLimits) {
      if (limit.until <= now) workspaceLimits.delete(id);
    }
    if (globalLimit.until <= now) globalLimit = { starts: 0, until: now + minute };
    const limit = workspaceLimits.get(workspace) ?? { starts: 0, until: now + minute };
    if (limit.starts >= 6 || globalLimit.starts >= 20 || pending.size >= 3) {
      const retry = Math.max(2, Math.ceil(((limit.starts >= 6 ? limit.until : now) - now) / 1000),
        Math.ceil(((globalLimit.starts >= 20 ? globalLimit.until : now) - now) / 1000));
      throw new AiError(429, busy, undefined, retry);
    }
    return () => {
      limit.starts += 1;
      globalLimit.starts += 1;
      workspaceLimits.set(workspace, limit);
    };
  }

  function run(key, action, reviewJob) {
    const controller = new AbortController();
    const result = Promise.resolve().then(() => action(controller)).catch((error) => {
      if (controller.signal.aborted && controller.signal.reason instanceof AiError) throw controller.signal.reason;
      throw error;
    }).finally(() => {
      pending.delete(key);
    });
    pending.set(key, { controller, result, reviewJob });
    return result;
  }

  function reviewStatus(review, attempt, now = Date.now()) {
    const sequence = attempt?.sequence ?? 0;
    const startSeconds = attempt?.startSeconds ?? 0;
    if (attempt.until > now) return { state: 'running', sequence, startSeconds };
    if (attempt.until != null) return { state: 'failed', sequence, startSeconds, error: interrupted };
    if (attempt.owner && attempt.error) return attempt.error === cancelled
      ? { state: 'cancelled', sequence, startSeconds }
      : { state: 'failed', sequence, startSeconds, error: reviewError(attempt) };
    if (attempt?.version === reviewVersion) {
      if (attempt.error === cancelled) return { state: 'cancelled', sequence, startSeconds };
      if (!review || review.version !== reviewVersion || (review.sequence ?? sequence) !== sequence) {
        return { state: 'failed', sequence, startSeconds, error: reviewError(attempt) };
      }
    }
    if (review) return { state: 'complete', sequence, startSeconds: review.startSeconds ?? 0 };
    return { state: 'idle', sequence };
  }

  function stateFor(workspace, id) {
    const state = store.reviewState(workspace, id);
    if (!state) throw new AiError(404, 'Video not found.');
    return state;
  }

  function clipReview(workspace, id) {
    const { review, attempt } = stateFor(workspace, id);
    return { review, reviewStatus: reviewStatus(review, attempt) };
  }

  function publicClip({ attempt, ...clip }, now) {
    return { ...clip, reviewStatus: reviewStatus(clip.review, attempt, now) };
  }

  function attemptError(attempt) {
    return attempt.error === cancelled
      ? new AiError(409, 'Analysis was cancelled.')
      : new AiError(attempt.errorStatus ?? 503, reviewError(attempt));
  }

  async function waitForReview(workspace, id, original, signal) {
    while (!shutdown) {
      signal?.throwIfAborted();
      const { review, attempt } = stateFor(workspace, id);
      if (attempt.owner !== original.owner || attempt.sequence !== original.sequence) {
        throw new AiError(409, 'The video or its review changed. Open it again to see the latest result.');
      }
      if (!(attempt.until > Date.now())) {
        if (!attempt.error && review?.sequence === attempt.sequence) return review;
        throw attemptError(attempt);
      }
      await delay(100, undefined, { signal });
    }
    throw new AiError(503, interrupted);
  }

  function requestReview(workspace, id, startSeconds, refresh) {
    if (shutdown) throw new AiError(503, interrupted);
    if (store.clip(workspace, id)?.size === 0) throw new AiError(422, 'Import the original video before analyzing another section.');
    const claim = store.claimReview(workspace, id, {
      version: reviewVersion, startSeconds, refresh, owner: randomUUID(), leaseMs: reviewLeaseMs,
      maxActive: maxActiveReviews, admit: () => admit(workspace),
    });
    if (claim.state === 'missing') throw new AiError(404, 'Video not found.');
    if (claim.state === 'busy') throw new AiError(429, busy, undefined, 2);
    const { review, attempt } = claim;
    if (claim.state === 'complete') return { review, reviewStatus: reviewStatus(review, attempt) };
    if (attempt.startSeconds !== startSeconds) throw new AiError(409, reviewConflict);
    const key = 'review:' + attempt.owner;
    const status = { state: 'running', sequence: attempt.sequence, startSeconds };
    if (claim.state === 'running') return { review, reviewStatus: status, attempt, result: pending.get(key)?.result };

    claim.recordStart();
    const { clip } = claim;
    const result = run(key, async (controller) => {
      const { signal } = controller;
      const heartbeat = setInterval(() => {
        try {
          if (store.renewReviewLease(workspace, id, attempt, reviewLeaseMs)) return;
          const current = store.reviewState(workspace, id);
          if (!current) controller.abort(new AiError(404, 'Video not found.'));
          else if (current.attempt.owner === attempt.owner) controller.abort(attemptError(current.attempt));
          else controller.abort(new AiError(409, 'The video or its review changed.'));
        } catch (error) {
          controller.abort(error);
        }
      }, reviewHeartbeatMs);
      heartbeat.unref();
      try {
        signal.throwIfAborted();
        const exercise = exercisesById.get(clip.exerciseId);
        if (clip.exerciseId && !exercise) throw new AiError(422, 'Choose an exercise from the library before reviewing this video.');
        const { reviewStill, ...result } = await analyzeClip(respond, store.clipChunks(workspace, id, clip, 0, clip.size), {
          exercise, mime: clip.mime, signal, sampleFrames, estimate, startSeconds,
        });
        signal.throwIfAborted();
        const review = {
          ...result, version: reviewVersion, sequence: attempt.sequence, startSeconds, windowSeconds: reviewWindowSeconds,
          reviewedAt: new Date().toISOString(),
        };
        if (!store.saveReview(workspace, id, attempt, reviewStill ? { ...review, reviewStill } : review)) {
          return await waitForReview(workspace, id, attempt, signal);
        }
        return review;
      } catch (error) {
        if (!signal.aborted) {
          store.failReviewAttempt(workspace, id, attempt,
            error instanceof AiError ? error.message : 'Analysis could not finish. Try again.', error instanceof AiError ? error.status : 500);
        }
        throw error;
      } finally {
        clearInterval(heartbeat);
      }
    }, { workspace, id, attempt });
    return { review, reviewStatus: status, attempt, result, started: true };
  }

  async function stopJobs() {
    const active = [...pending.values()];
    for (const { controller, reviewJob } of active) {
      if (reviewJob) {
        const { workspace, id, attempt } = reviewJob;
        try {
          store.abandonReviewAttempt(workspace, id, attempt, interrupted);
        } catch {
          console.error('Trainer Plus could not release a review lease during shutdown.');
        }
      }
      controller.abort(new AiError(503, interrupted));
    }
    await Promise.allSettled(active.map(({ result }) => result));
  }

  return {
    available: Boolean(respond),
    snapshot(workspace, now = Date.now()) {
      const snapshot = store.snapshot(workspace);
      return {
        ...snapshot,
        clips: snapshot.clips.map((clip) => publicClip(clip, now)),
      };
    },
    clipChanges(workspace, id) {
      const clip = store.clipRecord(workspace, id);
      return clip ? { upsert: [publicClip(clip)], remove: [] } : { upsert: [], remove: [id] };
    },
    clipReview,
    sessionCoach(workspace, input, clientSignal) {
      clientSignal.throwIfAborted();
      const safetyReply = workoutSafetyReply(input.question);
      if (safetyReply) return { reply: safetyReply };
      const key = 'session-coach:' + workspace;
      if (pending.has(key)) throw new AiError(429, 'The coach is answering another question. Try again shortly.', undefined, 2);
      admit(workspace)();
      return run(key, ({ signal }) => answerSessionQuestion(respond, {
        ...input, signal: AbortSignal.any([signal, clientSignal]),
      }));
    },
    chat(workspace, input, clientSignal) {
      clientSignal.throwIfAborted();
      const safetyReply = workoutSafetyReply(input.message);
      if (safetyReply) return { reply: safetyReply };
      if (!respond) throw new AiError(503, 'Chat is currently unavailable.');
      const key = 'training-chat:' + workspace;
      if (pending.has(key)) throw new AiError(429, 'Chat is still answering your previous message. Try again shortly.', undefined, 2);
      admit(workspace)();
      return run(key, async ({ signal }) => {
        try {
          return await answerTrainingChat(respond, store, workspace, { ...input, signal: AbortSignal.any([signal, clientSignal]) });
        } catch (error) {
          if (error instanceof AiError && error.status === 422) {
            throw new AiError(422, 'Chat couldn’t answer that message. Try asking another way.');
          }
          throw error;
        }
      });
    },
    recommend(workspace, { candidates, targets, detail, available, history: completed, count = 3, workout = null }) {
      if (!candidates.length) return [];
      const history = Object.fromEntries(candidates.filter(({ id }) => completed.has(id)).map(({ id }) => [id, completed.get(id)]));
      const input = { candidates, targets: [...targets].sort(), detail, available: available?.slice().sort() ?? null, history, count, workout };
      if (candidates.length === 1) return rankExercises(respond, input);
      const key = 'recommend:' + JSON.stringify([candidates.map((item) => item.id), input.targets, detail, input.available, history, count, workout]);
      const cacheKey = workspace + ':' + key;
      const now = Date.now();
      for (const [id, item] of ranked) {
        if (item.until <= now) ranked.delete(id);
      }
      const cached = ranked.get(cacheKey);
      if (cached) return cached.picks;
      const jobKey = 'recommend:' + cacheKey;
      if (pending.has(jobKey)) return pending.get(jobKey).result;
      admit(workspace)();
      return run(jobKey, async ({ signal }) => {
        const picks = await rankExercises((request) => respond({ ...request, signal }), input);
        signal.throwIfAborted();
        if (ranked.size >= 128) ranked.delete(ranked.keys().next().value);
        ranked.set(cacheKey, { until: Date.now() + minute * 5, picks });
        return picks;
      });
    },
    review(workspace, id, signal) {
      const { review, reviewStatus, attempt, result } = requestReview(workspace, id, 0, false);
      return reviewStatus.state === 'complete' ? review : result ?? waitForReview(workspace, id, attempt, signal);
    },
    startReview(workspace, id, startSeconds, refresh) {
      const { review, reviewStatus, result, started } = requestReview(workspace, id, startSeconds, refresh);
      if (started) void result.catch((error) => {
        if (error instanceof AiError && error.diagnostic) console.warn('Trainer Plus AI request failed:', error.diagnostic);
        else if (!(error instanceof AiError)) console.error('Trainer Plus review failed:', error.name);
      });
      return { review, reviewStatus };
    },
    cancelReview(workspace, id, expectedSequence) {
      const { attempt } = stateFor(workspace, id);
      if (expectedSequence !== undefined && attempt.sequence !== expectedSequence) {
        throw new AiError(409, 'This review changed before it could be cancelled. Check the latest analysis.');
      }
      if (attempt.until > Date.now() && store.failReviewAttempt(workspace, id, attempt, cancelled, 409)) {
        pending.get('review:' + attempt.owner)?.controller.abort(attemptError({ error: cancelled }));
      }
      return clipReview(workspace, id);
    },
    deleteClip(workspace, id) {
      const owner = store.removeClip(workspace, id);
      pending.get('review:' + owner)?.controller.abort(new AiError(404, 'Video not found.'));
    },
    removeWorkspace(workspace) {
      for (const [key, job] of pending) {
        if (job.reviewJob?.workspace === workspace || key.startsWith('recommend:' + workspace + ':')
          || key === 'session-coach:' + workspace || key === 'training-chat:' + workspace) {
          job.controller.abort(new AiError(404, 'Profile deleted.'));
        }
      }
      for (const key of ranked.keys()) {
        if (key.startsWith(workspace + ':')) ranked.delete(key);
      }
      workspaceLimits.delete(workspace);
    },
    stop() {
      shutdown ??= Promise.resolve().then(stopJobs);
      return shutdown;
    },
  };
}
