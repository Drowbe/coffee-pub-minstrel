# Minstrel Performance And Foundation Review

## Scope

Reviewed the current module with a focus on:

- Client-side slowdown risk during live sessions
- Memory leaks and timer/listener cleanup
- Excessive Foundry document writes and repeated full-data scans
- Blacksmith integration surfaces that still have open lifecycle or API gaps

Initial review was based on `scripts/` as of 2026-03-19. **Re-reviewed** against the same tree on **2026-03-28** (line references below are anchors into that snapshot and may drift as the code changes).

**Progress (implementation):** 2026-03-28 — Finding **#1** (partial): non-dashboard tabs no longer call `getDashboardData()` for window chrome; `getHeaderPlaybackContext()` + `refreshSecondaryBarState()` use a minimal playback/active-scene snapshot (see Finding 1).

## Executive Summary

The module does not show a catastrophic leak, but it still has patterns that can make clients feel slower during play:

- The main window still does meaningful work per refresh for the **active tab body** (filters, cloning, scene-layer presentation). **Dashboard favorites** (`getDashboardData`) are no longer rebuilt on every refresh when another tab is active; header chrome uses `getHeaderPlaybackContext()` instead.
- Scene activation and some flows still perform many sequential Playlist/PlaylistSound updates; runtime sync is batched in several paths (`_beginBatch` / `_endBatch`) but not eliminated.
- A few **fire-and-forget `setTimeout` calls** and one **GM debounce timeout** are not tied to module shutdown or full scene teardown, so a narrow class of “stray work after disable” remains possible (usually low impact).

If players reported slowdown, the most likely causes remain the Minstrel window’s render/data work for the active tab and Playlist document update volume during scene and cue activity.

## Open Findings (Stack Ranked)

| Rank | Severity | Area | Status |
| --- | --- | --- | --- |
| 1 | High | Window render/data rebuild cost in `MinstrelWindow.getData()` | Partial |
| 2 | High | Playback batch/update churn in playlist and scene activation paths | Partial |
| 3 | Low | Unbounded audio duration cache | Active |
| 4 | Low | Small repeated lookup/index inefficiencies | Partial |
| 5 | Low | GM `syncActiveSceneFromPlayback` debounce timeout not cleared on shutdown | Active |
| 6 | Low | Fire-and-forget timeouts (cues, scheduled-layer UI) | Active |
| 7 | Medium | Blacksmith secondary bar type / tool mapping — no public unregister | Partial |

## Findings

### 1. High: `getData()` does repeated work on each render for the active tab

Files:

- `scripts/window-minstrel.js` (`getData` ~1592+; per-tab body context; `_getCachedTrackDurationSeconds` / `_sceneDurationSeconds`)
- `scripts/manager-playlists.js` (`selectorCache`, `getPlaylistSummary` ~362+, `getTrackOptions`, `invalidateCache` ~288+)
- `scripts/manager-soundscenes.js` (`getSoundScenes` / cache ~449+)
- `scripts/manager-cues.js` (cue cache / `getCue` ~191+)
- `scripts/manager-minstrel.js` (`getDashboardData`, `_dashboardCache`; `getHeaderPlaybackContext`, `refreshSecondaryBarState` ~725+)

Details:

- `getData()` is **tab-scoped**: it builds payload for the active tab only, not every tab every time.
- The active tab still does non-trivial work: dashboard filters, playlist summary mapping/filtering, sound-scene lists and layer presentation, etc.
- Durations for scene layers use window-local caching (`_sceneDurationSeconds` / `_getCachedTrackDurationSeconds`); full `Promise.all` across every layer on each render is no longer the default path.
- Selector helpers (`PlaylistManager`, `SoundSceneManager`, `CueManager`) use invalidated caches when hooks fire; cache rebuilds still walk `game.playlists` when cold.
- **Shipped:** On tabs other than Dashboard, `getData()` uses `getHeaderPlaybackContext()` for the header/toolbar (now playing, global volumes, scene card). Full `getDashboardData()` (favorites aggregation) runs only when the Dashboard tab is active. Secondary bar labels use the same lightweight snapshot.

