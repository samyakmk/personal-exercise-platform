# Liftmorrow

Liftmorrow is a web-first personal training workspace. Browse exercises with YouTube demonstrations, schedule and log workouts, track progress, and review form from private video uploads.

## Run locally

Use Node.js 22.13 or later. Form review also needs FFmpeg on the server path.

```sh
npm ci
npm run setup:pose
npm run build
npm start
```

Open [the website](http://127.0.0.1:4173). For a live-reloading web development server, run `npm run dev` and open [localhost:8081](http://localhost:8081).

A browser cookie links equipment, saved exercises, workouts, and videos to this workspace. New installations use `.data/liftmorrow.sqlite`. Existing installations continue to open their original database and upgrade the browser cookie on the next workspace load. Earlier training backups remain supported. New workspaces start empty. **Load sample workouts** on Overview adds editable examples. They appear in training metrics once saved as personal workouts. **Remove sample workouts** clears the remaining examples.

The server binds to loopback by default. `PORT` changes the port and `LIFTMORROW_DB` selects another SQLite file. Set `LIFTMORROW_ALLOWED_HOSTS` for trusted custom hostnames. Use a dedicated hostname if sharing a machine with untrusted web services, since browsers send cookies across ports on the same hostname.

## Training workflows

- **Exercises** puts search and muscle groups up front. Open **Filters** for equipment, difficulty, exercise type and **Has video**, or **My equipment** to save available gear. Filter selections stay in the URL. Save exercises to keep them handy in the library and workout picker. Exercise details can be opened directly with an `/explore?exercise=…` URL.
- **Workouts** supports one-time or weekly plans, filtering by week or day, and repeating completed workouts. Open a row’s **Details** to see its exercises or edit the workout. In the editor, **Workout options** contains notes, status, and recurrence. Guided sessions show the exercise demonstration and previous performance. Record reps or seconds and enter weight in kg or lb where applicable. The selected exercise, recorded sets, in-progress set inputs, and timers resume in the same tab after reload. The hold timer can fill elapsed seconds when stopped early.
- **Progress** shows weekly activity and per-exercise history with expandable sets. Select a week to open its workout history, or open a workout from the exercise's session list. Recent charts show reps, hold seconds, or heaviest weight, with kg and lb converted to the latest logged unit for comparison.
- **Export and backup** in Workouts contains the calendar, CSV history, and JSON training backup. A backup includes personal workouts, bookmarks, and equipment. Each part can contain up to 10,000 workouts and 8 MiB. Use date ranges for larger histories. Restore merges missing workouts and bookmarks and fills equipment preferences when unset. Video downloads are under **Video options** in Form Review.

## AI recommendations and form review

The start and development commands load `CHATGPT_API_KEY` from the ignored local `.env` through Node. The web build skips dotenv loading. `LIFTMORROW_AI_MODEL` can override the default `gpt-5.4-mini` model, and `LIFTMORROW_FFMPEG` can point to an FFmpeg executable. Without a key, exercise filters, workout management, and private video storage remain usable. `npm run setup:pose` downloads a checksum-pinned [MoveNet Thunder ONNX model](https://huggingface.co/Xenova/movenet-singlepose-thunder) into ignored local storage. `LIFTMORROW_POSE_MODEL` can point to another copy of that artifact.

In Exercises, **Get recommendations** sends up to 50 matching catalog entries, muscle and equipment selections, and recent completion counts to OpenAI. Form Review accepts MP4, WebM, and MOV up to 50 MB. The server converts MOV files to MP4 with FFmpeg. A selected file and an active upload stay available while you navigate the website in the same tab.

**Analyze form** sends up to eight JPEG stills from a 20-second window. Open **Choose start time** to enter a starting second or use the current player position. FFmpeg extracts frames locally and removes temporary files. The open clip and active review survive a page reload in the same workspace. **Saved review section** switches between up to ten successful sections. Feedback timestamps seek to the supporting frames, and failed or cancelled attempts preserve saved results. In **Video options**, changing the selected exercise clears its feedback; deleting a clip removes its feedback and cancels active analysis.

Local joint tracking runs in a worker. It measures push-up hip alignment and descent, squat depth, standing dumbbell press descent, sustained forearm plank hip position, substantial repeated torso rocking during standing curls, visibly bent low reversals or leg swing during pull-ups, repeated high hip position during glute bridges, substantial trunk turn between bird-dog reaches, and repeated torso rotation during one-arm dumbbell rows. Reverse-lunge reviews check step direction across a visible rep. Bird-dog and dead-bug reviews also check for similar movements using visible joint trajectories. OpenAI verifies exercise and visibility. Reviews without a local measurement use sampled visual observations where supported, with two frames required for each adjustment. Unclear camera views, incomplete reps, or disagreement between the two checks can lead to a request for different footage.

Requests use structured outputs with response storage disabled. SQLite leases share an active-review cap across processes on the same database. Start-rate limits apply per process and workspace. Public deployment requires account authentication and durable usage limits. [OpenAI Responses API](https://developers.openai.com/api/reference/resources/responses/methods/create) · [OpenAI API data controls](https://developers.openai.com/api/docs/guides/your-data)

## Website checks

```sh
npm run typecheck
npm run test:api
npm run build
npx playwright install chromium
npm run test:web
```

Use `PLAYWRIGHT_CHANNEL=chrome npm run test:web` to run against an existing Chrome install. Browser tests use an in-memory backend and a synthetic test clip. They exercise the embedded player and source link with a mocked YouTube response. Live YouTube demonstrations require internet access.

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

## Source

- `app/` and `src/screens/` contain Expo Router routes and React Native TypeScript screens for the laptop web layout. `src/components/Shell.tsx` owns the sidebar and `src/theme.ts` defines the shared palette and typography.
- `src/platform/` contains browser-specific dialogs, form fields, demonstration players, and video handling alongside native implementations. The supported build and test target is the website.
- `server/catalog.mjs` combines Liftmorrow's curated exercises with `server/free-exercise-db.json`. The bundled snapshot comes from [Free Exercise DB](https://github.com/yuhonas/free-exercise-db/tree/f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5) ([Unlicense](https://github.com/yuhonas/free-exercise-db/blob/f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5/LICENSE.md)). Liftmorrow omits overlapping entries, normalizes equipment and muscle groups, and keeps its own demonstration videos.
- `server/api.mjs` serves workspace data, downloads, and private media. Upload validation checks the container and video samples. Playback and form review also depend on decoder support for the source codec.
- `server/store.mjs` owns SQLite persistence, review leases, workout edit receipts, and workspace validators. The API sends compact mutation responses and compresses large workspace reads. The browser holds the validator in memory for unchanged workspace refreshes and confirms uploaded clips before opening them.

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
