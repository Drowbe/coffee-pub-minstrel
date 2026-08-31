# TODO

## Recently addressed (keep for context; remove when stale)

- **Playback labels in sync:** Multi-music overlap no longer picks the wrong track (`collectPlayingState` + scene clock `musicIndex`). Automatic scene music advances call the same playback `requestUiRefresh` path as manual actions so the Blacksmith secondary bar / menubar stay aligned with the window (`SoundSceneManager.registerPlaybackChromeRefreshHandler`).
- **GM-only client:** Non–GMs do not register the window, hooks, automation, or Blacksmith integrations; `openWindow` / `requestUiRefresh` are no-ops for players.
- **Menubar transport:** “Restore” removed from the secondary bar; **Restart Last Scene** re-runs the last activated sound scene (`lastActivatedSoundSceneId`). Window **Restore** (previous playback snapshot) remains on the lower-left action bar.
- **Menubar copy / icons:** Left zone uses “Sound Scene:” / “Now Playing:”; transport buttons use full “Stop …” labels and matching Font Awesome icons; window bottom-right action bar includes **Stop Scene** plus the same stop row.
- **Sound Scenes master transport (no full body on tick):** `_updateSceneClockDisplay` (1 Hz while the tab is active) patches the DOM for master elapsed/duration, master playhead, and active-music row styling; `requestUiRefresh({ windowRefreshDepth: 'playback' })` on this tab refreshes toolbar + that transport pass without re-running the tab body `getData()`.
- **Scene habitat now reads from Blacksmith, not Artificer** (2026-08-31, 13.1.5). `getSceneHabitats` calls `api.geography.getHabitats(scene)`; Blacksmith owns the vocabulary and ran the migration off `flags.coffee-pub-artificer.scene.habitats`. The `isArtificerAvailable()` gate turned out to sit on **four** surfaces, not one — reader, dropdown builder, `getData` context flag, and the Handlebars template, which rendered the habitat `<select>` disabled with an "install Artificer" tooltip. Verified with Artificer disabled: `getHabitats` returns canonical keys and automation fires. `module.json` pins Blacksmith `minimum: 13.22.0`, so **Minstrel will not activate until Blacksmith tags that release**.
  - _Lesson worth keeping:_ three sessions across the suite reported this feature's blast radius short on the same day, each by narrowing before counting (a `head`, a `grep -v`, a partial read). Count occurrences first, and count **across file types** — the fourth gate was in a `.hbs` and no `*.js` sweep could ever have found it.

---

## Performance / UI refresh backlog

_Open items below; see `documentation/performance.md` for the full write-up and file anchors._

- **Sound Scenes tab (remaining):** **Per-layer** timeline bars and in-row duration labels still come from `getData()` / templates and only move on full or preserve-UI render. **Next step:** patch those elements live (reuse timeline math, read playback position from `PlaylistSound` / audio where reliable)—rough **0.5–1 day** for music rows; env/one-shot optional extra. **Optional:** after async track durations resolve, replace debounced `refreshPreservingUi()` with a narrower DOM/layout patch so segment widths update without a full preserve pass.
- **Dashboard / Playlists playback renders — step 1 shipped, step 2 open.** `_flushUiRefresh` used to escalate *every* `playback`-depth refresh to a full body render on those two tabs; an active scene fires one per music advance, per delayed environment start, and twice per scheduled one-shot. A playback fingerprint (`MinstrelManager.getPlaybackBodySignature`, captured in `getData` as `_renderedPlaybackSignature`, compared in `_flushUiRefresh`) now downgrades the no-op cases to `refreshPlaybackChrome` + `refreshSceneTransportUi`. Because it is scoped to non-Minstrel-owned playlists — scene layers play the `PlaylistSound` *inside* the scene playlist — all scene-driven events skip. **Step 2:** a `refreshPlaybackRows()` targeted updater for the genuine changes (manual play/stop, channel stops), after which the `bodyEncodesPlayback` branch can go away. Row state is just the row class, `statusLabel`, and the play/stop button; rows key off `data-value="playlistId::soundId"`.
  - _Known trade-off:_ a playback event no longer incidentally repaints unrelated external document edits (another client renaming a track). Those were never guaranteed to repaint — the `create/update/delete` hooks only invalidate caches, they never rendered — so this is narrower, not broken.
- **Deliberately not done:** deferring `getPlaylistSummary()` / `getDashboardData()` "until the tab is shown." Already true — `getData` branches on the active tab and only calls the builder for it. Nothing rebuilds those lists while another tab is open.
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
