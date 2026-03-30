# Minstrel Performance And Foundation Review

## Scope

Reviewed the current module with a focus on:

- Client-side slowdown risk during live sessions
- Memory leaks and timer/listener cleanup
- Excessive Foundry document writes and repeated full-data scans
- Blacksmith integration surfaces that still have open lifecycle or API gaps

Initial review was based on `scripts/` as of 2026-03-19. **Re-reviewed** against the same tree on **2026-03-28** (line references below are anchors into that snapshot and may drift as the code changes).

**Progress (implementation):** 2026-03-28 — Finding **#1** closed: header/dashboard split, `windowRefreshDepth: 'playback'`, `refreshPlaybackChrome()`, sound-scenes list/selector caches, and focus-blocked chrome updates (see Finding 1).

## Executive Summary

The module does not show a catastrophic leak, but it still has patterns that can make clients feel slower during play:

- The main window still does meaningful work on a **full** refresh for the **active tab body** (filters, cloning, scene-layer presentation). **Dashboard favorites** (`getDashboardData`) load only on the Dashboard tab; header chrome uses `getHeaderPlaybackContext()`. **Playback-only** refresh updates toolbar metrics (+ scene transport when applicable) without re-running `getData()` when the active tab is Sound Scenes, Cues, or Automation (`requestUiRefresh({ windowRefreshDepth: 'playback' })`); Dashboard and Playlists still take a full preserve-UI render so playing/favorite UI stays correct.
- Scene activation and some flows still perform many sequential Playlist/PlaylistSound updates; runtime sync is batched in several paths (`_beginBatch` / `_endBatch`) but not eliminated.
- A few **fire-and-forget `setTimeout` calls** and one **GM debounce timeout** are not tied to module shutdown or full scene teardown, so a narrow class of “stray work after disable” remains possible (usually low impact).

If players reported slowdown, the most likely causes remain the Minstrel window’s render/data work for the active tab and Playlist document update volume during scene and cue activity.

## Open Findings (Stack Ranked)

| Rank | Severity | Area | Status |
| --- | --- | --- | --- |
| 1 | High | Playback batch/update churn in playlist and scene activation paths | Partial |
| 2 | Low | Unbounded audio duration cache | Active |
| 3 | Low | Small repeated lookup/index inefficiencies | Partial |
| 4 | Low | GM `syncActiveSceneFromPlayback` debounce timeout not cleared on shutdown | Active |
| 5 | Low | Fire-and-forget timeouts (cues, scheduled-layer UI) | Active |
| 6 | Medium | Blacksmith secondary bar type / tool mapping — no public unregister | Partial |

## Findings

### Addressed (2026-03-28): `getData()` / window refresh

Former finding #1 (high). **Done:** (1) `buildToolbarMetricsInnerHtml()` + `refreshPlaybackChrome()` so toolbar metrics can update without a full template pass; (2) `requestUiRefresh({ windowRefreshDepth: 'playback', invalidateDashboard: false })` — on Sound Scenes / Cues / Automation, updates chrome + `refreshSceneTransportUi` only; on Dashboard / Playlists, falls back to `refreshPreservingUi`; (3) `refreshWindow: false` still runs `refreshPlaybackChrome` + `refreshSceneTransportUi` (e.g. scene music skip); (4) `refreshPreservingUi` when focus blocks render now refreshes chrome + clock; (5) sound-scenes **browser list** and **track picker** reuse cached rows/options (`_sceneBrowserListCache`, `_sceneSelectorOptionsCache`) when search/filter and `getTrackOptions()` identity are unchanged; (6) `getMenubarSoundLabel()` uses `getHeaderPlaybackContext()`. Full `getData()` remains for body edits, Dashboard/Playlists playback visibility, and structural changes.

### 1. High: Playback operations still generate many sequential updates

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

### 2. Low: Duration cache is unbounded

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

### 3. Low: Some lookups and per-render work remain

Files:

- `scripts/window-minstrel.js` (`resolveCoreAudioSettingKey` / `coreAudioSettingKeyCache` ~14–66; `getData` playlist/scene filtering ~1635+)
- `scripts/manager-playlists.js` (`getPlaylistSummary` and related)
- `scripts/manager-minstrel.js` (dashboard assembly)

Details:

- Favorites/recents are pre-indexed in `getPlaylistSummary()` via a `Set` of recent keys; other UI paths may still do linear scans where data is not cached.
- Sound-scenes **track picker** options are cached between renders when search/filter and `getTrackOptions()` reference are stable; other tabs may still remap large lists on each full render.
- Core audio keys: first resolution per channel may scan `core.*` settings; results live in `coreAudioSettingKeyCache`.

Why it matters:

- Small costs add up on a window that refreshes often.

Recommendation:

- Precompute `Set`s / `Map`s where the UI still rescans large lists on each render.

Progress:

- Partial. Favorites/recents and core audio keys are largely addressed; per-render filtering/mapping in `getData()` remains.

### 4. Low: GM `syncActiveSceneFromPlayback` debounce timeout not cleared on shutdown

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

### 5. Low: Fire-and-forget `setTimeout` calls (cues and scheduled layers)

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

### 6. Medium: Blacksmith secondary bar type / tool mapping cleanup

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

1. **#1 (next):** Reduce sequential Playlist/PlaylistSound updates during `activateSoundScene` and similar flows.
2. Cap or LRU the audio `durationCache` and clear on disable if desired (**#2** in open table).
3. Clear `_sceneNormalizationTimeoutId` on shutdown; track and clear cue/scheduled-layer fire-and-forget timeouts (**#4–5**).

## Suggested Instrumentation

To validate improvements, measure:

- Time spent in `MinstrelWindow.getData()`
- Number of `PlaylistSound.update()` (and related) calls during scene activation
- Number of full menubar/window re-renders per user action

Even simple `console.time()` / `console.timeEnd()` around those paths will quickly show which changes buy the most.

## Bottom Line

Perceived slowdown is mostly accumulated UI and document-update overhead on **full** refreshes, cold-cache rebuilds, and playlist document churn during scenes and cues. As of 2026-03-28, many transport actions avoid a full window `getData()` when the active tab is Sound Scenes, Cues, or Automation; Dashboard/Playlists still refresh the body when playback changes so lists stay accurate.

Smaller residual risks: unbounded `durationCache`, a few **uncleared timers** on disable or mid-flight scene stop, and the secondary-bar registration gap with Blacksmith’s public API.

Further wins are mostly architectural (fewer updates, narrower refresh) rather than invasive.
