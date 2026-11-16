# Personal Training App Design

Help people act on their trainer’s guidance between appointments. Start from a suggested session, capture what happened, and make the next suggestion reflect actual training. Keep manual planning, session logs, and form review available.

## User experience

The website is designed around a laptop viewport. A persistent left sidebar switches between training views and Profile. The current task and its primary action lead each view; secondary controls and detailed data are available through clearly named disclosures and dialogs.

- **Overview** recommends a session, lighter work, or rest. Explain the decision in plain language and let users adjust effort or length before starting the guided lineup. A paused session or today’s personal schedule can take priority. Trainer handoff, recent activity, and form review stay nearby. The check-in can save a note, offer a focused reply, or set the current day lighter or to rest.
- **Exercises** leads with AI recommendations when available. Users can refine the current shortlist by difficulty or number of picks. Search and muscle filters sit above the library, with equipment and difficulty under **Filters**. Each exercise opens with a demonstration and technique cues side by side at laptop widths. Add a specific do/avoid pair when it corrects a common mistake. Users can save exercises or add them to workouts.
- **Workouts** shows the calendar above a compact Schedule or History list. Start a schedule draft with a suggested workout, refine it, and accept it before saving, or choose exercises manually. **Details** reveals exercises, notes, and actions for a workout. **Workout options** holds recurrence, status, and notes in the editor. **Export and backup** contains calendar, CSV, and training backup downloads. The selected day or week survives reload.
- **Workout coach** waits for readiness after introducing the exercise, equipment, and planned load. It prompts for actual reps or hold time, guides rest and exercise transitions, and offers optional spoken prompts. Users can ask about the current exercise, take more time, skip, or switch to manual logging. The workout step and timer deadlines are tab-scoped.
- **Sessions** combines trainer, manual, and suggested logs. Optional effort refers to the whole session. Keep session notes and movement-specific notes separate, and preserve feedback when a guided session resumes.
- **Progress** shows a weighted muscle heat map, weekly training activity and per-exercise history, with recent charts for reps, hold seconds, or dumbbell load. Users can open a week’s workout history or reopen a logged session.
- **Chat** is a full-page conversation with a fixed composer. Users can ask about logged sessions or talk through training. Chat can offer to save part of the user’s message as a profile note and explains how that note will be used before saving it.
- **Profile** offers a skippable intake for goals, experience, trainer guidance, muscle priorities, and exercise preferences. Timestamp saved updates, and keep controls to sign out or delete the account. The signed-out view lets a browser create a username or choose a saved local profile.
- **Form Review** starts with an uploader for a new workspace and prioritizes the saved video list once clips exist. Users can preview an optional camera recording before uploading it. A recording from a workout opens with that exercise selected and a link back to the paused session. A review puts playback beside feedback, with separate controls for changing the start time and managing the video. Timestamps seek to the relevant frames. Active reviews continue across navigation and reloads and can be cancelled or retried.

## Architecture

Use Expo, React Native for Web, and TypeScript for the frontend. Design, build, and verify the website with laptop browsers as the primary target. Browser-specific dialogs, file selection, camera capture, speech synthesis, and media playback are isolated behind small interfaces. [Expo web documentation](https://docs.expo.dev/workflow/web/)

The Node.js API uses a curated catalog and SQLite for workspace preferences, workouts, clips, and feedback. Private video chunks support byte-range playback. An opaque browser cookie identifies a local profile roster, with at most one active profile. Each profile owns one workspace, and private requests use that active workspace. Browser drafts and in-progress sessions use the workspace key. Compact mutation responses, compression, and conditional workspace reads reduce history transfers.

Today’s planner uses a bounded pool of suitable strength exercises, checks the saved gear and exclusions, and gives preference to trainer-preferred and familiar movements that fit the goal. Session effort can change suggested reps and set counts within conservative limits. Load is left for the user to enter. Notes are kept as reference, and structured preferences and check-in actions affect suggestions. Profile revisions and journal entries are workspace-scoped. Workout feedback uses additive SQLite columns and optional movement notes; earlier records and version 1 backups are still readable.

FFmpeg extracts still frames locally. A worker runs MoveNet to track supported movements, and OpenAI checks exercise identity and visibility or reviews visible technique. SQLite leases coordinate active reviews across server processes on the same database. A separate private endpoint serves previous successful sections. The evaluation harness uses neutral fixtures with a recorded rubric and source provenance.

## Website acceptance criteria

1. Muscle and equipment selections return matching exercises, including bodyweight results and a clear empty state. Every catalog result plays its demonstration.
2. Users can schedule, log, edit, and delete workouts. The dashboard reflects changes. Personal workout logs, bookmarks, and equipment persist and can be restored from a backup.
3. A valid clip can be previewed, uploaded, reopened after reload, and deleted. Unsupported or oversized files get clear errors, and a failed upload can be retried. A separate browser session cannot access the clip.
4. AI recommendations stay within the selected catalog filters. Form reviews handle unclear footage, preserve earlier sections across retries, and are deleted with their clips.
5. Core flows work at wide and narrow browser widths and can be operated with a keyboard. The production web build passes browser verification.
6. Local profiles can be created, selected, updated, and deleted. Switching profiles across tabs clears the previous profile from view, and deleting an account removes only its own data.
7. An empty profile can start a suggested session without selecting exercises. A trainer log, effort rating, or a change to saved preferences can change the next suggested work.
8. Effort and notes persist through session editing and training backup/restore. Check-ins can save without reply, can change that local day’s recommendation, and remain private to the active profile.
9. Users can refine a workout preview repeatedly, accept the result, and save it to their schedule without choosing exercises. Adjusting a suggestion leaves saved workouts unchanged until the user saves the draft.
10. Chat retrieves recorded weights and session counts for the active profile, excluding examples and planned workouts. Trainer guidance and observations persist only after saving. Users can remove saved notes in Profile.
11. A new workout waits for readiness, records only confirmed sets, and resumes its current exercise and rest deadline after reload. Users can preview silent camera footage locally and choose when to upload it for form review.
