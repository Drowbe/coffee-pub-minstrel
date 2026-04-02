# TODO

## Recently addressed (keep for context; remove when stale)

- **Playback labels in sync:** Multi-music overlap no longer picks the wrong track (`collectPlayingState` + scene clock `musicIndex`). Automatic scene music advances call the same playback `requestUiRefresh` path as manual actions so the Blacksmith secondary bar / menubar stay aligned with the window (`SoundSceneManager.registerPlaybackChromeRefreshHandler`).
- **GM-only client:** Non–GMs do not register the window, hooks, automation, or Blacksmith integrations; `openWindow` / `requestUiRefresh` are no-ops for players.
- **Menubar transport:** “Restore” removed from the secondary bar; **Restart Last Scene** re-runs the last activated sound scene (`lastActivatedSoundSceneId`). Window **Restore** (previous playback snapshot) remains on the lower-left action bar.
- **Menubar copy / icons:** Left zone uses “Sound Scene:” / “Now Playing:”; transport buttons use full “Stop …” labels and matching Font Awesome icons; window bottom-right action bar includes **Stop Scene** plus the same stop row.
- **Sound Scenes master transport (no full body on tick):** `_updateSceneClockDisplay` (1 Hz while the tab is active) patches the DOM for master elapsed/duration, master playhead, and active-music row styling; `requestUiRefresh({ windowRefreshDepth: 'playback' })` on this tab refreshes toolbar + that transport pass without re-running the tab body `getData()`.

---

## Performance / UI refresh backlog

_Open items below; see `documentation/performance.md` for the full write-up and file anchors._

- **Sound Scenes tab (remaining):** **Per-layer** timeline bars and in-row duration labels still come from `getData()` / templates and only move on full or preserve-UI render. **Next step:** patch those elements live (reuse timeline math, read playback position from `PlaylistSound` / audio where reliable)—rough **0.5–1 day** for music rows; env/one-shot optional extra. **Optional:** after async track durations resolve, replace debounced `refreshPreservingUi()` with a narrower DOM/layout patch so segment widths update without a full preserve pass.
- **Dashboard tab:** Lazy-invalidate `getDashboardData()` / refresh favorite lists when the Dashboard tab is focused, or debounce invalidation after bulk playlist/world updates.
- **Playlists tab:** Defer or debounce heavy `getPlaylistSummary()` work until the Playlists tab is shown (or after a short idle) so background playback does not rebuild large lists unnecessarily.
- **Redundant surfaces:** Further consolidate if profiling shows duplicate work—toolbar, secondary bar, and tab bodies now share `getHeaderPlaybackContext()` / `syncRuntimeLayers` and scene-driven refresh goes through `requestUiRefresh({ windowRefreshDepth: 'playback' })`; optional follow-up: throttle or gate `refreshSecondaryBarState` similarly to debounced menubar render if it shows up hot.

---

## Feature / product backlog

- **Time-of-day scene variants (dawn / day / dusk / night):** **Already shipped (automation):** a **Time of Day** rule clause exists (`type: timeOfDay`, minute range `timeStartMinutes` / `timeEndMinutes`, evaluated in `manager-automation.js` against world time; UI range control in the Automation tab). **Not shipped:** multiple **layer programs inside one sound scene** (variants) plus an action field to **start that scene in a chosen variant**—today you only get one layer stack per scene, so dawn/day/dusk/night either means duplicate scene documents or future variant storage + `activateSoundScene(id, { variant })`.
  - **Natural fit:** Reuse the existing **Time of Day** (and scene/habitat) clauses as **conditions**; add **variant** on the “start sound scene” action (or equivalent) so one scene ID can map to different layer sets without four duplicate scenes.
  - **LOE ~3–7 dev-days MVP** (variant data + editor + action field + runtime branch), **~1.5–3+ weeks** polished (partial overrides, transitions, dashboard/favorites, docs). Automation **condition** work is **not** part of that estimate—it’s already there.
- Add a preview mode for scenes so changes can be heard in real time while editing, such as live volume adjustments.
- Fix scene-layer source playlist labeling so rows show the original source playlist, not the Minstrel scene playlist, which is currently useless for finding similar sounds.
- Pull HTML out of JavaScript so JS is responsible for data and templates are responsible for markup.
- Leverage Handlebars partials so the template structure stays modular instead of turning into a Frankenstein template.
- Simplify CSS so we stop creating one-off classes for every individual element.
- Split CSS by feature/location so styles live near the UI they belong to instead of growing one mega-CSS file.
- Group and label CSS sections clearly so it is obvious what each block of styles is for.
- Untangle the cue/automation/card-class overlap so we stop multiclassing unrelated components just to approximate the same UI.
- Expand automations beyond scenes so rules can trigger other Minstrel actions and systems.
- Add automation support for triggering a cue from a matching string in chat or a specific dice roll.
