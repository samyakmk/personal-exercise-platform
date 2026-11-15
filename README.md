# Liftmorrow

Liftmorrow helps you train between sessions with a personal trainer. Get a suggested session, record what you actually did, and use your history to decide what to do next. You can also schedule and log workouts manually, browse exercise demonstrations, and review form from uploaded clips.

## Run locally

Use Node.js 22.13 or later. Form review also needs FFmpeg on the server path.

```sh
npm ci
npm run setup:pose
npm run build
npm start
```

Open [the website](http://127.0.0.1:4173). For a live-reloading web development server, run `npm run dev` and open [localhost:8081](http://localhost:8081).

Create a profile with a username to start. Use **Set up training** on Overview or edit your training preferences from **Profile**. You can skip intake, sign out to switch profiles, or delete the active account and its stored data. The profile chooser is shared across tabs in the same browser. Use the same browser and site address to return to your profiles; signing in by username does not recover a profile from another browser or after its cookie is cleared. The passwordless chooser is for local testing. A public deployment needs verified accounts, such as Google sign-in.

Each profile has its own workouts, session history, saved exercises, equipment, profile history, check-ins, videos, and form reviews. Drafts and in-progress sessions stay in the tab and are kept separate by profile. New installations use `.data/liftmorrow.sqlite`. If this browser still has the old workspace cookie, its first profile takes ownership of the existing workspace, preserving data and drafts. Earlier training backups remain supported. New profiles start empty. **Load sample workouts** on Overview adds editable examples. They appear in training metrics once saved as personal workouts. **Remove sample workouts** clears the remaining examples.

The server binds to loopback by default. `PORT` changes the port and `LIFTMORROW_DB` selects another SQLite file. Set `LIFTMORROW_ALLOWED_HOSTS` for trusted custom hostnames. Use a dedicated hostname if sharing a machine with untrusted web services, since browsers send cookies across ports on the same hostname.

## Training workflows

- **Overview** suggests what to do today using your saved equipment, recent completed sessions, optional effort, and trainer preferences. Select **Start suggested session** to open the guided exercises and targets. A paused session or a personal workout scheduled for today takes priority, and you can compare the suggested session with today’s plan. Use **Log a session** to enter a trainer session or past workout. A trainer session yesterday can shorten the next session and shift its focus. A very hard session or training already logged today can lead to a rest suggestion.
- **Profile** saves optional goals, training experience, and your trainer’s written guidance, with a history of the most recent changes. Pick muscle priorities to adjust emphasis, or leave them blank for balanced training. Choose trainer-preferred exercises or movements to leave out. Written notes are for reference. Use these selections to turn a note into a rule for suggestions.
- **Training check-in** saves a private observation, with an optional app reply about today’s suggestion or how effort and trainer preferences work. Choose **Go lighter**, **Rest today**, or **Clear adjustment** to update the suggested plan for the current local day. Replies and suggestions work without an AI key; the app does not send check-ins or profile notes to OpenAI.
- **Sessions** keeps trainer, suggested, and manual training together. Record optional perceived effort from 1 (very easy) to 10 (maximal), a note on the session, and notes on individual exercises. In a guided session, you can pause and resume notes in the same tab, or finish with only the sets you actually recorded.
- **Exercises** lists movements with an English demo. Open **Filters** for equipment, difficulty, and exercise type, or **My equipment** to save available gear. Filter selections stay in the URL. Save exercises to keep them handy in the library and workout picker. Exercise details can be opened directly with an `/explore?exercise=…` URL. Some movements include **Do and avoid** cues for common mistakes. Training history keeps the exercise details for existing records.
- **Workouts** supports one-time or weekly plans, filtering by week or day, and repeating completed workouts. Open a row’s **Details** to see its exercises or edit the workout. In the editor, **Workout options** contains notes, status, and recurrence. Guided sessions show the exercise demonstration and previous performance. Record reps or seconds and enter weight in kg or lb where applicable. The selected exercise, recorded sets, in-progress set inputs, and timers resume in the same tab after reload. The hold timer can fill elapsed seconds when stopped early.
- **Progress** shows a muscle heat map, weekly activity, and per-exercise history with expandable sets. The heat map estimates logged work using set counts, muscle roles, repeated work within the same session, and optional effort. It is not a measurement of recovery. Select a week to open its workout history, or open a workout from the exercise's session list. Recent charts show reps, hold seconds, or heaviest weight, with kg and lb converted to the latest logged unit for comparison.
- **Export and backup** in Workouts contains the calendar, CSV history, and JSON training backup. The history CSV includes session source, effort, and exercise notes. A backup includes personal workouts and their feedback, bookmarks, and equipment. Profile history, check-ins, and videos are kept outside the training backup. Each part can contain up to 10,000 workouts and 8 MiB. Use date ranges for larger histories. Restore merges missing workouts and bookmarks and fills equipment preferences when unset. Video downloads are under **Video options** in Form Review.

## AI recommendations and form review

The start and development commands load `CHATGPT_API_KEY` from the ignored local `.env` through Node. The web build skips dotenv loading. `LIFTMORROW_AI_MODEL` can override the default `gpt-5.4-mini` model, and `LIFTMORROW_FFMPEG` can point to an FFmpeg executable. Without a key, today’s suggestions, check-ins, workout management, exercise filters, and private video storage remain usable. `npm run setup:pose` downloads a checksum-pinned [MoveNet Thunder ONNX model](https://huggingface.co/Xenova/movenet-singlepose-thunder) into ignored local storage. `LIFTMORROW_POSE_MODEL` can point to another copy of that artifact.

In Exercises, **Get recommendations** sends up to 50 matching catalog entries, muscle and equipment selections, and counts of recent sessions with recorded sets for those exercises to OpenAI. The catalog supplies explanations for the selected IDs. If the returned list is incomplete or repeats IDs, Liftmorrow keeps usable picks and fills the gaps from the filtered list. Zero or one match needs no model call. Form Review accepts MP4, WebM, and MOV up to 50 MB. The server converts MOV files to MP4 with FFmpeg. A selected file and an active upload stay available while you navigate the website in the same tab.

With AI available, **Detect for me** is the default exercise selection. **Upload and analyze** saves the clip, matches the exercise against the catalog, and reviews form using that match. It starts with the first 20 seconds and shows the detected exercise alongside the feedback. If the match is unclear, choose the exercise manually or retry from another start time. Selecting an exercise before upload skips detection and lets you start the review after saving.

Exercise detection and form review each send up to eight JPEG stills from the same 20-second window. Open **Choose start time** to enter a starting second or use the current player position. FFmpeg extracts frames locally and removes temporary files. The open clip and active review survive a page reload in the same workspace. **Saved review section** switches between up to ten successful sections. Feedback timestamps seek to the supporting frames, and failed or cancelled attempts preserve saved results. In **Video options**, changing the selected exercise clears its feedback. Deleting a clip removes its feedback and cancels active analysis.

Local joint tracking runs in a worker. It measures push-up hip alignment and descent, squat depth, standing dumbbell press descent, sustained forearm plank hip position, substantial repeated torso rocking during standing curls, visibly bent low reversals or leg swing during pull-ups, repeated high hip position during glute bridges, substantial trunk turn between bird-dog reaches, and repeated torso rotation during one-arm dumbbell rows. Reverse-lunge reviews check step direction across a visible rep. Bird-dog and dead-bug reviews also check for similar movements using visible joint trajectories. Decisive tracked mismatches can return a verdict before OpenAI is called. In other cases OpenAI checks exercise and visibility. A reported strength or visual adjustment needs two supporting frames at least half a second apart. The app filters common explicit medical claims and advice before displaying new feedback. Unclear camera views, incomplete reps, or disagreement between the checks can lead to a request for different footage.

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

- `app/` and `src/screens/` contain Expo Router routes and React Native TypeScript screens for the laptop web layout. `src/components/Shell.tsx` owns the sidebar and `src/theme.ts` defines the shared palette and typography.
- `src/platform/` contains browser-specific dialogs, form fields, demonstration players, and video handling alongside native implementations. The supported build and test target is the website.
- `server/catalog.mjs` combines Liftmorrow's curated exercises with `server/free-exercise-db.json`. The bundled snapshot comes from [Free Exercise DB](https://github.com/yuhonas/free-exercise-db/tree/f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5) ([Unlicense](https://github.com/yuhonas/free-exercise-db/blob/f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5/LICENSE.md)). Liftmorrow omits overlapping entries, normalizes equipment and muscle groups, and keeps its own demonstration videos.
- `server/api.mjs` serves workspace data, downloads, and private media. Upload validation checks the container and video samples. Playback and form review also depend on decoder support for the source codec.
- `server/local-profiles.mjs` owns the browser’s profile roster, active selection, and saved preferences and revisions. `server/check-ins.mjs` owns private journal entries and per-day adjustments. Deleting a profile cascades through its workspace data.
- `shared/today-plan.mjs` builds today’s suggestion from the workout log, gear, preferences, and check-in adjustment. The same planner informs check-in replies. `shared/muscle-work.mjs` estimates accumulated muscle exposure for Progress.
- `server/store.mjs` owns SQLite training data, review leases, workout edit receipts, and workspace validators. The API sends compact mutation responses and compresses large workspace reads. The browser holds the validator in memory for unchanged workspace refreshes and confirms uploaded clips before opening them.

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

The [Photo credits page](http://127.0.0.1:4173/photo-credits) lists the original sources and credits. Liftmorrow bundles a [CC0 dashboard photograph](https://commons.wikimedia.org/wiki/File:Free_weights_area.jpg) and U.S. public-domain photographs and video frames for the exercise thumbnails. The [source list](src/photoCredits.ts) records each asset’s publisher and rights status.
