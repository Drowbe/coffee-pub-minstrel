# Minstrel Performance And Foundation Review

## Scope

Reviewed the current module with a focus on:

- Client-side slowdown risk during live sessions
- Memory leaks and timer/listener cleanup
- Excessive Foundry document writes and repeated full-data scans
- Blacksmith API usage, especially `HookManager`, window, and menubar integration

Initial review was based on `scripts/` as of 2026-03-19. **Re-reviewed** against the same tree on **2026-03-28** (line references below are anchors into that snapshot and may drift as the code changes).

## Executive Summary

The module does not show a catastrophic leak, but it still has patterns that can make clients feel slower during play:

- The main window still does meaningful work per refresh for the active tab (filters, cloning, and scene-layer presentation), even after tab-scoped `getData()` and selector caches.
- Scene activation and some flows still perform many sequential Playlist/PlaylistSound updates; runtime sync is batched in several paths (`_beginBatch` / `_endBatch`) but not eliminated.
- Global `document` listeners and Blacksmith hook/menubar cleanup issues called out in the original review are **addressed** in the current code (root-bound listeners, explicit shutdown).
- A few **fire-and-forget `setTimeout` calls** and one **GM debounce timeout** are not tied to module shutdown or full scene teardown, so a narrow class of “stray work after disable” remains possible (usually low impact).

If players reported slowdown, the most likely causes remain the Minstrel window’s render/data work for the active tab and Playlist document update volume during scene and cue activity.

## Current Findings (Stack Ranked)

| Rank | Severity | Area | Status |
| --- | --- | --- | --- |
| 1 | High | Window render/data rebuild cost in `MinstrelWindow.getData()` | Partial |
| 2 | High | Playback batch/update churn in playlist and scene activation paths | Partial |
| 3 | High | Window state persistence on frequent UI events | Fixed |
| 4 | Medium | Permanent global listener lifecycle in Minstrel window | Fixed |
| 5 | Medium | Sound scene full delete/recreate save behavior | Fixed |
| 6 | Medium | Blacksmith hook and menubar cleanup lifecycle | Fixed |
| 7 | Medium | Private Blacksmith `MenuBar._showMenubarContextMenu()` dependency | Fixed |
| 8 | Medium | Scheduled one-shot overlap/timer behavior | Fixed |
| 9 | Medium | Foundry `Hooks.on` playlist/sound invalidation — unregister on shutdown | Fixed |
| 10 | Low | Unbounded audio duration cache | Active |
| 11 | Low | Small repeated lookup/index inefficiencies | Partial |
| 12 | Low | GM `syncActiveSceneFromPlayback` debounce timeout not cleared on shutdown | Active |
| 13 | Low | Fire-and-forget timeouts (cues, scheduled-layer UI) | Active |

## Findings

### 1. High: Window position and search state are persisted too often

Files:

- `scripts/window-minstrel.js` (`_onPosition` ~927, `_queueWindowStateSave` / `_flushWindowStateSave` ~1006–1040, `_preClose` ~932)
- `scripts/manager-storage.js` (`saveWindowState` ~391)

Details:

- `_onPosition()` writes `bounds` to client settings on every position update.
- Search/filter handlers debounce to 250ms, but they still call `saveWindowState()` before every re-render.
- `saveWindowState()` reads the current setting object and writes back a merged copy every time.

Why it matters:

- Dragging/resizing a window can emit a lot of position updates.
- Repeated `game.settings.set()` calls are more expensive than local state changes and create avoidable persistence churn.
- This is one of the easiest ways to make the UI feel sticky.

Recommendation:

- Do not persist bounds on every `_onPosition()` call.
- Keep bounds in memory while dragging and persist only on close or on a throttled trailing save.
- Keep search/filter text in window memory and only persist it on close, tab change, or after a longer idle interval.

Progress:

- Fixed. Window state writes are now deferred/queued instead of writing on every position update and every immediate filter change.

### 2. High: `getData()` does repeated full scans and async work on every render

Files:

