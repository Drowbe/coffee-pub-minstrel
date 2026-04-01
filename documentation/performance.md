# Minstrel Performance And Foundation Review

## Scope

Reviewed the current module with a focus on:

- Client-side slowdown risk during live sessions
- Memory leaks and timer/listener cleanup
- Excessive Foundry document writes and repeated full-data scans
- Blacksmith integration surfaces that still have open lifecycle or API gaps

Initial review was based on `scripts/` as of 2026-03-19. **Re-reviewed** against the same tree on **2026-03-28** (line references below are anchors into that snapshot and may drift as the code changes).

**Progress (implementation):** 2026-03-28 — **Window refresh** finding closed (see Addressed: `getData()` / window refresh). **Playback churn (open table #1):** selector-cache invalidation and `syncRuntimeLayers` are deferred while `_batchDepth > 0`, then flushed once when the outer batch ends; `activateSoundScene` / `stopActiveSoundScene` use one playlist scan via `stopLayersByChannels(['music','ambient'])` plus an outer batch around activation/teardown; `startSoundSceneCycle` runs inside its own batch so many `playTrack`/`stopPlaylist` steps coalesce one flush. **Timers & duration cache:** `_sceneNormalizationTimeoutId` cleared in `shutdown`; cue duck-restore + cue-end timeouts registered on `RuntimeManager` (`clearModuleDeferredTimeouts` on disable); scheduled-layer “mark inactive” follow-ups registered separately (`clearScheduledLayerFollowupTimeouts` in `clearScheduledHandles` + shutdown); audio `durationCache` capped at 128 entries with touch-on-get ordering + `PlaylistManager.clearDurationCache()` on shutdown.

## Executive Summary

The module does not show a catastrophic leak, but it still has patterns that can make clients feel slower during play:

- The main window still does meaningful work on a **full** refresh for the **active tab body** (filters, cloning, scene-layer presentation). **Dashboard favorites** (`getDashboardData`) load only on the Dashboard tab; header chrome uses `getHeaderPlaybackContext()`. **Playback-only** refresh updates toolbar metrics (+ scene transport when applicable) without re-running `getData()` when the active tab is Sound Scenes, Cues, or Automation (`requestUiRefresh({ windowRefreshDepth: 'playback' })`); Dashboard and Playlists still take a full preserve-UI render so playing/favorite UI stays correct.
- Scene activation still performs sequential Playlist/PlaylistSound **document** updates per layer, but selector-cache churn and `syncRuntimeLayers` are batched across activation and scene cycles (`_beginBatch` / `_endBatch`, deferred invalidation).
- **Scoped** deferred timeouts (cue duck / cue end UI / scheduled-layer follow-up) and the GM normalization timeout are cleared on module shutdown; scheduled-layer follow-ups are also cleared when scheduled handles are torn down. Other ad-hoc timers elsewhere were not part of this pass.

If players reported slowdown, the most likely causes remain the Minstrel window’s render/data work for the active tab and Playlist document update volume during scene and cue activity.

## Open Findings (Stack Ranked)

| Rank | Severity | Area | Status |
| --- | --- | --- | --- |
| 1 | High | Playback batch/update churn in playlist and scene activation paths | Improved |
| 2 | Low | Small repeated lookup/index inefficiencies | Partial |
| 3 | Medium | Blacksmith secondary bar type / tool mapping — no public unregister | Partial |

## Findings

### Addressed (2026-03-28): `getData()` / window refresh

Former finding #1 (high). **Done:** (1) `buildToolbarMetricsLiveHtml()` / `buildToolbarSceneDefinitionHtml()` + `refreshPlaybackChrome()` so **live** panels (Now Playing + Music) update every playback tick while **scene-definition** panels (Environment + Interface layer names) rebuild only when the active scene’s env/one-shot layer set changes; env/interface global volume sliders sync via lightweight value updates; (1b) `RuntimeManager.queueMenubarRender()` debounces Blacksmith `renderMenubar`; (2) `requestUiRefresh({ windowRefreshDepth: 'playback', invalidateDashboard: false })` — on Sound Scenes / Cues / Automation, updates chrome + `refreshSceneTransportUi` only; on Dashboard / Playlists, falls back to `refreshPreservingUi`; (3) `refreshWindow: false` still runs `refreshPlaybackChrome` + `refreshSceneTransportUi` (e.g. scene music skip); (4) `refreshPreservingUi` when focus blocks render now refreshes chrome + clock; (5) sound-scenes **browser list** and **track picker** reuse cached rows/options (`_sceneBrowserListCache`, `_sceneSelectorOptionsCache`) when search/filter and `getTrackOptions()` identity are unchanged; (6) `getMenubarSoundLabel()` uses `getHeaderPlaybackContext()`. Full `getData()` remains for body edits, Dashboard/Playlists playback visibility, and structural changes.

### 1. High: Playback operations still generate many sequential updates

Files:

- `scripts/manager-playlists.js` (`_beginBatch` / `_endBatch` / `_queueRuntimeSync`, deferred `invalidateSelectorCache`, `stopLayersByChannels`, `playTrack`, `stopTrack`, `stopLayer`, `stopAllAudio`)
- `scripts/manager-soundscenes.js` (`activateSoundScene`, `stopActiveSoundScene`, `startSoundSceneCycle`)

Details:

- `stopLayer()` and `stopAllAudio()` batch runtime sync so `stopTrack(..., { sync: false })` does not trigger `syncRuntimeLayers()` per track; one sync runs after the batch when `sync` is true.
- While `_batchDepth > 0`, `invalidateSelectorCache` records keys (or a full-clear flag) and `_queueRuntimeSync` sets `_syncPending`; when the outermost batch ends, invalidations flush once, then a single `syncRuntimeLayers()` runs if needed.
- `stopLayersByChannels(['music','ambient'])` replaces two full playlist scans for scene enter/exit stops.
- `playTrack()` still issues document updates per call; exclusive music still stops other music via `stopLayer`.
- `activateSoundScene()` / `startSoundSceneCycle()` still sequence ambients and scheduled layers; document-update count is unchanged, but UI/cache work is coalesced.

Why it matters:

- Foundry document updates are networked and can trigger downstream work on all connected clients.
- Repeated selector invalidation and runtime sync amplified perceived cost on the client during scene switches.

Recommendation:

- Further reduce sequential Playlist/PlaylistSound **document** updates during scene activation (skip no-op updates, GM-orchestrated paths where appropriate).
- Prefer batched embedded document updates where Foundry supports them.

Progress:

- Improved (2026-03-28). Batched invalidation + runtime sync across scene activation and `startSoundSceneCycle`; combined music/ambient stop scan. Remaining gap: per-layer `playSound` / `update` calls are still sequential.

### 2. Low: Some lookups and per-render work remain

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

### 3. Medium: Blacksmith secondary bar type / tool mapping cleanup

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

1. **Next:** Cut sequential Playlist/PlaylistSound **document** updates during scene activation where Foundry allows (open table rank 1 — cache/sync side largely addressed).
2. Chip away at per-render lookups where profiling shows cost (open table rank 2).

## Suggested Instrumentation

To validate improvements, measure:

- Time spent in `MinstrelWindow.getData()`
- Number of `PlaylistSound.update()` (and related) calls during scene activation
- Number of full menubar/window re-renders per user action

Even simple `console.time()` / `console.timeEnd()` around those paths will quickly show which changes buy the most.

## Bottom Line

Perceived slowdown is mostly accumulated UI and document-update overhead on **full** refreshes, cold-cache rebuilds, and playlist document churn during scenes and cues. As of 2026-03-28, many transport actions avoid a full window `getData()` when the active tab is Sound Scenes, Cues, or Automation; Dashboard/Playlists still refresh the body when playback changes so lists stay accurate.

Smaller residual risks: the **Blacksmith** secondary-bar registration gap, and any timers outside the scoped deferred-timeout registry.

Further wins are mostly architectural (fewer updates, narrower refresh) rather than invasive.
