# Repform

Repform is a web-first personal training workspace. It includes a six-exercise demo catalog, muscle and equipment filters, workout planning and history, and private form-video uploads. Form feedback is labeled sample data.

## Run locally

Use Node.js 22.13 or later.

```sh
npm ci
npm run build
npm start
```

Open [the website](http://127.0.0.1:4173). For a live-reloading web development server, run `npm run dev` and open [localhost:8081](http://localhost:8081).

The Node.js demo API seeds each new browser workspace with example workouts relative to the browser's current date. A persistent browser cookie links the workspace to its equipment, workouts, and clips in `.data/repform.sqlite`. The local server binds to loopback by default. `PORT` changes the server port and `REPFORM_DB` selects a different SQLite file.

## Website checks

```sh
npm run typecheck
npm run test:api
npm run build
npx playwright install chromium
npm run test:web
```

Use `PLAYWRIGHT_CHANNEL=chrome npm run test:web` to run against an existing Chrome install. Browser tests use an in-memory backend and a synthetic test clip. They exercise the embedded player and source link with a mocked YouTube response. Live YouTube demonstrations require internet access.

## Source

- `app/` and `src/screens/` contain Expo Router routes and shared React Native TypeScript screens.
- `src/platform/` contains the web-specific dialogs, form fields, YouTube embed, and video handling alongside native implementations. Future native exports will need a reachable API origin and native verification.
- `server/catalog.mjs` contains the mock exercise data and deterministic recommendation rules. `server/api.mjs` serves the catalog and session-scoped workouts, preferences, and MP4 or WebM clips up to 50 MB.

### Demonstration videos

- [Dumbbell goblet squat by Bony to Bombshell](https://www.youtube.com/watch?v=NIrcxSkwui8)
- [Dumbbell bench press by PureGym](https://www.youtube.com/watch?v=AduT4Eq-iP0)
- [Single-arm dumbbell row by PureGym](https://www.youtube.com/watch?v=ZRSGpBUVcNw)
- [Push-up by Calisthenicmovement](https://www.youtube.com/watch?v=IODxDxX7oi4)
- [Reverse lunge by PureGym](https://www.youtube.com/watch?v=xrPteyQLGAo)
- [Forearm plank by E3 Rehab](https://www.youtube.com/watch?v=A2b2EmIg0dA)

### Photo sources

The [Photo credits page](http://127.0.0.1:4173/photo-credits) lists the original sources and credits. Repform bundles a [CC0 dashboard photograph](https://commons.wikimedia.org/wiki/File:Free_weights_area.jpg) and U.S. public-domain photographs and video frames for the exercise thumbnails. The [source list](src/photoCredits.ts) records each asset’s publisher and rights status.