- `scripts/window-minstrel.js` (`getData` ~1592+; per-tab body context; `_getCachedTrackDurationSeconds` / `_sceneDurationSeconds`)
- `scripts/manager-playlists.js` (`selectorCache`, `getPlaylistSummary` ~362+, `getTrackOptions`, `invalidateCache` ~288+)
- `scripts/manager-soundscenes.js` (`getSoundScenes` / cache ~449+)
- `scripts/manager-cues.js` (cue cache / `getCue` ~191+)
- `scripts/manager-minstrel.js` (`getDashboardData`, `_dashboardCache` ~136+)

Details:

- `getData()` is **tab-scoped**: it builds payload for the active tab only, not every tab every time.
- The active tab still does non-trivial work: dashboard filters, playlist summary mapping/filtering, sound-scene lists and layer presentation, etc.
- Durations for scene layers use window-local caching (`_sceneDurationSeconds` / `_getCachedTrackDurationSeconds`); full `Promise.all` across every layer on each render is no longer the default path.
- Selector helpers (`PlaylistManager`, `SoundSceneManager`, `CueManager`) use invalidated caches when hooks fire; cache rebuilds still walk `game.playlists` when cold.

Why it matters:

- This is acceptable on a tiny world, but it scales poorly with playlist count and sound count.
- Any action that calls `requestUiRefresh()` can trigger another full rebuild.
- On lower-powered clients, this is a credible cause of the slowdown you observed.

Recommendation:

- Cache derived data and invalidate it from playlist/sound hooks instead of rebuilding everything on every render.
- Split the window into smaller refresh paths:
  - playback status refresh
  - filter refresh
  - selected scene editor refresh
- Cache layer duration lookups per `trackRef.path` and do not re-await them during every render once known.

Progress:

- Partial. Playlist, cue, scene, and dashboard selectors now cache and invalidate. `getData()` now builds only the active tab payload, and selected scene durations are lazy-loaded instead of awaited inline. The remaining work is further narrowing refresh paths and reducing full-window rerenders for small state changes.

### 3. High: Playback operations generate too many sequential updates and repeated runtime rescans

Files:

- `scripts/manager-playlists.js` (`_beginBatch` / `_endBatch` / `_queueRuntimeSync` ~292–311, `playTrack` ~490+, `stopTrack` ~525+, `stopLayer` ~587+, `stopAllAudio` ~611+)
- `scripts/manager-soundscenes.js` (`activateSoundScene` and layer playback ~300+)

Details:

- `stopLayer()` and `stopAllAudio()` wrap stops in `_beginBatch()` / `_endBatch()` so `stopTrack(..., { sync: false })` does not trigger a full `syncRuntimeLayers()` per track; one sync runs after the batch when `sync` is true.
- `playTrack()` still issues document updates per call; exclusive music still stops other music via `stopLayer(..., { sync: false })` inside the same batch patterns where used.
- `activateSoundScene()` still walks layers and performs sequential playback-related updates for ambients and scheduled layers.

Why it matters:

- The code repeatedly scans all playlists while already inside loops that are iterating over tracks.
- Foundry document updates are networked and can trigger downstream work on all connected clients.
- The current approach multiplies update cost during scene switches and mass stops.

Recommendation:

- Add an internal `suppressSync` option so `stopTrack()` and `playTrack()` can skip rescanning during batch operations.
- Rescan runtime state once after the batch completes.
- Where supported by Foundry, prefer batched embedded document updates over many single-sound `update()` calls.
- Avoid setting fields that did not actually change.

Progress:

- Partial. Runtime sync batching is implemented for multi-stop and restore paths (`_batchDepth`). Scene activation still performs sequential playback document operations and could be pushed further with more aggressive batching or GM-authoritative orchestration.

### 4. Medium: Global document listeners are permanent and never removed

Files:

- `scripts/window-minstrel.js` (`_attachRootListeners` / `_detachRootListeners` ~1042–1060, `_preClose` ~932)

Details:

- The window attaches `document`-level `input` and `change` listeners once.
- The listeners are never removed.
- They depend on `Ctor._ref` pointing at the current window instance.
- After closing the window, `Ctor._ref` still points at the old instance unless another window replaces it.

