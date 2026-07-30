# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [13.1.2]

### Changed
- **Playback refreshes no longer rebuild the Dashboard / Playlists body when nothing they show changed.** `_flushUiRefresh` escalated every `playback`-depth refresh to a full preserve-UI body render on those two tabs, and an active scene fires one per music advance, per delayed environment start, and **twice** per scheduled one-shot (the trigger plus its duration follow-up timer) — a scene with three looping one-shots meant a ~6×/minute rebuild of the entire playlist/track list. The refresh now compares a **playback fingerprint** (`MinstrelManager.getPlaybackBodySignature` → `PlaylistManager.getPlaybackSignature`, captured in `getData` as `_renderedPlaybackSignature`) against live state and falls through to the existing targeted-DOM path (`refreshPlaybackChrome` + `refreshSceneTransportUi`) when they match, so the toolbar / now-playing chrome still updates. The fingerprint is scoped to the same document set the two bodies render — Minstrel-owned scene / cue-board / automation playlists excluded — which is what makes it effective: **scene layers play the `PlaylistSound` inside the scene playlist** (`buildSceneLayer` keeps the source only as `sourceTrackRef`), so scene playback never changes a row on either tab. Genuine changes (manual play/stop, channel stops, a scene going active/inactive) still render. Volume and `pausedTime` are deliberately excluded — they drift continuously during fades and were never rendered live.
- Diagnostics: `game.modules.get('coffee-pub-minstrel').minstrelDebug` exposes `renderStats` (`bodyRenders` / `bodyRendersSkipped` / `fullRenders`), `playbackSignature()`, `renderedPlaybackSignature()`, and `resetRenderStats()` for verifying the above from the console. Read-only; removed on shutdown.

## [13.1.1]

