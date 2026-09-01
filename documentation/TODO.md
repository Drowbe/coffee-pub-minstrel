# TODO

**Audience:** us, while the work is outstanding.

The single source of truth for what Minstrel will do. Completed items are deleted and live only in the
CHANGELOG.

## Performance and rendering

- **Targeted playback row updates on Dashboard and Playlists.** A playback change on those two tabs
  still escalates to a full body render. Step 1 shipped: a playback fingerprint skips the render when
  nothing those tabs show has changed, which covers every scene-driven event. Step 2: add a
  `refreshPlaybackRows()` updater so a genuine change patches rows instead of rebuilding the list --
  per row only `minstrel-track-row-playing`, the `statusLabel` text, and the play/stop button's
  `data-action`/`title`/icon, plus the group header's `-playing` class, `. Playing` suffix and button.
  Rows are addressable via `data-value="playlistId::soundId"`; add `data-track-value` to the row
  element. Then delete the `bodyEncodesPlayback` branch.
  Touches `scripts/window-minstrel.js`, `scripts/manager-minstrel.js`.
  Verified by: play and stop a track from each tab with a scene running; `minstrelDebug.renderStats`
  shows `bodyRenders` staying flat while rows still update.

- **Per-layer timeline bars on the Sound Scenes tab.** Layer bars and in-row duration labels come from
  `getData()` and only move on a full or preserve-UI render. Patch them live, reusing the timeline
  maths and reading playback position from the `PlaylistSound`.
  Touches `scripts/window-minstrel.js`.
  Verified by: watch a multi-layer scene for one full music cycle; bars advance without the body
  re-rendering.

- **Throttle `refreshSecondaryBarState` if profiling shows it hot.** Optional follow-up; the menubar
  render is already debounced and this one is not.
  Touches `scripts/manager-minstrel.js`.
  Verified by: profile a running scene and compare before and after.

## Defects

- **The track volume icon never gets `is-playing`.**
  `templates/partials/window-minstrel-body.hbs` around line 177 tests `{{#if this.isPlaying}}`, but
  `getPlaylistSummary` emits `playing`. Fix alongside the targeted row updater above, since it is the
  same row state.
  Verified by: play a track and confirm the volume icon changes state.

## Features

- **Scene variants for time of day.** One scene id mapping to different layer sets (dawn, day, dusk,
  night) instead of four duplicate scene documents. Needs variant storage, an editor, a variant field
  on the start action, and a runtime branch in `activateSoundScene(id, { variant })`. The Time of Day
  and habitat condition clauses already exist and are not part of this work.
  Touches `scripts/manager-soundscenes.js`, `scripts/window-minstrel.js`, `scripts/manager-storage.js`.
  Verified by: one scene with two variants; automation starts the right one at each time of day.

- **Delay before the first play of environment and one-shot loops**, so a scene's layers do not all
  start together.
  Touches `scripts/manager-soundscenes.js`.
  Verified by: a scene with three delayed layers staggers on activation, not just on repeat.

- **Fade in and out per environment layer in a scene.**
  Touches `scripts/manager-soundscenes.js`, `scripts/window-minstrel.js`.

- **Scene preview mode**, so edits can be heard live while editing, including volume changes.
  Touches `scripts/window-minstrel.js`, `scripts/manager-playlists.js`.

- **Scene layer rows show the source playlist, not the Minstrel scene playlist.** A layer keeps its
  origin in `layerMeta.sourceTrackRef`; the row renders the copy's parent instead, which is useless
  for finding similar sounds.
  Touches `scripts/window-minstrel.js`.
  Verified by: a scene layer row names the library playlist it came from.

- **Make recents discoverable, or remove them.** Recents surface only as the clock icon filter on the
  Playlists tab. Either add a Dashboard rack (the data already flows through the dashboard cache) or
  drop the feature and its per-play settings write.
  Touches `scripts/manager-minstrel.js`, `scripts/manager-storage.js`.

- **Automation beyond scenes:** rules that trigger other Minstrel actions, and a rule that fires a cue
  from a matching chat string or a specific dice roll.
  Touches `scripts/manager-automation.js`.

## Documentation and structure

- **Write `userguides/userguide-settings.md`.** Every setting by its on-screen name, what it does, who
  it affects. Held until the settings rework, if one is coming; otherwise owed.

- **Product screenshots in `documentation/assets/`.** `home.md` and the README both need one. WebP,
  named `product-`.

## Code structure

- Pull HTML out of JavaScript so JS produces data and templates produce markup.
- Use Handlebars partials so the template stays modular.
- Simplify CSS: reusable classes rather than a one-off class per element.
- Split CSS by feature so styles live near the UI they belong to.
- Group and label CSS sections.
- Untangle the cue, automation and card class overlap so unrelated components stop sharing classes to
  approximate the same look.