Why it matters:

- This is a small but real lifetime leak.
- More importantly, every document `input` and `change` event now passes through Minstrel’s capture listeners for the rest of the session.
- It also creates reload/disable fragility.

Recommendation:

- Bind listeners to the window/root element instead of `document`, or store bound handlers and remove them in `_preClose()`.
- Clear `Ctor._ref` on close.
- Avoid capture-phase global listeners unless there is no local alternative.

Progress:

- Fixed. Listeners are now attached to the window root and removed during close/rebind. A 250ms `setInterval` (`_sceneClockTicker`, ~1072–1083) updates the scene transport UI only while those listeners are attached; it is cleared in `_detachRootListeners`.

### 5. Medium: Sound scene save rewrites every embedded sound, even if only one layer changed

Files:

- `scripts/manager-soundscenes.js` (`saveSoundScene` ~487+; embedded sound diff/update vs delete/recreate ~551+)

Details:

- Saving a scene deletes all existing `PlaylistSound` documents, then recreates them from scratch.

Why it matters:

- This is simple, but it is expensive.
- It causes unnecessary database churn, invalidates document identity, and creates more work for connected clients.

Recommendation:

- Diff layers by id/source track and update only changed sounds.
- Create new sounds only for new layers and delete only removed layers.

Progress:

- Fixed. Scene save now diffs existing `PlaylistSound` documents and only updates/creates/deletes what changed.

### 6. Medium: Scheduled one-shot loops can overlap async playback work

Files:

- `scripts/manager-soundscenes.js` (`scheduleRecurringLayer`, `scheduleLayerTimeout` ~191–218; scheduled-layer `triggerPlayback` ~377+)

Details:

- Scheduled one-shots use `setTimeout()` then `setInterval()`.
- Each interval fires an async `triggerPlayback()` without an overlap guard.
- If playback/update work takes longer than the interval, calls can pile up.

Why it matters:

- This can create bursts of document writes and timing drift.
- It is a classic source of session degradation in long-running scenes.

Recommendation:

- Track an `isRunning` flag per scheduled layer and skip overlapping executions.
- Consider recursive `setTimeout()` instead of `setInterval()` so each run schedules the next one after completion.

Progress:

- Fixed. Scheduled one-shots now use self-scheduling timeouts with cancellation and in-flight guards instead of overlapping `setInterval()` work.

### 7. Low: Duration cache is unbounded

Files:

- `scripts/manager-playlists.js` (`durationCache` ~8–116, `getDurationSecondsFromPath`)

Details:

- `durationCache` never expires entries.

Why it matters:

- In a normal campaign this may stay small, but over time a module that previews or inspects many unique audio files can retain unnecessary entries for the life of the client.

Recommendation:

- Use a simple LRU or cap the cache size.
- Clear cached entries when playlists are deleted or when the module is disabled.

Progress:

- Active. The cache is still unbounded.

### 8. Low: Some lookups are recomputed repeatedly instead of pre-indexed

Files:

- `scripts/window-minstrel.js` (`resolveCoreAudioSettingKey` / `coreAudioSettingKeyCache` ~14–66; `getData` playlist/scene filtering ~1635+)
- `scripts/manager-playlists.js` (`getPlaylistSummary` and related)
- `scripts/manager-minstrel.js` (dashboard assembly)

Details:

- Favorites/recents are pre-indexed in `getPlaylistSummary()` via a `Set` of recent keys; other UI paths may still do linear scans where data is not cached.
- Track options and filtered lists for the scene picker are rebuilt when the sound-scenes tab renders.
- Core audio setting keys: the **first** resolution per channel may scan `game.settings.settings` for `core.*` keys; results are stored in `coreAudioSettingKeyCache` (~14–66 in `window-minstrel.js`), so repeat lookups are cheap.

Why it matters:

- Each instance is small, but together they add steady overhead to a window that already rebuilds too much.

Recommendation:

- Precompute `Set`s and `Map`s where the UI still rescans large lists on each render.
- Keep core setting key resolution session-cached (already done per channel).

Progress:

