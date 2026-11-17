# Form review adjudication

The November 15 evaluation used GPT-5.4 mini. Its two independent clips were clean controls. Use its archived results to reproduce regression cases and record the known single-lift glute bridge miss. Treat new fault coverage and production-model comparisons as separate studies.

## Prepare a blind review

Select approved public, synthetic, or explicitly consented footage with cleared rights for provider transfer. Before the run, have two trainers independently label the visible exercise and variation, whether a useful assessment is possible, the clearest coachable correction or strength, and two timestamps that support the label. Record disagreements and resolve them without showing the app’s result. Use neutral clip IDs. Keep identifying metadata and unnecessary audio out of fixtures. Check that any masking leaves joints and supports visible.

Include clearly visible faults, clean controls, similar-looking exercises, limited or cropped views, and a clip segment that starts after a setup or interruption. Include repeated and single-rep cases and vary body types, camera angles, and exercise equipment where footage permits. Use distinct performers or source recordings for the held-out round. Mirror, crop, or compress copies to test robustness and group them with the originals when calculating coverage.

Use a manifest matching `tests/fixtures/form-eval.json`. The `exercise` in a selected-mode case is the exercise selected by the user, which can be intentionally incorrect. In a detected-mode case, use the visible exercise ID and record unclear or out-of-catalog controls separately as exploratory. Put trainer-graded visual cues outside the coded checks in `exploratory` cases and adjudicate their saved observations independently. Set `startSeconds` where the analysis should start after an interruption or setup.

## Run the same pipeline as the app

Record the source revision, resolver and review version, configured model IDs, pose model checksum, FFmpeg version, and test-device details. Keep the model settings and media fixed across a comparison. The production-pipeline flag uses the app’s configured detection, critique, and reference models and reasoning settings. It uses the same sampling, pose measurements, evidence filters, and reference matching. It saves findings and fingerprints without copying cited user images into the report.

```sh
npm run eval:form -- --preflight --manifest /path/to/holdout.json --clips /path/to/prepared --disjoint-from /path/to/earlier-report.json --output .data/form-holdout-preflight.json
npm run eval:form -- --live --production-pipeline selected --manifest /path/to/holdout.json --clips /path/to/prepared --repeat 2 --strict --output .data/form-holdout-selected.json
npm run eval:form -- --live --production-pipeline detected --manifest /path/to/detection-holdout.json --clips /path/to/prepared --repeat 2 --strict --output .data/form-holdout-detected.json
```

The last two commands send sampled stills and any eligible cited still to the configured provider. Run them only with cleared fixtures and authorization for live usage. Use the web upload preview with a mock provider to check the selected start, private-only save, timestamp links, and cue handoff.

## Score the outcomes

- Score exercise identity independently from technique. Record exact matches, wrong variations, and no-match abstentions. For a manually selected mismatch case, record whether feedback was withheld.
- For fault and clean cases, record verified useful cues, unsupported cues, missed useful corrections, and abstentions. Check that both cited timestamps actually demonstrate the finding and that a matched reference shows the same phase and relevant body parts.
- For limited-view cases, record whether the app describes an actionable camera change or section to capture next. Record response time and provider errors separately from assessment quality.
- Summarize counts by movement, view, and capture type. Report denominators and variation across repeated trials. Count one recording once per held-out coverage summary. Report the number of reviewed cues followed by a deliberate retest when running a trainer-observed pilot.
