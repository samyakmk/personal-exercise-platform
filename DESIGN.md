# Personal Training App Design

Help people plan and practice workouts between trainer sessions or train on their own. The first release is a working website for discovering exercises, planning and logging workouts, and submitting videos for AI-assisted form review.

## User experience

The website is designed around a laptop viewport. A persistent left sidebar switches between the five main views. The current task and its primary action lead each view; secondary controls and detailed data are available through clearly named disclosures and dialogs.

- **Overview** leads with a paused session or the next scheduled workout, with sets and edit actions under **Workout details**. Recent activity, form review, and a few exercises are secondary.
- **Exercises** puts search and muscle filters above the library. Equipment and difficulty are under **Filters**. Each exercise opens with a YouTube demonstration and technique cues side by side at laptop widths. Users can save exercises, add them to workouts, or ask OpenAI to rank eligible exercises.
- **Workouts** shows the calendar above a compact Schedule or History list. **Details** reveals exercises, notes, and actions for a workout. **Workout options** holds recurrence, status, and notes in the editor. **Export and backup** contains calendar, CSV, and training backup downloads. The selected day or week survives reload. Guided sessions retain technique, rest and hold timers, and logging for actual reps or hold seconds and per-dumbbell weights.
- **Progress** shows weekly training activity and per-exercise history, with recent charts for reps, hold seconds, or dumbbell load. Users can open a week’s workout history or reopen a logged session.
- **Form Review** starts with an uploader for a new workspace and prioritizes the saved video list once clips exist. A review puts playback beside feedback, with separate controls for changing the start time and managing the video. Timestamps seek to the relevant frames. Active reviews continue across navigation and reloads and can be cancelled or retried.

## Architecture

Use Expo, React Native for Web, and TypeScript for the frontend. Design, build, and verify the website with laptop browsers as the primary target. Browser-specific dialogs, file selection, and media playback are isolated behind small interfaces. [Expo web documentation](https://docs.expo.dev/workflow/web/)

The Node.js API uses a curated catalog and SQLite for workspace preferences, workouts, clips, and feedback. Private video chunks support byte-range playback. A browser cookie links the workspace to its saved data. Compact mutation responses, compression, and conditional workspace reads reduce history transfers.

FFmpeg extracts still frames locally. A worker runs MoveNet to track supported movements, and OpenAI checks exercise identity and visibility or reviews visible technique. SQLite leases coordinate active reviews across server processes on the same database. A separate private endpoint serves previous successful sections. The evaluation harness uses neutral fixtures with a recorded rubric and source provenance.

## Website acceptance criteria

1. Muscle and equipment selections return matching exercises, including bodyweight results and a clear empty state. Every catalog result plays its demonstration.
2. Users can schedule, log, edit, and delete workouts. The dashboard reflects changes. Personal workout logs, bookmarks, and equipment persist and can be restored from a backup.
3. A valid clip can be previewed, uploaded, reopened after reload, and deleted. Unsupported or oversized files get clear errors, and a failed upload can be retried. A separate browser session cannot access the clip.
4. AI recommendations stay within the selected catalog filters. Form reviews handle unclear footage, preserve earlier sections across retries, and are deleted with their clips.
5. Core flows work at wide and narrow browser widths and can be operated with a keyboard. The production web build passes browser verification.