- Partial. Favorites/recents benefit from selector cache and `Set` indexing in playlist summary; core audio keys are cached per channel. Some per-render filtering/mapping in `getData()` remains.

### 9. Medium (lifecycle): Foundry document hooks for selector-cache invalidation

Files:

- `scripts/manager-minstrel.js` (`registerCacheInvalidationHooks` / `unregisterCacheInvalidationHooks` ~111–136)
- `scripts/minstrel.js` (`disableModule` → `MinstrelManager.shutdown()` ~57–59)

Details:

- On `initialize()`, Minstrel registers `Hooks.on` for `createPlaylist`, `updatePlaylist`, `deletePlaylist`, `createPlaylistSound`, `updatePlaylistSound`, and `deletePlaylistSound`, each calling `invalidateDerivedData()` (playlist/cue/scene caches and dashboard snapshot).

Why it matters:

- If these were left registered after disable/reload, every playlist mutation would keep doing Minstrel work and could interact badly with a partial teardown.

Progress:

- Fixed. `shutdown()` calls `unregisterCacheInvalidationHooks()`, which pairs each registration with `Hooks.off`.

### 10. Low: GM `syncActiveSceneFromPlayback` debounce timeout not cleared on shutdown

Files:

- `scripts/manager-minstrel.js` (`syncActiveSceneFromPlayback`, `setTimeout` via `_sceneNormalizationTimeoutId` ~162–168; `shutdown` ~72–83)

Details:

- When playback implies an active sound scene, a zero-delay (debounced) timeout may call `stopPlaylist` / `activateSoundScene` / `requestUiRefresh`.
- `shutdown()` does not `clearTimeout` this id, unlike the window’s own timers in `_preClose`.

Why it matters:

- If the module is disabled immediately after that timeout is scheduled, a callback can still run once against code or world state that is mid-teardown. This is narrow but real; it is not a growing leak.

Recommendation:

- Clear `_sceneNormalizationTimeoutId` in `shutdown()` (and optionally when starting a new normalization).

Progress:

- Active.

### 11. Low: Fire-and-forget `setTimeout` calls (cues and scheduled layers)

Files:

- `scripts/manager-cues.js` (`triggerCue`: duck restore ~291–294; cue completion / UI refresh ~302–312)
- `scripts/manager-soundscenes.js` (scheduled-layer `triggerPlayback`: layer inactive + UI refresh ~388–391)

Details:

- These timers are not stored on handles that `clearScheduledHandles()` clears. Stopping a scene clears the main scheduled-layer chain, but an in-flight `triggerPlayback` can still schedule the inner “mark inactive” timeout.
- Cue ducking and post-cue UI refresh use bare `window.setTimeout` with no module-level cancellation.

Why it matters:

- Not a classic retained-memory leak; risk is **stale callbacks** (extra `syncRuntimeLayers`, menubar refresh, or layer activity bookkeeping) after the user expected everything to stop, plus rare oddity on module disable.

Recommendation:

- Track ids on `RuntimeManager` or layer handles and clear them in `SoundSceneManager` / cue stop paths and `MinstrelManager.shutdown()`.

Progress:

- Active.

## Blacksmith API Review

### HookManager usage needs cleanup on disable/reload

Files:

- `scripts/manager-automation.js` (`initialize` / `shutdown` / `_hookIds` ~467–556)
- `scripts/minstrel.js` (`disableModule` ~57–59)
- `../coffee-pub-blacksmith/scripts/manager-hooks.js` (reference only; path outside this repo)

Assessment (historical):

- Earlier builds registered Blacksmith automation hooks without unregistering on disable, which could duplicate work after reload.

Current behavior:

- `initialize()` registers several hooks (`combatStart`, `updateCombat`, `deleteCombat`, `canvasTearDown`, `canvasReady`) and stores `callbackId` values.
- `shutdown()` calls `BlacksmithHookManager.unregisterHook` for each and clears `_hookIds`.

Progress:

- Fixed.

### Menubar integration is registered, but not fully unregistered

Files:

