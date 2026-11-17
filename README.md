# Trainer Plus

Trainer Plus helps you train between sessions with a personal trainer. Get a suggested session, adjust it, and start it now or schedule a workout for later. Record what you actually did and use your history to decide what to do next. You can also plan manually, browse exercise demonstrations, and review form from recorded or uploaded clips.

## Run locally

Use Node.js 22.13 or later. Form review also needs FFmpeg on the server path.

```sh
npm ci
npm run setup:pose
npm run build
npm start
```

Open [the website](http://127.0.0.1:4173). For a live-reloading web development server, run `npm run dev` and open [localhost:8081](http://localhost:8081).

Create a profile with a username, then enter any training details or equipment you want to save. Choose **Save profile** to open Overview, where you can start a suggested session. You can edit your details in **Profile**, sign out to switch profiles, or delete the active account and its stored data. The profile chooser is shared across tabs in the same browser. Use the same browser and site address to return to your profiles; signing in by username does not recover a profile from another browser or after its cookie is cleared. The passwordless chooser is for local testing. A public deployment needs verified accounts, such as Google sign-in.

Each profile has its own workouts, session history, saved exercises, equipment, profile history, check-ins, videos, and form reviews. Editor drafts stay in the tab. Active sessions and logs awaiting sync are saved for that profile in the browser and can be reopened on the same device. The production web build caches the app shell and a recent training snapshot after an online visit so you can finish a workout offline. New installations use `.data/trainer-plus.sqlite`. Existing installations reopen their database in place and keep their browser profiles. If this browser still has the old workspace cookie, its first profile takes ownership of the existing workspace, preserving data and drafts. Earlier training backups remain supported. New profiles start empty. **Load sample workouts** on Overview adds editable examples. They appear in training metrics once saved as personal workouts. **Remove sample workouts** clears the remaining examples.

The server binds to loopback by default. `PORT` changes the port and `TRAINER_PLUS_DB` selects another SQLite file. Set `TRAINER_PLUS_ALLOWED_HOSTS` for trusted custom hostnames. Use a dedicated hostname if sharing a machine with untrusted web services, since browsers send cookies across ports on the same hostname.

## Training workflows

On phones, use the labeled navigation at the bottom. Open **More** for Chat, Form Review, Progress, and Profile.

- **Overview** suggests what to do today using your equipment, completed sessions, effort, and trainer preferences. Open **Workout details** to preview it. If you already have a scheduled workout, the same card can offer a lighter version, a version for today’s equipment, or a way to reschedule. Use **Log a session** to enter an appointment or past workout. A strenuous recent session or training already logged today can lead to a rest suggestion.
- **Chat** answers questions about completed workouts, such as “What weight did I use for dumbbell curls?” or “How many sessions did I log last week?” You can ask follow-ups or share an observation or trainer instruction. Review the note and its effect before choosing **Save to profile**. Saved notes inform future Chat suggestions; exercise preferences and a preference for shorter workouts also affect Overview and scheduled workout suggestions.
- **Profile** saves optional goals, training experience, and written guidance. Under **Trainer instructions**, pin an exercise cue or set a preference or exclusion, then choose **Save profile**. Pinned cues appear by the exercise during training. **Training notes** shows notes saved from Chat. **Data & privacy** holds the portable profile archive and restore preview.
- **Training check-in** saves a private observation, with an optional app reply about today’s suggestion or how effort and trainer preferences work. Choose **Go lighter**, **Rest today**, or **Clear adjustment** to update the suggested plan for the current local day. Replies and suggestions work without an AI key; the app does not send check-ins or profile notes to OpenAI.
- **Sessions** is the completed training log. Record perceived effort from 1 (very easy) to 10 (maximal), a session note, or notes on exercises. You can save a trainer appointment and add its sets later. Open **Prepare trainer recap** to select sessions, a question, and an optional form cue to copy for your trainer.
- **Exercises** lists movements with an English demo. Filter by muscle group, equipment, difficulty, and exercise type directly below search. Use **My equipment** on Exercises or Profile to save available gear. Filter selections stay in the URL. Save exercises to keep them handy in the library and workout picker. Exercise details can be opened directly with an `/explore?exercise=…` URL. Some movements include **Do and avoid** cues for common mistakes. Training history keeps the exercise details for existing records.
- **Workouts** is the schedule. When creating a plan, choose the date, available time, and equipment before requesting a suggestion. You can reuse a previous workout or choose exercises manually. Weekly plans support editing one or future occurrences and skipping an occurrence. Open **Details** to see exercises and notes.
- **Workout coach** shows the current target and your most recent actual sets. Confirm the reps or hold time and the load after each set. Use **Use last load** to copy a recorded load explicitly. You can pick the rest duration for this workout or swap an exercise when a station is busy. On a phone, the primary action stays at the bottom of the workout. Sets save on the device as you record them. A workout finished offline syncs on reconnect.
- **Voice commands** are available in active sessions on browsers with speech recognition over HTTPS or localhost. Turn them on and allow microphone access, then say “I’m ready,” “I did 8 reps,” “weight 15 pounds,” “record set,” or “skip rest.” Say “message coach” followed by your question. When you’re done, say “finish session” and then the save command shown on the review screen. **Voice help** lists more commands. The browser may send microphone audio to its speech service. Listening pauses when the tab is hidden or the coach speaks, and you opt in again after pausing or reloading the session.
- **Progress** compares recent activity over equal-length periods. Choose the load, reps or hold time, or set count chart for an exercise. A comparison appears when two sessions have the same set count and comparable loads. Select a muscle to see the sessions and sets contributing to its estimated work. Open weekly or exercise history in **Sessions**.
- **Export and backup** in Workouts contains the calendar, CSV history, and workout-only backup. The full archive is in **Profile → Data & privacy**. It includes saved profile details and history, equipment, bookmarks, notes, check-ins, workouts, and clip details and reviews. Choose whether to include the actual video files. An archive can hold up to 96 MiB. Export individual video files as separate archive parts for larger collections. Preview which records can be added and which conflict before restoring. Existing conflicting records are kept.

## Recommendations, chat and form review

The start and development commands load `CHATGPT_API_KEY` from the ignored local `.env` through Node. The web build skips dotenv loading. Form critique uses GPT-6.1 Terra with medium reasoning. Set `TRAINER_PLUS_FORM_MODEL` to change the critique model. Other AI requests use `TRAINER_PLUS_AI_MODEL`, which defaults to GPT-5.4 mini. `TRAINER_PLUS_FFMPEG` can point to an FFmpeg executable. Without a key, today’s suggestions, check-ins, workout management, exercise filters, and private video storage remain usable. `npm run setup:pose` downloads a checksum-pinned [MoveNet Thunder ONNX model](https://huggingface.co/Xenova/movenet-singlepose-thunder) into ignored local storage. `TRAINER_PLUS_POSE_MODEL` can point to another copy of that artifact.

In Exercises, choose **Get recommendations** to find exercises that fit your filters and recent training. Use the buttons below the recommendations to change difficulty or ask for more or fewer picks. Select any recommended row to preview the exercise and add it to a workout.

Exercise recommendations send up to 50 matching catalog entries, muscle and equipment selections, and counts of recent sessions with recorded sets for those exercises to OpenAI. The catalog supplies explanations for the selected IDs. If the returned list is incomplete or repeats IDs, Trainer Plus keeps usable picks and fills the gaps from the filtered list. Zero or one match needs no model call.

**Look up a weight** and **Review my week** in Chat query your completed workout log on the Trainer Plus server and link to the source sessions. Both work without an OpenAI key. Sending a conversation message shares recent turns, a small summary of logged sets, equipment, today’s suggestion, and recent notes saved from Chat with OpenAI. Profile names, raw workout notes, videos, and check-in text remain in the workspace. The conversation clears on reload or profile switch. Saved notes remain on the profile until removed.

Scheduled workout suggestions use saved equipment, recent training, and structured profile preferences. When AI is available, OpenAI selects from eligible catalog exercises using recent exercise counts, experience, priorities, and preferred exercise IDs. Names and notes from the user’s profile and workout log stay local. Without an AI key, the app still offers a workout from the catalog. The app sets and adjusts reps, hold times, and sets; it leaves weight for the user to enter.

Workout setup, timing, and reports work locally. When you ask the workout coach an exercise question and AI is available, the request sends the question, exercise context, workout step, and planned set target to OpenAI. The coach chooses a catalog cue or a fact about the current set. Local cues are available if the request fails.

Form Review accepts MP4, WebM, and MOV up to 50 MB. The server converts MOV files to MP4 with FFmpeg. A selected file and an active upload stay available while you navigate the website in the same tab.

Choose **Record with camera** to capture a clip in a supported browser on HTTPS or localhost. The camera records up to 20 seconds without audio after a five-second countdown. Preview the recording and select **Use recording** to add it to the upload form.

During a workout, choose **Upload recording** to pick an existing clip or use **Continue to form review** after recording with the camera. Both open a preview with the current exercise selected and link the saved clip to the session and set. Choose **Resume workout** to return while analysis runs. When a supported adjustment is ready, choose **Try this cue next set** to carry it into the linked workout.

Preview an uploaded clip, keep **Detect for me** or choose an exercise, then select **Upload and analyze**. Use **Choose time range** below the upload actions to enter start and end times in whole seconds or set them from the playhead. Choose **Upload video** to save the clip by itself. If a MOV needs conversion before it can play, upload it and analyze it afterward.

Saved videos also offer **Choose time range**. Exercise detection and form review each send up to eight JPEG stills to OpenAI from the chosen section. The automatic range covers up to 20 seconds from the start time. FFmpeg extracts frames locally and removes temporary files. The open clip and active review survive a page reload in the same workspace. **Saved review section** switches between up to ten successful sections, identified by their start and end times. Feedback timestamps seek to the supporting frames, and failed or cancelled attempts preserve saved results. Select **Change exercise** below the player to update the clip’s exercise. Saving the change clears its feedback. Deleting a clip removes its feedback and cancels active analysis.

Form Review prioritizes a specific adjustment when the footage supports one. A squat review can show separate cues for stance and depth, plus another visible adjustment if supported. Each cue has its own timestamps. The first adjustment can also show its cited still and, where a relevant reference is available, a matching demonstration image with its source and credit. Compare two reviewed clips of the same exercise to revisit their cited positions and cues. The result can describe the visible positions it checked and offer filming instructions for a limited view.

Local joint tracking runs in a worker in sections up to 20 seconds. Automatic detection uses contrasting working positions when tracking finds them and reuses the same measurements for supported reviews. Longer custom ranges use visual review with samples spread across the selected interval. Tracking measures push-up hip alignment and descent, squat depth and stance width when visible, standing dumbbell press descent, sustained forearm plank hip position, substantial repeated torso rocking during standing curls, visibly bent low reversals or leg swing during pull-ups, repeated high hip position during glute bridges, substantial trunk turn between bird-dog reaches, and repeated torso rotation during one-arm dumbbell rows. Reverse-lunge reviews check step direction across a visible rep. Bird-dog and dead-bug reviews also check for similar movements using visible joint trajectories. Decisive tracked mismatches can return a verdict before OpenAI is called. A visual adjustment or strength needs two supporting frames at least half a second apart and can use the visible parts of the exercise when tracking is limited. The app filters common explicit medical claims and advice before displaying new feedback. Unclear camera views, incomplete reps, or disagreement about the exercise can lead to a request for different footage.

Requests use structured outputs with response storage disabled. SQLite leases share an active-review cap across processes on the same database. Start-rate limits apply per process and workspace. Public deployment requires account authentication and durable usage limits. [OpenAI Responses API](https://developers.openai.com/api/reference/resources/responses/methods/create) · [OpenAI API data controls](https://developers.openai.com/api/docs/guides/your-data)

## Website checks

```sh
npm run typecheck
npm run test:api
npm run build
npx playwright install chromium
npm run test:web
```

Use `PLAYWRIGHT_CHANNEL=chrome npm run test:web` to run against an existing Chrome install. Browser tests use an in-memory backend, local test profiles, and a synthetic test clip. They exercise the embedded player and source link with a mocked YouTube response. Live YouTube demonstrations require internet access.

For the desktop browser matrix, install Firefox and WebKit using `npx playwright install firefox webkit` and run `PLAYWRIGHT_CHANNEL=chrome PLAYWRIGHT_ALL_DESKTOP=1 npm run test:web`. This runs the full Chrome and Firefox flows and the WebKit keyboard project. Set `PLAYWRIGHT_WEBKIT_POINTER=1` to include the full pointer project on a host where that WebKit driver dispatches clicks reliably.

### Form evaluation

Use the [form review adjudication protocol](FORM-EVALUATION.md) to design a blind holdout and run the configured production pipeline with authorized footage.

The [case manifest](tests/fixtures/form-eval.json) records neutral file IDs, publisher labels, and visible target faults from the [CC BY 4.0 multi-view exercise dataset](https://data.mendeley.com/datasets/kgbb3yn47p/3) by Duddela Sai Prashanth and colleagues. The rubric scores the visible motion in each case, including occasional deviations in publisher-labeled good clips. Some cases test only the absence of a particular cue. Source clips and generated results can be stored in ignored `.data/form-eval/`.

```sh
npm run eval:form -- --dataset /path/to/extracted-archive --output .data/form-eval/local.json
npm run eval:form -- --live --output .data/form-eval/live.json validation squat
npm run prepare:form -- --manifest tests/fixtures/form-external.json --sources /path/to/originals --clips .data/form-external
npm run eval:form -- --manifest tests/fixtures/form-external.json --clips .data/form-external --live --strict --retry-transient
npm run prepare:form -- --manifest tests/fixtures/form-core.json --sources /path/to/originals --clips .data/form-core
npm run eval:form -- --manifest tests/fixtures/form-core.json --clips .data/form-core --live --repeat 2 --strict --retry-transient
```

Pass a directory containing `Dataset Exercise Quality-wise/` on the first run, or pass `--clips` for prepared MP4 files named by neutral case ID. To reproduce the [external benchmark](tests/fixtures/form-external.json), place the originals in one local folder using the filenames under `sources` in the manifest. That section lists public downloads or archive members. The preparation command applies the listed trims, crops, and overlay masks and strips audio, subtitles, metadata, and chapters. The [core benchmark](tests/fixtures/form-core.json) also accepts this command and lists source quality when the original is hosted on YouTube. You can pass a group or case ID to prepare a subset. The command works from local files. Re-encoding with another FFmpeg version can change the clip fingerprints used for report comparison.

The default run scores local measurements, including measured checks whose rubric also names a live verdict. `--live` verifies verdicts and includes visual-only cases. Both modes use the same frame and pose pipeline as the website. Select groups or individual case IDs. `--repeat` runs multiple live trials, and `--compare` checks outcomes against an earlier report with the same rubric, provenance, and video fingerprints. Use `--retry-transient` to retry eligible temporary provider failures once. Reports record the configured model, review version, and retry policy. Exploratory cases preserve the full result and have no strict grade. `--strict` exits with status 2 on a rubric failure. Infrastructure errors exit with status 1.

Reports list byte-identical clips under `duplicateClips` when both cases run together. The Mendeley archive contains the same original video under the subject 010 and subject 013 good side-view push-up entries, used by `confirm-02` and `overnight-06`. Count those two cases as one recording when summarizing independent coverage.

The core benchmark retains `core-17`, a mild single-lift glute-bridge fault the current reviewer misses. The measured bridge cue needs a visible deviation across two lifts. The pull-up rubric measures the lower reversal and leg swing. It leaves chin clearance ungraded.

### Budgeted LLM evaluations

Start with local cases. `npm run eval:ranking` tests the exercise catalog and recommendation fallback with synthetic filters. `--group holdout` runs the distinct held-out filter combinations. For form, use `--preflight` to verify prepared clips and write fingerprints before contacting OpenAI. Add `--disjoint-from <report>` when checking a holdout against previous cases; the harness rejects reused IDs, identical clips, and traceable subject or recording reuse. Source families are a check on the fixtures' provenance, not a count of unique performers.

To reproduce the independent form clips, follow the [source and preparation notes](tests/fixtures/form-independent-preparation.md) and check the [tested clip fingerprints](tests/fixtures/form-independent-sha256.txt). Keep the prepared clips in `.data/form-independent`.

```sh
npm run eval:ranking -- --group holdout
npm run eval:form -- --preflight --manifest tests/fixtures/form-independent.json --clips .data/form-independent --output .data/independent-preflight.json
npm run eval:ranking -- --live --budget-ledger .data/llm-study.sqlite triceps-bodyweight back-with-cable
npm run eval:form -- --live --budget-ledger .data/llm-study.sqlite --manifest tests/fixtures/form-independent.json --clips .data/form-independent --strict
```

Reuse the same ledger for the entire study. The guarded commands count the actual text, schema, and images with the [OpenAI input token endpoint](https://developers.openai.com/api/docs/guides/token-counting) before generating. The default study target is 120,000 inputs including a conservative second count for preflights, and no more than 24 preflights. The ledger also enforces a four million hard limit. Missing generation usage keeps the reservation and stops further requests. It records counts, model, and status without saving prompts, pictures, or API keys. Guarded mode supports GPT-5.4 mini and its documented snapshot. Use verified public or synthetic benchmark inputs for live evaluations.

## Source

- `app/` and `src/screens/` contain Expo Router routes and React Native TypeScript screens for the laptop web layout. `src/components/Shell.tsx` owns responsive navigation and `src/theme.ts` defines the shared palette and typography.
- `src/platform/` contains browser-specific dialogs, form fields, demonstration players, and video handling alongside native implementations. The supported build and test target is the website.
- `server/catalog.mjs` combines Trainer Plus's curated exercises with `server/free-exercise-db.json`. The bundled snapshot comes from [Free Exercise DB](https://github.com/yuhonas/free-exercise-db/tree/f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5) ([Unlicense](https://github.com/yuhonas/free-exercise-db/blob/f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5/LICENSE.md)). Trainer Plus omits overlapping entries, normalizes equipment and muscle groups, and keeps its own demonstration videos.
- `server/api.mjs` serves workspace data, downloads, and private media. Upload validation checks the container and video samples. Playback and form review also depend on decoder support for the source codec.
- `server/local-profiles.mjs` owns the browser’s profile roster, active selection, and saved preferences and revisions. `server/check-ins.mjs` owns private journal entries and per-day adjustments. Deleting a profile cascades through its workspace data.
- `shared/today-plan.mjs` builds today’s suggestion from the workout log, gear, preferences, and check-in adjustment. The same planner informs check-in replies. `shared/muscle-work.mjs` estimates accumulated muscle exposure for Progress.
- `server/recommendations.mjs` limits the choices for exercise refinements and builds scheduled workout previews. `src/workoutRefinement.ts` adjusts targets for both today’s and scheduled workout suggestions.
- `server/store.mjs` owns SQLite training data, review leases, workout edit receipts, and workspace validators. The browser requests a starter workspace and loads the independently versioned catalog in the background. The service worker caches the app shell and fingerprinted static assets. Profile-scoped workout recovery uses browser storage.

### Demonstration videos

The library embeds YouTube and Vimeo videos from their original publishers. `server/exercise-demonstrations.json` records the video ID, original uploader, and source page for each added demonstration. Matches were checked against the publisher's exercise guide and the video provider's embed metadata. Written descriptions and muscle tags use the bundled catalog data. [PureGym](https://www.puregym.com/exercises/) · [CrossFit](https://www.crossfit.com/crossfit-movements) · [Precision Nutrition](https://www.precisionnutrition.com/video-exercise-library) · [AtletIQ](https://atletiq.com/en/exercises/) · [Fitloop](https://fitloop.app/exercises)

- [Dumbbell goblet squat by Bony to Bombshell](https://www.youtube.com/watch?v=NIrcxSkwui8)
- [Dumbbell bench press by PureGym](https://www.youtube.com/watch?v=AduT4Eq-iP0)
- [Single-arm dumbbell row by PureGym](https://www.youtube.com/watch?v=ZRSGpBUVcNw)
- [Push-up by Calisthenicmovement](https://www.youtube.com/watch?v=IODxDxX7oi4)
- [Incline push-up by PureGym](https://www.youtube.com/watch?v=yAbg3_pJKvw)
- [Reverse lunge by PureGym](https://www.youtube.com/watch?v=xrPteyQLGAo)
- [Forearm plank by E3 Rehab](https://www.youtube.com/watch?v=A2b2EmIg0dA)
- [Bodyweight squat by PureGym](https://www.youtube.com/watch?v=l83R5PblSMA)
- [Glute bridge by PureGym](https://www.youtube.com/watch?v=tqp5XQPpTxY)
- [Single-arm dumbbell curl by PureGym](https://www.youtube.com/watch?v=Zl1eiQN5Dxs)
- [Standing dumbbell shoulder press by PureGym](https://www.youtube.com/watch?v=aI2hGzsAMXs)
- [Dumbbell Romanian deadlift by PureGym](https://www.youtube.com/watch?v=zU-f6DMCdAI)
- [Bird dog by E3 Rehab Exercise Library](https://www.youtube.com/watch?v=egKWoMZ6cXM)
- [Dead bug by E3 Rehab Exercise Library](https://www.youtube.com/watch?v=BZYaCzbP09M)
- [Pull-up by PureGym](https://www.youtube.com/watch?v=PHdHnZcbsB8)

### Photo sources

The [Photo credits page](http://127.0.0.1:4173/photo-credits) lists the original sources and credits. Trainer Plus bundles a [CC0 dashboard photograph](https://commons.wikimedia.org/wiki/File:Free_weights_area.jpg) and U.S. public-domain photographs and video frames for the exercise thumbnails. The [source list](src/photoCredits.ts) records each asset’s publisher and rights status.

The [form review reference sources](server/form-reference.json) cover the 15 starter exercises. The stills use public-domain U.S. military demonstrations and photos published by [Free Exercise DB](https://github.com/yuhonas/free-exercise-db/tree/f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5). The two standing shoulder press images are cropped and resized excerpts from the good side-view press by subject 019 in [Duddela Sai Prashanth et al.’s exercise dataset](https://data.mendeley.com/datasets/kgbb3yn47p/3), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
