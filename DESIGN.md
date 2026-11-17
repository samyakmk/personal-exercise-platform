# Personal Training App Design

Help people act on their trainer’s guidance between appointments. Start from a suggested session, capture what happened, and make the next suggestion reflect actual training. Keep manual planning, session logs, and form review available.

## User experience

A persistent sidebar provides navigation at laptop widths. Narrow screens use labeled bottom navigation with a **More** menu. The current task and its primary action lead each view. Related actions appear together, with quieter controls for secondary actions. Named disclosures open previews and longer content.

- **Overview** recommends a session, lighter work, or rest. **Workout details** contains the preview and reasoning. When a workout is already scheduled, show the plan together with current readiness and equipment constraints. Resume an active session from the same device.
- **Exercises** offers exercise recommendations based on filters and recent training. Users can refine the current shortlist by difficulty or number of picks. Search and the visible muscle, equipment, difficulty, and exercise type filters sit above the recommendations and library. Each exercise opens with a demonstration and technique cues side by side at laptop widths. Add a specific do/avoid pair when it corrects a common mistake. Each exercise sheet shows actions to save the exercise, add it to a workout, log a session, upload a form video, or open exercise history.
- **Workouts** shows the calendar and scheduled workouts. Suggestions account for the selected date, workout length, gear, and nearby training. Users can reuse past workouts or build their own, then edit one occurrence or future occurrences in a weekly series.
- **Workout coach** presents the current target and last actual sets. Users can reuse a load explicitly, swap a movement, and set a rest duration. The primary action stays visible on narrow screens. Confirmed sets and timer deadlines persist in the browser. Offline completion queues the log for sync.
- **Sessions** holds the completed log and distinguishes sessions with sets pending. Trainer recaps draw from a selected set of sessions and can include a user-written question or a form cue.
- **Progress** compares equivalent periods and offers selectable charts for load, reps, hold time, and sets where available. The heat map opens the contributing sessions, and history links open the canonical log.
- **Chat** offers weight and weekly history tools that calculate from the log and link to source sessions. The provider-backed conversation supports follow-ups and can propose training notes for the user to review.
- **Profile** offers skippable training preferences, including editable trainer instructions. **Data & privacy** holds the profile archive and restore preview. Local profile selection remains tied to the browser cookie.
- **Form Review** separates saving a clip from analyzing a selected section. Workout clips can be linked to a specific set. Reviews show assessment scope, timestamped evidence, and recapture guidance. Users can compare clips and carry one cue into the active workout.

## Architecture

Use Expo, React Native for Web, and TypeScript for the frontend. Design, build, and verify the website with laptop browsers as the primary target. Browser-specific dialogs, file selection, camera capture, speech synthesis, and media playback are isolated behind small interfaces. [Expo web documentation](https://docs.expo.dev/workflow/web/)

The Node.js API uses a curated catalog and SQLite for workspace preferences, workouts, clips, and feedback. Private video chunks support byte-range playback. An opaque browser cookie identifies a local profile roster, with at most one active profile. Each profile owns one workspace, and private requests use that active workspace. A thin workspace response includes the starting workout catalog and records referenced by the profile. The full catalog is fetched and cached separately by version. The service worker caches the shell and fingerprinted static assets, and profile-scoped browser storage holds a recent workspace snapshot, active workout, and pending session logs.

Today’s planner uses a bounded pool of suitable strength exercises, checks the saved gear and exclusions, and gives preference to trainer-preferred and familiar movements that fit the goal. Session effort can change suggested reps and set counts within conservative limits. Load is left for the user to enter. Notes are kept as reference, and structured preferences and check-in actions affect suggestions. Profile revisions and journal entries are workspace-scoped. Workout feedback uses additive SQLite columns and optional movement notes; earlier records and version 1 backups are still readable.

FFmpeg extracts still frames locally. A worker runs MoveNet to track supported movements, and OpenAI checks exercise identity and visibility or reviews visible technique. SQLite leases coordinate active reviews across server processes on the same database. A separate private endpoint serves previous successful sections. The evaluation harness uses neutral fixtures with a recorded rubric and source provenance.

## Website acceptance criteria

1. Muscle and equipment selections return matching exercises, including bodyweight results and a clear empty state. Every catalog result plays its demonstration.
2. Users can schedule, log, edit, and delete workouts. The dashboard reflects changes. Personal workout logs, bookmarks, and equipment persist and can be restored from a backup.
3. A valid clip can be previewed, uploaded, reopened after reload, and deleted. Unsupported or oversized files get clear errors, and a failed upload can be retried. A separate browser session cannot access the clip.
4. Exercise recommendations stay within the selected catalog filters. Form reviews handle unclear footage, preserve earlier sections across retries, and are deleted with their clips.
5. Core flows work at wide and narrow browser widths and can be operated with a keyboard. The production web build passes browser verification.
6. Local profiles can be created, selected, updated, and deleted. Switching profiles across tabs clears the previous profile from view, and deleting an account removes only its own data.
7. An empty profile can start a suggested session without selecting exercises. A trainer log, effort rating, or a change to saved preferences can change the next suggested work.
8. Effort and notes persist through session editing and training backup/restore. Check-ins can save without reply, can change that local day’s recommendation, and remain private to the active profile.
9. Users can refine a workout preview repeatedly, accept the result, and save it to their schedule without choosing exercises. Adjusting a suggestion leaves saved workouts unchanged until the user saves the draft.
10. Chat retrieves recorded weights and session counts for the active profile, excluding examples and planned workouts. Trainer guidance and observations persist only after saving. Users can remove saved notes in Profile.
11. A new workout waits for readiness, records only confirmed sets, and resumes its current exercise and rest deadline after reload. Users can preview camera footage or an existing clip, upload it for feedback on the current exercise, and return to the same set while analysis runs.