- `scripts/manager-minstrel.js` (`registerMenubarIntegration` / `unregisterMenubarIntegration` ~182+; `SECONDARY_BAR_ITEM_IDS` ~41–54)
- `scripts/minstrel.js` (`disableModule` ~57–59)
- `../coffee-pub-blacksmith/scripts/api-menubar.js` (reference only)

Assessment (historical):

- Earlier builds did not remove menubar tools and secondary bar items on disable.

Progress:

- Fixed for current public cleanup points. Tools and secondary bar items are explicitly removed in `unregisterMenubarIntegration()`.
- Partial at API level. There is still no public unregister path for the secondary bar type/tool mapping itself, so cleanup can only go as far as Blacksmith currently exposes.

### Direct use of `MenuBar._showMenubarContextMenu()` relies on a private API

Files:

- `scripts/manager-minstrel.js` (`blacksmith?.showMenubarContextMenu` ~487)
- `../coffee-pub-blacksmith/scripts/api-menubar.js` (reference only)

Assessment (historical):

- Minstrel previously called a private `MenuBar` helper for context menus.

Progress:

- Fixed. Minstrel uses the public `showMenubarContextMenu()` API on the Blacksmith API object when present.

### Window API usage looks acceptable

Files:

- `scripts/manager-minstrel.js` (`registerWindowIntegration`, `_openWindowInstance`)
- `../coffee-pub-blacksmith/scripts/api-windows.js` (reference only)

Assessment:

- `registerWindow()` and `openWindow()` are used correctly.
- The module keeps a singleton `windowRef` and falls back cleanly if the Blacksmith API is unavailable.

Concern:

- The main issue here is not API misuse; it is that the window does too much work per render.

### SocketManager is not currently misused, but also not meaningfully used

Assessment:

- I did not find Minstrel-specific socket usage.
- That is not automatically wrong. The module currently relies on Foundry Playlist document updates, which already replicate to clients.

Recommendation:

- Do not add `SocketManager` just to “use more Blacksmith”.
- Add sockets only if you move to a lighter authoritative flow, for example:
  - non-GM clients request an action
  - GM validates and performs the actual Playlist update
  - clients receive a lightweight UI state refresh event

Right now, the main performance problem is too many document updates and too much recomputation, not lack of sockets.

Progress:

- No change needed yet. This remains an architectural option, not an active misuse.

## Highest-Value Refactors

Remaining work with the best payoff (current codebase as of 2026-03-28):

1. Narrow `getData()` / refresh paths further so small UI state changes do not remap large lists or reclone whole drafts when unnecessary.
2. Reduce sequential Playlist/PlaylistSound updates during `activateSoundScene` and similar flows (batching, skip no-op updates, GM-orchestrated paths).
3. Cap or LRU the audio `durationCache` and clear it on disable if desired.
4. Clear `_sceneNormalizationTimeoutId` on shutdown; optionally track and clear cue/scheduled-layer fire-and-forget timeouts.

Already largely addressed in tree: deferred window state saves, root-scoped DOM listeners with teardown, selector caches + Foundry hook invalidation, playlist runtime sync batching, sound-scene save diffing, Blacksmith hook and menubar item cleanup, scheduled-layer overlap guards.

## Suggested Instrumentation

To validate improvements, measure:

- Time spent in `MinstrelWindow.getData()`
- Number of `game.settings.set()` calls while dragging/searching
- Number of `PlaylistSound.update()` calls during scene activation
- Number of full menubar/window re-renders per user action

Even simple `console.time()`/`console.timeEnd()` around those paths will quickly show which changes buy the most.

## Bottom Line

The most likely cause of perceived slowdown is not a single dramatic memory leak. It is accumulated UI and document-update overhead: tab-scoped `getData()` work, cold-cache rebuilds, and playlist document churn during scenes and cues. Listener and Blacksmith registration cleanup are in much better shape than in the original review.

Residual risks are **small**: unbounded `durationCache`, a few **uncleared timers** on disable or mid-flight scene stop, and the usual cost of many Foundry document updates during playback changes.

The module remains in a good place to harden; the biggest wins are still mostly architectural (fewer updates, narrower refresh) rather than invasive.