Why it matters:

- This is acceptable on a tiny world, but it scales poorly with playlist count and sound count.
- Any action that calls `requestUiRefresh()` can trigger another full rebuild.
- On lower-powered clients, this is a credible cause of slowdown.

Recommendation:

- Split the window into smaller refresh paths: playback status, filters, selected scene editor.
- Further reduce full-window rerenders for small state changes.

Progress:

- **Partial (2026-03-28).** Tab-scoped body, selector caches, scene duration cache on the window, and **header/dashboard split** (above) are in place.
- **Still open:** Per-tab body cost (e.g. sound-scenes `cloneSoundScene` / `sceneSelectorOptions` / layer maps on every full render), and **avoiding a full `render(true)`** when only playback or transport UI changes (e.g. extend beyond `refreshSceneTransportUi()` into header strip updates).

### 2. High: Playback operations still generate many sequential updates

Files:

- `scripts/manager-playlists.js` (`_beginBatch` / `_endBatch` / `_queueRuntimeSync` ~292–311, `playTrack` ~490+, `stopTrack` ~525+, `stopLayer` ~587+, `stopAllAudio` ~611+)
- `scripts/manager-soundscenes.js` (`activateSoundScene` and layer playback ~300+)

Details:

- `stopLayer()` and `stopAllAudio()` batch runtime sync so `stopTrack(..., { sync: false })` does not trigger `syncRuntimeLayers()` per track; one sync runs after the batch when `sync` is true.
- `playTrack()` still issues document updates per call; exclusive music still stops other music via `stopLayer`.
- `activateSoundScene()` still walks layers and performs sequential playback-related updates for ambients and scheduled layers.

Why it matters:

- Foundry document updates are networked and can trigger downstream work on all connected clients.
- Cost still multiplies during scene switches and mass stops compared to a more batched model.

Recommendation:

- Reduce sequential Playlist/PlaylistSound updates during scene activation (batching, skip no-op updates, GM-orchestrated paths where appropriate).
- Prefer batched embedded document updates where Foundry supports them.

Progress:

- Partial. Runtime sync batching applies to multi-stop and restore paths (`_batchDepth`). Scene activation remains sequential for many playback operations.

### 3. Low: Duration cache is unbounded

Files:

- `scripts/manager-playlists.js` (`durationCache` ~8–116, `getDurationSecondsFromPath`)

Details:

- `durationCache` never expires entries.

Why it matters:

- Over many unique audio paths, the map can grow for the life of the client.

Recommendation:

- Use a simple LRU or cap the cache size; clear on module disable if desired.

Progress:

- Active.

### 4. Low: Some lookups and per-render work remain

Files:

- `scripts/window-minstrel.js` (`resolveCoreAudioSettingKey` / `coreAudioSettingKeyCache` ~14–66; `getData` playlist/scene filtering ~1635+)
- `scripts/manager-playlists.js` (`getPlaylistSummary` and related)
- `scripts/manager-minstrel.js` (dashboard assembly)

Details:

- Favorites/recents are pre-indexed in `getPlaylistSummary()` via a `Set` of recent keys; other UI paths may still do linear scans where data is not cached.
- Track options and filtered lists for the scene picker are rebuilt when the sound-scenes tab renders.
- Core audio keys: first resolution per channel may scan `core.*` settings; results live in `coreAudioSettingKeyCache`.

Why it matters:

- Small costs add up on a window that refreshes often.

Recommendation:

- Precompute `Set`s / `Map`s where the UI still rescans large lists on each render.

Progress:

- Partial. Favorites/recents and core audio keys are largely addressed; per-render filtering/mapping in `getData()` remains.

### 5. Low: GM `syncActiveSceneFromPlayback` debounce timeout not cleared on shutdown

Files:

- `scripts/manager-minstrel.js` (`syncActiveSceneFromPlayback`, `setTimeout` via `_sceneNormalizationTimeoutId` ~162–168; `shutdown` ~72–83)

Details:

- When playback implies an active sound scene, a zero-delay timeout may call `stopPlaylist` / `activateSoundScene` / `requestUiRefresh`.
- `shutdown()` does not `clearTimeout` this id.

Why it matters:

- If the module is disabled right after the timeout is scheduled, the callback can still run once during teardown. Not a growing leak, but avoidable.

Recommendation:

- Clear `_sceneNormalizationTimeoutId` in `shutdown()` (and optionally when starting a new normalization).

Progress:

- Active.

### 6. Low: Fire-and-forget `setTimeout` calls (cues and scheduled layers)

Files:

- `scripts/manager-cues.js` (`triggerCue`: duck restore ~291–294; cue completion / UI refresh ~302–312)
- `scripts/manager-soundscenes.js` (scheduled-layer `triggerPlayback`: layer inactive + UI refresh ~388–391)

Details:

- These timers are not stored on handles that `clearScheduledHandles()` clears. An in-flight `triggerPlayback` can still schedule the inner “mark inactive” timeout after a stop.
- Cue ducking and post-cue UI refresh use bare `window.setTimeout` with no module-level cancellation.

Why it matters:

- Risk is **stale callbacks** (extra `syncRuntimeLayers`, menubar refresh, layer activity bookkeeping) after the user expected everything to stop, plus edge cases on module disable.

Recommendation:

- Track ids on `RuntimeManager` or layer handles; clear in scene/cue stop paths and `MinstrelManager.shutdown()`.

Progress:

- Active.

### 7. Medium: Blacksmith secondary bar type / tool mapping cleanup

Files:

- `scripts/manager-minstrel.js` (`registerMenubarIntegration` / `unregisterMenubarIntegration` ~182+; `SECONDARY_BAR_ITEM_IDS` ~41–54)
- `../coffee-pub-blacksmith/scripts/api-menubar.js` (reference only)

Details:

- Menubar tools and secondary bar **items** are removed on `shutdown()`.
- Blacksmith does not currently expose a public way to unregister the secondary **bar type** and **tool mapping** registered for Minstrel’s control bar.

Why it matters:

- After disable/reload, behavior depends on Blacksmith’s internal lifecycle; may leave stale registration until a full refresh.

Progress:

- Partial — cleanup is limited to what the Blacksmith API exposes today.

## Highest-Value Refactors

1. **#1 (remaining):** Light refresh paths — DOM/partial updates for playback + transport without full `getData()`/template pass where safe; memoize or skip redundant body work (sound scene picker, layer rows) when inputs unchanged.
2. **#2 (next recommended):** Reduce sequential Playlist/PlaylistSound updates during `activateSoundScene` and similar flows.
3. Cap or LRU the audio `durationCache` and clear on disable if desired (**#3**).
4. Clear `_sceneNormalizationTimeoutId` on shutdown; track and clear cue/scheduled-layer fire-and-forget timeouts (**#5–6**).

## Suggested Instrumentation

To validate improvements, measure:

- Time spent in `MinstrelWindow.getData()`
- Number of `PlaylistSound.update()` (and related) calls during scene activation
- Number of full menubar/window re-renders per user action

Even simple `console.time()` / `console.timeEnd()` around those paths will quickly show which changes buy the most.

## Bottom Line

Perceived slowdown is mostly accumulated UI and document-update overhead: per-tab `getData()` body work, cold-cache rebuilds, and playlist document churn during scenes and cues. Header/dashboard fan-out on non-dashboard tabs is reduced as of 2026-03-28.

Smaller residual risks: unbounded `durationCache`, a few **uncleared timers** on disable or mid-flight scene stop, and the secondary-bar registration gap with Blacksmith’s public API.

Further wins are mostly architectural (fewer updates, narrower refresh) rather than invasive.
