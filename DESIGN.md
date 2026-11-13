# Personal Training App Design

Help people plan and practice workouts between trainer sessions or train on their own. The first release is a working website for discovering exercises, planning and logging workouts, and submitting videos for future form analysis.

## User experience

- **Today** shows the next scheduled workout and recent activity, with shortcuts to find an exercise, log a workout, or upload a clip. Use a contemporary, exercise-led design with clear typography, prominent demonstrations, and layouts that adapt to browser width.
- **Explore** lets users select target muscle groups and save the equipment they have, including a bodyweight-only option. A curated catalog supplies recommendations based on those choices. Each result has a playable demonstration, setup and movement cues, and an action to add it to a workout.
- **Plan and log** lets users create, view, edit, and delete scheduled workouts and completed entries. A planned workout can be logged with the sets and reps actually performed. Saved equipment pre-fills Explore, and upcoming workouts and recent exercises provide context when users schedule a session or choose an exercise for a video.
- **Form review** lets users choose an exercise, preview and upload a clip, and reopen or delete the submission. The saved clip shows that analysis is unavailable in this release. A clearly labeled example shows where future feedback on observed form and suggested adjustments will appear.

## Proposed architecture

Use Expo, React Native for Web, and TypeScript for the frontend. Share screens, navigation, and workout logic across platforms, with browser-specific file selection and video playback isolated behind small interfaces. This keeps a path open to future iOS and Android exports. The first release builds and tests the website only. [Expo web documentation](https://docs.expo.dev/workflow/web/)

Use a Node.js API with SQLite for the exercise catalog, equipment preferences, workouts, logs, and video metadata. Store uploaded clips privately. Start with a private workspace tied to a browser session so users can resume in the same browser. Keep catalog matching and video submissions at the API boundary so future AI can use the same exercise IDs, workout history, and clip references. AI integration is deferred.

## Build order

1. Build navigation, the exercise catalog, filters, and demonstration playback.
2. Add persistent equipment preferences, workout scheduling, logging, and dashboard summaries.
3. Add private video uploads and the form-review screens, then verify the production web build in a browser.

## Website acceptance criteria

1. Muscle and equipment selections return matching exercises, including bodyweight results and a clear empty state. Every catalog result plays its demonstration.
2. Users can schedule, log, edit, and delete workouts. The dashboard reflects changes, and saved workouts, logs, and equipment survive a reload.
3. A valid clip can be previewed, uploaded, reopened after reload, and deleted. Unsupported or oversized files get clear errors, and a failed upload can be retried. A separate browser session cannot access the clip.
4. Core flows work at wide and narrow browser widths and can be operated with a keyboard. The production web build passes browser verification.