### Fixed
- **Pre-unlock scene operations crashed on the STOP phase:** Foundry core throws on **any** `PlaylistSound` document update while audio is locked (`_onUpdate` → `sync` → `_createSound`), and only the **play** paths awaited `ensureGameAudioUnlocked` — but `activateSoundScene` stops music/ambient tracks **before** it plays anything, so scene-start automation and playback normalization running before the first gesture died with "You may not call PlaylistSound#_createSound until after game audio is unlocked." (Previously this crash was buried in the awaited init chain; 13.1.0's fire-and-forget catch-up surfaced it.) New **`PlaylistManager.waitForAudioUnlock`** now gates **`activateSoundScene`**, **`stopActiveSoundScene`**, and the `syncActiveSceneFromPlayback` normalization timeout (which also gained its own error handling). Post-gesture these awaits are resolved no-ops; a UI-driven stop's triggering click is itself the unlocking gesture.

## [13.1.0]

### Added
- **Stop One-Shots** control on the window action bar, the Blacksmith menubar transport group, and the right-click sound menu: cancels the active scene's scheduled one-shot timers (recurring and pending "once" fires), then stops all interface/cue-channel audio — scene one-shots and triggered cues alike. Cue **duck-restore** timers are deliberately left running so music/environment volumes still un-duck. Cancelled timers stay cancelled until the scene is re-activated.
- **Toast feedback for every stop action** (Stop All / Stop Scene / Stop Music / Stop Environment / Stop One-Shots). Stop Scene names the scene it stopped ("Stopped sound scene "Horse Travel"."). All three surfaces (window, menubar, context menu) share one implementation via new **`MinstrelManager.stop*FromUi`** methods; automation-driven stops stay silent.
- **Persisted track durations:** probed durations are written to **`flags.coffee-pub-minstrel.durationSeconds`** on the `PlaylistSound` document (GM-only, one-time, fire-and-forget), so scene activation resolves durations from data instead of network-loading file metadata. Duration resolution is now **live buffer → persisted flag → `Audio()` probe (then persist)**; durations also self-populate as tracks play. New **`PlaylistManager.peekTrackDurationSeconds`** gives the scene editor a synchronous fast path so layer timelines lay out correctly on first paint instead of re-rendering when probes resolve. Scene playlist copies inherit the flag from their source sound.

### Changed
- **Coalesced window rendering:** `MinstrelManager.requestUiRefresh` no longer performs a synchronous full re-render per call. Requests accumulate and flush once on the next animation frame (with a **250ms timeout backstop**, since browsers pause rAF for hidden/unfocused windows); `full` depth dominates `playback` across a burst, and window/menubar flags OR together. Eight action handlers that rendered via a setter **and** a trailing `requestUiRefresh()` (save/delete cue, save/delete/duplicate rule, delete/duplicate scene, `_saveSoundSceneState`) now skip the redundant second render.
- **Debounced hook-driven cache invalidation:** the `create/update/deletePlaylist(Sound)` hooks now flush the derived-data caches through a **120ms trailing debounce with a 480ms max-wait ceiling** instead of nuking four caches per event — fades emit `updatePlaylistSound` bursts that previously forced repeated O(playlists × sounds) rebuilds. Safe because every internal write path already invalidates its own caches synchronously; the hooks matter only for external/socket-driven changes.
- **Stop semantics — "stop" means stop:** channel stop buttons are global mixer controls and now cancel the scene timers feeding their channel. **Stop Music** cancels the music-sequence timer (music no longer returned at the current track's end); **Stop Environment** cancels pending delayed-environment start timers (a delayed layer can no longer start after the stop); **Stop All** tears down the whole scene (`stopActiveSoundScene`) before sweeping remaining audio — previously it only stopped currently-playing sounds, so one-shots kept firing and the scene restarted at its loop point. Scheduled layer handles carry a **`layerType`** tag so per-channel cancellation is possible.
- **Recents persistence debounced:** `saveRecents` updates an in-memory memo immediately (UI reflects instantly) and coalesces the `game.settings.set` — a DB write plus socket broadcast to every client, previously fired on nearly every track start — behind a **2s trailing debounce**. Pending writes flush on module shutdown.
- **Memoized settings reads:** `getRecents` / `getFavorites` / `getFavoritePlaylists` sanitize once and serve from memo; own saves update the memo directly and an **`updateSetting`** hook invalidates it when another client writes. (`getPlaylistSummary` reads recents on every rebuild, so this removes a per-rebuild re-sanitize.)
- **Automation tab:** per-clause invariants (sorted Foundry scene list, Artificer habitat tag scan, calendar month options) are hoisted into a **`buildAutomationClauseSharedContext`** computed once per render and passed to every clause card — the tab was O(clauses × scenes) per render. The save-button dirty check (full form collection + stable-stringify of the rule) is now **debounced 150ms** instead of running per keystroke.
- **Dashboard data build:** single pass over scenes picks favorites and the active scene together; single pass over sounds only spreads the favorites — the old `flatMap` allocated a copy of **every** track in the library per rebuild.
- **`FilePicker`** uses the namespaced v13 implementation (`foundry.applications.apps.FilePicker.implementation`) with a legacy fallback.

### Fixed
- **Sound Scenes master timeline playhead frozen** (only "jumping" on playback events): the 1 Hz scene-clock ticker was wired to V1's `activateListeners`, which **ApplicationV2 never calls** — it only started if the window's first render was already on the Sound Scenes tab, and was previously masked by constant full re-renders. A proper **`_onRender`** override now re-syncs listeners and the ticker on every render/tab switch. (`activateListeners` kept as a deprecated shim; the automation save-button dirty refresh, also stranded there, now actually runs per render.)
- **Minstrel menubar items missing until the first click/keypress:** `initialize()` awaited **`AutomationManager.initialize()`** before registering the menubar, and automation's scene-start catch-up activates a sound scene gated on **`game.audio.unlock`** — which only resolves on the first user gesture. The entire init chain (menubar registration included) was held up until the user interacted, at which point the menubar appeared and the scene started simultaneously. UI integrations now register **before** automation, and the catch-up is **fire-and-forget** so module init completes regardless — the pending scene start simply begins when audio unlocks. Additionally, the coalesced UI flush gained a **250ms timeout backstop** (browsers pause rAF for hidden/unfocused windows), capping UI/menubar staleness while alt-tabbed at 250ms.
- **Memory-leak audit** (2-hour session slowdown pass) — module hygiene verified clean overall (no listener leaks, no detached-DOM retention, symmetric timer teardown); the real accumulators found were fixed:
  - **`activeCueRefs` leak:** a `stopOnSceneChange` cue whose duration couldn't be probed added its active ref but the only removal path required a probed duration — one stale ref per trigger until the next scene change. The cue-end cleanup timer now always schedules, with a 60s fallback window.
  - **`addActiveCueRef` dedup:** rapid re-triggers of the same cue no longer stack duplicate refs (same `isSameRef` guard as `addAmbientTrack`).
  - **Preview sounds** are now **`unload()`**-ed on stop, releasing the decoded `AudioBuffer` — previews are ad-hoc sounds nothing else reuses, so buffers previously sat in Foundry's audio cache for the session.
  - **Cue cooldown map** sweeps expired entries opportunistically instead of only on per-cue re-check.

## [13.0.8] - quick fix

## [13.0.7]

### Changed
- **Minstrel window buttons:** **`buildActionButton`** and static markup now use **`blacksmith-window-btn-primary`** / **`blacksmith-window-btn-secondary`** instead of **`blacksmith-window-template-btn-*`**, with matching CSS selectors, so button styling aligns with the shared Blacksmith window naming.

## [13.0.6]

### Fixed
- **Blacksmith timing (globals vs `module.api`):** **`Hooks.once('ready')`** can run before **`window.BlacksmithUtils`**, **`BlacksmithHookManager`**, and **`BlacksmithModuleManager`** are attached (they sync at **`markReadyForConsumers()`**, after Blacksmith’s asset work). Minstrel now **`import`s `BlacksmithAPI`** from the Blacksmith bridge and, when Coffee Pub Blacksmith is **active**, **`await BlacksmithAPI.waitForReady()`** at the **start** of `ready`—before **`registerModule`**, **`MinstrelManager.initialize()`** (automation hooks), and **`postConsoleAndNotification`**—matching the documented integration pattern.
- **Blacksmith null globals:** guards no longer use **`typeof X !== 'undefined'`** for those globals (**`typeof null === 'object'`**), which allowed **`null.postConsoleAndNotification`** and **`null.registerHook`** to throw. **`minstrel.js`**, **`manager-storage.js`**, and **`manager-automation.js`** now require **`typeof …?.method === 'function'`** (and **`unregisterHook`** is guarded on shutdown).

## [13.0.5]

### Added
- **Automation rule cards:** list rows match the cue-browser layout with a **power** control (upper-right; toggles **enabled** on save, highlighted when on—separate from opening the editor) and a **feather** button (same pattern as cues; opens the rule). Clicking the card body still selects the rule for editing. If that rule is already open, toggling power refreshes the editor draft so **Enabled** stays in sync. Disabled rules show **Off** in the meta line, muted card styling, and a dim power icon.
- **Automation triggers vs conditions:** rules now store **`triggers`** (OR’d — any match schedules evaluation) and **`conditionGroups`** (AND’d between groups). Inside each group, only the **per-row AND / OR / NOT** controls combine conditions (no separate group-level “All of / Any of” control). Legacy groups that used **Any of (OR)** with default row joins are normalized to explicit **OR** on those rows when rules load. New trigger types: **World Time** (in-game minute changes via `updateWorldTime`), **World Date** (calendar day changes), and **Manual** (editor Run — required to test from the UI).
- **`Hooks.on('updateWorldTime')`** (GM): fires automations that include the world time / world date triggers when the clock advances.

### Changed
- **Automation · rule ranking:** when several rules match the same event, **Importance** is evaluated first (**High** before any **Normal**, **Normal** before any **Low**). Within one tier, order is **most condition rows true right now**, then **specificity score**, then name. (Tie-breaking still does not use “more rows on the sheet” when runtime match count and specificity already tie.)

### Fixed
- **Initialization / audio unlock:** playlist playback (including scene activation and automation on load) now waits for **`game.audio.unlock`** before starting sounds. While audio is still locked, Minstrel no longer reads **`PlaylistSound#playing`** (it uses embedded **`_source.playing`** instead), since that getter can force **`_createSound`** and throw during `ready` even after `unlock` has resolved in some cases.
- **Automation · scene start on refresh/join:** Blacksmith **`canvasReady`** could fire while **`migrateLegacySettingsToPlaylists()`** was still awaiting, so hooks were not registered yet and **Scene → Start** never ran after a browser refresh (World Time also stayed silent until the minute changed). Hooks now register **before** any migration `await`, and a **catch-up** run fires scene-start automation if the canvas is already ready with an active scene.
- **Automation · Time of Day chains:** adding a second **Time of Day** row in the same group now defaults the connector to **OR** (new rows used to default **AND**, which made pairs like “midnight–6am” and “6pm–11:59pm” impossible and prevented night rules from ever matching).
- **Automation · world clock:** condition evaluation prefers **`game.time.components`** when hour/minute look like a normal clock (0–23 / 0–59), then falls back to `calendar.timeToComponents(worldTime)`.

### Changed
- **Automation · hints:** long section explanations moved from inline copy to **data-tooltip** on the **Automation Rules**, **Rule Editor**, **Triggers**, and **Conditions** titles (dotted underline + help cursor). 
- **Automation · rule editor contrast:** darker inset surface behind the editor body plus brighter trigger/condition cards, stronger borders, and light shadows so cards read clearly on the dark panel (automation workspace only).
- **Automation · precedence:** documented and surfaced in the UI — within one rule (triggers OR, groups AND, rows left-to-right); across rules, **Importance** tier first, then within tier by conditions matched, specificity, name; first successful action wins (sidebar list order is not execution order).
- **Automation · condition groups:** removed the group-level **Combine rows / All of / Any of** control so logic is only the **AND / OR / NOT** selectors between conditions. Old worlds that had **Any of (OR)** on the group with default row joins are upgraded to explicit **OR** on those rows when rules are loaded/sanitized.
- **Automation · Time of Day** clause: **dual range handles** on a **shared rail** with a highlighted **active window** segment (maroon track, green window, tan thumbs); layout driven by CSS custom properties updated from the live slider values.
- **Time of Day** range logic: the **end** handle may sit at minute **`1440`**, meaning **through the end of the day** (inclusive through **11:59 PM** world time); the **start** handle remains **`0..1439`**. `minutesInRange` treats **`end >= 1440`** like **`1439`** for inclusion, including **overnight** windows that wrap past midnight.
- **Time labels** and slider percentage math use a consistent **`0..1440`** domain for the control; **`formatAutomationMinutes(1440)`** displays **`11:59 PM`**.
- **Automation rule storage** clamps **`timeEndMinutes`** to **`0..1440`** when normalizing clauses from documents.
- **Automation migration:** legacy flat **`rules`** rows split into triggers (`combat` / `round` / `scene`) vs **condition** clauses in a single default group. **`automationSchemaVersion: 3`** — **Scene** triggers are only **start / end** (no scene picker on the trigger); **specific scene** and **name contains** are **conditions** only. Rules saved at v2 with `sceneId` on a scene trigger are **once** hoisted into a **Scene (specific document)** condition on load; re-save persists v3.
- **Play sound scene** automation: **no-op** (stops competing rules) if the target scene is **already** the active Minstrel sound scene.

## [13.0.4]

### Added
- **`PlaylistManager.stopAmbientTracksNotInKeySet`**: stops playing environment tracks whose ref is not in a desired `playlistId::soundId` set.
- **`PlaylistManager.stopPlaylistExcept`**: stops playing sounds in one playlist while preserving a list of track refs still meant to play.

### Changed
- **GM-only client**: Non–game-master users no longer register the Minstrel window, playlist cache hooks, automation, or Blacksmith integrations; `openWindow` and `requestUiRefresh` are no-ops for players (with a localized notice if the window entry point is invoked).
- **Toolbar metrics**: **Now Playing** and **Music** refresh on every playback chrome update; **Environment** and **Interface** show **layer names from the active sound scene definition** (not live track lists) and only rebuild when the active scene or its env/one-shot layers change; global env/interface volume sliders still update every playback pass via lightweight value sync.
- **Blacksmith menubar**: `renderMenubar` is **debounced (~350ms)** to coalesce bursty calls (`RuntimeManager.queueMenubarRender`).
- **Sound scene activation** stops all **music**, but only stops **ambients** that are not part of the newly activated scene’s environment layers (matched by track ref). Re-activating the **same** sound scene—e.g. automation matching again—can keep environment beds running without a gap; **music** and **scheduled one-shot** timing still reset from the start of the program, as designed.
- **Full sound scene cycle reset** tears down the scene playlist with **`stopPlaylistExcept`** instead of unconditionally stopping every sound, so immediate ambients that already match the scene can be preserved.
- **`PlaylistManager.playTrack`**: for exclusive **music**, if the same track is already playing, skip stop/restart and only apply volume, fade, and `pausedTime` updates.
- **`PlaylistManager.stopTrack`**, **`pauseTrack`**, and **`resumeTrack`**: skip work when the sound is already stopped, paused, or playing, to reduce redundant playlist/sound updates during playback.
- **Sound Scenes** tab: program-length master duration and staggered music segments on the transport timeline; scene clock ticking and refresh behavior narrowed to the Sound Scenes context where possible to cut UI churn.
- **Scheduled one-shot** rows on the scene layer timeline always use **event dots** (single fire or repeating), not duration bars; repeat positions reuse the same timing math as before without building segment widths for one-shots.
- **Sound Scenes** Music / Environment / One-Shot rows: **Move up** and **Move down** are stacked on the left **endcap** (shown on hover for fine pointers, always visible when hover is unavailable); the right-hand action strip is slightly narrower.

### Fixed
- **Blacksmith secondary bar / menubar “Now Playing”** after **automatic** sound-scene music advances: `requestSceneUiRefresh` previously skipped `refreshSecondaryBarState` and only debounced `renderMenubar`, so labels could stay on the prior layer while the Minstrel window updated. It now runs the same **playback** `requestUiRefresh` path as other controls (toolbar chrome + secondary bar + menubar).
- **Toolbar / menubar “now playing” music** no longer sticks on an earlier scene layer when **multiple** music `PlaylistSound`s still report `playing` (e.g. overlap): `collectPlayingState` now picks the track at the **active sound scene clock `musicIndex`** in program order instead of whichever sound was scanned last.
- **Scheduled one-shot** layers in sound scenes no longer stack overlapping re-triggers while a prior instance is still considered active, reducing duplicate cues and playlist-sound update churn.

## [13.0.3]

### Added
- Playlist-backed automation storage under `Minstrel / Automations`, with one playlist per automation rule.
- Automatic automation migration from the legacy hidden world setting into playlist-backed automation documents.
- Dedicated Minstrel playlist folder structure with themed colors:
  - `Minstrel`
  - `Minstrel / Sound Scenes`
  - `Minstrel / Cue Boards`
  - `Minstrel / Automations`
- A GM-only `Minstrel Audio Workbench` toolbar entry for both the Foundry and Coffee Pub toolbars.
- Automation categories with cue-style category selection/creation and grouped category sections in the automation browser.
- Automation icon/tint customization, duplication, and the new `Scene Name Contains` rule type.

### Changed
- Underlying Minstrel playlist names now use explicit prefixes to avoid export/import and compendium collisions:
  - `[SOUND SCENE] ...`
  - `[CUE] ...`
  - `[AUTOMATION] ...`
- Automation UI continues to show clean rule names from flags while the underlying playlist name carries the prefix.
- Dashboard was rebuilt around three racks:
  - `Sound Scene Rack`
  - `Playlist Rack`
  - `Cue Rack`
- Dashboard playlist rack now supports favorited playlists and favorited tracks together, with row-click playback matching the Playlists tab.
- Scene-facing terminology was updated to `Sound Scene` across the menubar, dashboard, scenes tab, automation targets, folder names, and playlist prefixes.
- Automation `Priority` was replaced by `Importance` with `High`, `Normal`, and `Low`.
- Automation editor structure was clarified with a dedicated `Action to Take` section separate from `Ordered Rules`.
- Scene editing now auto-saves layer mutations without restarting the active sound scene, while detail editing remains intentional.
- Scenes use a cycle-based transport model driven by the current music track, with delayed/repeating layers resetting against that cycle.
- Cue, automation, and dashboard cards were tightened into a more consistent shared card pattern, and cue/editor category handling now mirrors automation where appropriate.
- Playlist and track favorites now live on Foundry playlist/playlist-sound flags instead of hidden settings.

### Fixed
- Automation playlist names no longer collide with ordinary playlists during compendium export/import.
- Minstrel-owned automation playlists are now hidden from the Playlists tab alongside scene and cue-board playlists.
- Scene and cue playlists are now created in the correct `Minstrel` subfolders instead of the playlist root.
- Dashboard playlist actions were restored after layout regressions so play/stop and favorite controls are visible again.
- Slider styling was normalized further so cue and playlist sliders no longer pick up stray boxed input styling, and volume sliders now support double-click reset to `50%`.
- Scene load normalization is now GM-only so player clients do not attempt playlist mutations on startup.
- Scene music active-state display now follows the actual runtime music track instead of stale editor order or disabled rows.
- Scene layer ordering, layer adds, and live layer volume edits now persist correctly without knocking active playback out of sync.
- Delayed environment and one-shot timing now starts at the configured delay, repeats from that delay, and renders at the correct timeline offset.
- Environment repeating clips now render like repeating timeline segments, non-playing music rows are dimmed, and short clips render as dots instead of misleading bars.
- Hidden-tab refresh churn, typing focus theft, and search caret jumps were reduced by narrowing scene refresh behavior and filtering in place.
- Cue save/load now retains the selected source track, blocks save/trigger without a track, and browse/edit mode behavior is more stable.
- Automation operator persistence, `Any Active Sound Scene` stop targets, and match ordering behave correctly with the newer rule model.

## [13.0.2]

### Added
- A GM-only `Minstrel Audio Workbench` toolbar entry for both the Foundry and Coffee Pub toolbars.
- Multi-track scene music support with scene-level transport controls for previous/next track stepping.
- A master scene timeline row with a live scene clock and shared playhead.
- Dashboard racks for favorite scenes, favorite playlists/tracks, and favorite cues with per-rack search.
- Automation rule tint and icon fields, plus quick duplication from the rule editor.
- New automation rule type: `Scene Name Contains`.

### Changed
- Automation rule `Priority` is now `Importance` with `High`, `Normal`, and `Low` options instead of a free numeric field.
- Automation matching now favors the most specifically matching rule set instead of relying on raw numeric priority.
- Dashboard layout was rebuilt to match the connected pane style used elsewhere in Minstrel.
- Cue cards were aligned more closely with automation-card presentation and wrapping behavior.
- Playlist rows and dashboard playlist items now use the same stateful play/stop pattern instead of separate transport buttons.
- Playlist mode controls now use explicit Foundry playback modes with matching icons:
  - soundboard only
  - sequential playback
  - shuffle tracks
  - simultaneous playback
- Scene editing now auto-saves layer changes while keeping scene details as an intentional edit/save flow.
- Scene defaults now use `0s` fade in / `0s` fade out.
- Top header panels now use shared panel styling, shared slider styling, and centralized panel background image variables.
- Minstrel window sizing now enforces a minimum width of `1300` and minimum height of `750`.

### Fixed
- Active scene load normalization is now GM-only so player clients do not try to mutate playlists on startup.
- Scene playback state now normalizes correctly on load and scene play actions switch the editor to the selected scene.
- Scene music active-state display now follows the actual runtime music track instead of stale editor order or disabled rows.
- Scene layer reordering now persists correctly across save/reopen.
- Scene layer auto-save no longer restarts the active scene on every tweak.
- Scene layer volume changes no longer rewrite the whole scene and interrupt playback.
- Added scene layers now appear immediately while a scene is active.
- Delayed environment and one-shot timing now starts at the configured delay, repeats from that delay, and renders at the correct timeline offset.
- Environment repeating clips now render like repeating timeline segments instead of dim full-width beds.
- Non-playing music tracks are dimmed and only the active music track shows the live progress line.
- Short clips now render as dots instead of misleading oversized bars.
- Scene transport updates were narrowed to reduce focus stealing, hidden-tab churn, and typing lag.
- Search inputs for scenes, playlists, and scene sounds now filter in place without blowing away caret position.
- Cue save/load retains the selected source track and blocks save/trigger when no track is selected.
- Cue browser mode now hides the editor until explicitly opened, and cue save closes the editor.
- Cue category creation no longer creates an empty default cue sheet before save.
- Cue editor, playlist sliders, and shared range controls now use the same unboxed slider treatment.
- Cue and automation hover states were restored where recent style refactors had dropped them.
- Dashboard playlist rack actions, hover behavior, and click-to-play behavior now match the Playlists tab.
- Playlist filtering now hides playlist groups with no matching sounds when search/channel/status filters are active.
- `Any Active Scene` stop actions now save and execute correctly instead of falling back to a specific scene.
- Ordered automation clause operators now persist correctly instead of reverting `OR` back to `AND`.
- Scene source playlist names are now preserved separately from scene-owned playback tracks, though follow-up cleanup is still tracked in `documentation/todo.md`.

## [13.0.1]

### Added
- `documentation/performance.md` with ranked findings, progress tracking, and Blacksmith API usage notes.
- Selector caching and invalidation hooks for playlists, scenes, cues, and dashboard data.
- Blacksmith lifecycle cleanup for hooks, menubar tools, and secondary bar items.
- A public Blacksmith menubar context-menu wrapper so Minstrel no longer depends on private menubar internals.
- Scene read/edit mode, environment start-delay support, and delayed timeline offsets.
- Cue tinting, cue favorites on cards, cue-sheet selection, and shorthand Font Awesome icon handling.
- A first-pass ordered automation rules engine with clause reordering, `AND` / `OR` / `NOT`, Artificer habitat support, time-of-day ranges, and in-game date matching.

### Changed
- Window-state persistence is now throttled, global listeners are scoped to the window lifecycle, and playlist runtime sync is batched.
- Sound-scene saves now diff playlist sounds instead of deleting and recreating them.
- `MinstrelWindow.getData()` is now tab-aware to avoid rebuilding unrelated tab context on every render.
- Playlists, Scenes, Cues, Dashboard, and Automation were all refreshed to use cleaner card-first presentation, stateful play/stop controls, and more consistent icon-driven affordances.
- The secondary Minstrel menubar now uses GM-only access, left-click navigation, right-click favorites, and clearer scene/audio state.
- User-facing naming was restored to `Playlists`.

### Fixed
- Foundry compatibility warnings caused by deprecated globals:
  - `AudioHelper` -> `foundry.audio.AudioHelper`
  - `loadTemplates` -> `foundry.applications.handlebars.loadTemplates`
  - `renderTemplate` -> `foundry.applications.handlebars.renderTemplate`
- Cue save/load, validation, favorite-state, icon-state, and editor-layout regressions.
- Scene read-view image/background regressions and delayed one-shot timing behavior.
- Menubar scene/track labeling and favorite-environment flyout placement.
- Automation habitat selection, action targeting, and split-column scrolling.
- The global `Now Playing` panel now prefers active scene details, falls back cleanly, and clears stale cue state after cues finish naturally.



## [13.0.0] - Initial Build

### Added
- Initial Coffee Pub Minstrel module scaffold, manifest setup, release workflow wiring, localization root, and renamed entry script/module assets.
- Blacksmith ecosystem integration for:
  - Window API registration/opening
  - menubar tools, flyouts, and secondary controls
  - shared window shell and template styling
- World-backed Minstrel storage for:
  - favorites
  - recents
  - sound scenes
  - cues
  - automation rules
  - remembered window state and bounds
- Phase 1 MVP managers for playlists, sound scenes, cues, automation, runtime, and storage.
- Playlist browser with:
  - live search
  - channel/status filters
  - favorites and recents
  - play/pause/resume/stop controls
  - playlist favorites
- Sound Scene system with:
  - left-side scene browser
  - internal sound selector
  - right-side scene editor
  - scene card backgrounds
  - world favorites
  - save/play/stop/delete flows
  - scene-scoped background image browsing
  - clickable sound preview cards
- Playlist-backed Minstrel scene persistence using native Foundry playlists with Minstrel flags for scene metadata and scene track behavior.
- Playlist-backed Minstrel cue-board persistence using native Foundry playlists/sounds with Minstrel flags.
- Unified scene layer model supporting:
  - single music layer
  - multiple environment layers
  - scheduled one-shot layers
  - per-layer volume
  - loop/repeat behavior
  - enabled state
  - frequency for repeating one-shots
- Scene timeline visualization with:
  - proportional clip-length bars
  - type-colored lanes
  - start markers
  - event markers
  - repeat markers
  - repeated clip bars for looped one-shots
  - timeline tooltips
- Cue management and trigger support.
- Automation scaffolding for combat-linked scene transitions and playback restoration.
- Menubar quick-access flyouts for:
  - sound/environment favorites
  - favorite scenes
  - favorite playlists
  - favorite one-shots
- `migration.md` documenting the cutover from hidden settings-backed scene/cue storage to native playlist-backed Minstrel data.
- `todo.md` tracking future work such as:
  - time-of-day scene modes
  - real-time preview mode while editing scenes

### Changed
- Replaced prototype/example setup with `Coffee Pub Minstrel` naming, descriptions, release URLs, and module identifiers.
- Switched audio classification to Foundry core playlist sound audio channels instead of Minstrel-only inference.
- Moved scene/cue persistence off hidden settings arrays and onto real Foundry playlists flagged as Minstrel scenes and cue boards.
- Reworked the main Minstrel window to align more closely with Artificer/Blacksmith patterns:
  - cleaner pane headers
  - reduced custom button styling
  - shared footer/action treatment
  - icon-first filters and toggles
- Reworked the scene details header so restore/enabled/favorite controls live with the scene actions and all scene actions use the shared icon-action treatment.
- Reworked the scene detail form layout into a tighter editing grid with:
  - title
  - card background path/browser
  - tags
  - fade values
  - reduced-height description
- Rebuilt the Scene workspace into fixed-width `Scenes` and `Sounds` columns with a flexible editor column.
- Updated browser panes to use pinned controls with a single scrollable content region.
- Converted favorites from star icons to heart icons for Coffee Pub consistency.
- Renamed key menubar/window actions to clearer labels such as `Audio Workstation`, `Sound`, and `Stop Environment`.
- Moved primary transport controls into the bottom action bar layout and reduced low-value footer clutter.
- Improved scene/sound cards to use typed endcaps, tighter content-height rows, and clickable scene cards.
- Converted scene and sound browser card actions to the shared icon-action style.
- Updated scene-facing terminology to use `tracks` in the UI rather than `layers`.
- Replaced the top metrics strip with:
  - `Now Playing`
  - `Music Volume`
  - `Environment Volume`
  - `Interface Volume`
- Added global audio channel sliders in the top strip that resolve and update Foundry core audio settings at runtime.
- Added CSS variable-driven layout controls for scene workspace columns, playlist rows, and scene layer rows.
- Simplified playlist controls:
  - removed `Skip`
  - removed per-track `Pause` / `Resume`
  - replaced manual volume apply with auto-saving volume sliders
  - converted play/stop/favorite controls to the shared icon-action style
- Reworked playlist grouping and ordering so playlists sort alphabetically, same-name playlists separate by type, and sounds sort alphabetically within each playlist.
- Filtered Minstrel-owned playlists out of source-library views so scenes and cue boards do not recurse back into the playlist browser or sound selector.

### Fixed
- Fixed the `ApplicationV2.state` collision by moving Minstrel window UI state off the reserved `state` property.
- Fixed environment channel handling so environment tracks appear correctly in selectors and channel-specific actions.
- Fixed playlist filtering so channel-filtered views hide playlist groups with no matching sounds.
- Fixed search inputs so typing no longer jumps the caret back to the first position after rerenders.
- Fixed slider readouts so scene layer volume percentages update live.
- Fixed menubar/flyout behavior to use the intended Blacksmith context-menu and flyout patterns.
- Fixed scene browser card rendering and selection behavior.
- Fixed scene/sound browser cards so they no longer stretch vertically to fill column height.
- Fixed desktop layout regressions caused by unnecessary responsive overrides on structured track rows.
- Improved duration lookup reliability for timeline rendering with metadata fallback support.
- Fixed Foundry V12+ compatibility warning by switching deprecated `Sound#node` access to `Sound#sourceNode`.
- Fixed selector preview behavior so only one preview sound can play at a time.
- Fixed selector preview playback to audition locally at an audible preview volume.
- Fixed selector playing-state styling by tracking the active preview row and applying the playing class while the preview is active.
- Fixed scene/sound pane rerenders so selecting scenes or previewing sounds preserves scroll position instead of jumping back to the top.
- Fixed scene save behavior so saving an actively playing scene restarts that scene with the newly saved data.
- Removed stale settings-backed scene/cue registrations and dead storage methods so the codebase now matches the playlist-backed architecture.
