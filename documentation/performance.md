# Minstrel Performance And Foundation Review

## Scope

Reviewed the current module with a focus on:

- Client-side slowdown risk during live sessions
- Memory leaks and timer/listener cleanup
- Excessive Foundry document writes and repeated full-data scans
- Blacksmith API usage, especially `HookManager`, window, and menubar integration

This review is based on the current code in `scripts/` as of 2026-03-19.

## Executive Summary

The module does not show a catastrophic leak, but it does have several patterns that can absolutely make clients feel slower during play:

- The main window rebuilds a large amount of derived data on every refresh.
- Several actions perform many sequential Playlist/PlaylistSound updates and repeated full rescans.
- Window state is written to settings far too often.
- Global document listeners are attached permanently and never torn down.
- Blacksmith integrations are only partially cleaned up on disable/reload.

If players reported slowdown, the most likely causes are the repeated re-render/data rebuild path in the Minstrel window and the number of Playlist document updates produced while starting/stopping scenes and cues.

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
| 8 | Medium | Scheduled one-shot overlap/timer behavior | Active |
| 9 | Low | Unbounded audio duration cache | Active |
| 10 | Low | Small repeated lookup/index inefficiencies | Partial |

## Findings

### 1. High: Window position and search state are persisted too often

Files:

- `scripts/window-minstrel.js:485`
- `scripts/window-minstrel.js:517`
- `scripts/window-minstrel.js:617`
- `scripts/window-minstrel.js:965`
- `scripts/window-minstrel.js:977`
- `scripts/manager-storage.js:256`

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

- `scripts/window-minstrel.js:701`
- `scripts/window-minstrel.js:745`
- `scripts/manager-playlists.js:182`
- `scripts/manager-playlists.js:207`
- `scripts/manager-playlists.js:275`
- `scripts/manager-soundscenes.js:151`
- `scripts/manager-cues.js:112`

Details:

- Every render rebuilds:
  - sound scenes
  - cues
  - automation rules
  - dashboard data
  - playlist summary
  - track options
- For the selected scene, every layer duration is fetched asynchronously with `Promise.all(...)`.
- Those helpers themselves walk `game.playlists.contents` repeatedly and often rebuild fresh arrays/objects.

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

- Partial. Playlist, cue, scene, and dashboard selectors now cache and invalidate, but the window still rebuilds a large rendered context in one pass and still computes selected scene durations in `getData()`.

### 3. High: Playback operations generate too many sequential updates and repeated runtime rescans

Files:

- `scripts/manager-playlists.js:164`
- `scripts/manager-playlists.js:340`
- `scripts/manager-playlists.js:373`
- `scripts/manager-playlists.js:411`
- `scripts/manager-playlists.js:431`
- `scripts/manager-soundscenes.js:219`

Details:

- `playTrack()` can call `stopLayer()`, which calls `stopTrack()` for each playing sound.
- `stopTrack()` calls `syncRuntimeLayers()` every time.
- `stopLayer()` calls `syncRuntimeLayers()` again after the loop.
- `stopAllAudio()` also stops each track one-by-one and then rescans again.
- `activateSoundScene()` plays ambient layers sequentially, each producing its own document update path.

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

- Partial. Batch sync suppression is now in place for stop/start/restore paths, but scene activation still performs sequential playback document operations and could be pushed further with more aggressive batching or GM-authoritative orchestration.

### 4. Medium: Global document listeners are permanent and never removed

Files:

- `scripts/window-minstrel.js:511`
- `scripts/window-minstrel.js:517`
- `scripts/window-minstrel.js:617`
- `scripts/window-minstrel.js:490`

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

- Fixed. Listeners are now attached to the window root and removed during close/rebind.

### 5. Medium: Sound scene save rewrites every embedded sound, even if only one layer changed

Files:

- `scripts/manager-soundscenes.js:161`
- `scripts/manager-soundscenes.js:199`

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

- `scripts/manager-soundscenes.js:251`
- `scripts/manager-soundscenes.js:270`

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

- Active. This has not been addressed yet.

### 7. Low: Duration cache is unbounded

Files:

- `scripts/manager-playlists.js:8`
- `scripts/manager-playlists.js:72`

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

- `scripts/manager-playlists.js:207`
- `scripts/manager-minstrel.js:423`
- `scripts/window-minstrel.js:755`
- `scripts/window-minstrel.js:878`

Details:

- Favorites/recents checks use repeated `.some(...)` scans.
- Recent cue ids are resolved with repeated `.find(...)`.
- Track options are filtered into multiple arrays on every render.
- Core audio setting key resolution scans all `core.*` settings on every render.

Why it matters:

- Each instance is small, but together they add steady overhead to a window that already rebuilds too much.

Recommendation:

- Precompute `Set`s and `Map`s for favorites, recents, and cue lookup.
- Cache resolved core setting keys once per session.

Progress:

- Partial. Favorites/recents/cue resolution improved in cached selectors, but some repeated UI-time lookups remain.

## Blacksmith API Review

### HookManager usage needs cleanup on disable/reload

Files:

- `scripts/manager-automation.js:28`
- `scripts/manager-automation.js:61`
- `scripts/minstrel.js:57`
- `../coffee-pub-blacksmith/scripts/manager-hooks.js:31`
- `../coffee-pub-blacksmith/scripts/manager-hooks.js:236`

Assessment:

- `AutomationManager.initialize()` registers three Blacksmith hooks and stores the callback ids in `_hookIds`.
- Those callback ids are never used for cleanup.
- On `disableModule`, Minstrel only unregisters its window integration.

Why this is a problem:

- If the module is hot-disabled, re-enabled, or reloaded in-session, stale automation hooks can remain registered.
- That can duplicate automation execution and create hard-to-diagnose behavior/performance issues.

Recommendation:

- Add `AutomationManager.shutdown()` and call `BlacksmithHookManager.unregisterHook({ name, callbackId })` for each callback id, or use a shared context cleanup path if Blacksmith exposes one.
- Reset `_hookIds` after cleanup.

Progress:

- Fixed. Hook registrations are now tracked and explicitly unregistered on shutdown.

### Menubar integration is registered, but not fully unregistered

Files:

- `scripts/manager-minstrel.js:53`
- `scripts/manager-minstrel.js:68`
- `scripts/manager-minstrel.js:89`
- `scripts/minstrel.js:57`
- `../coffee-pub-blacksmith/scripts/api-menubar.js:627`
- `../coffee-pub-blacksmith/scripts/api-menubar.js:759`
- `../coffee-pub-blacksmith/scripts/api-menubar.js:2036`

Assessment:

- Minstrel registers:
  - two menubar tools
  - one secondary bar type
  - one secondary bar tool mapping
  - five secondary bar items
- On disable, none of those are explicitly removed.

Why this is a problem:

- Depending on Blacksmith lifecycle behavior, stale tools/items may remain in memory or UI until a refresh.
- It also makes reload behavior less predictable.

Recommendation:

- Add `MinstrelManager.unregisterMenubarIntegration()`.
- Explicitly call `unregisterMenubarTool()` for Minstrel tools and `unregisterSecondaryBarItem()` for each secondary-bar item.
- If Blacksmith later adds unregister methods for secondary bar types/tool mappings, adopt them.

Progress:

- Fixed for current public cleanup points. Tools and secondary bar items are now explicitly removed on shutdown.
- Partial at API level. There is still no public unregister path for the secondary bar type/tool mapping itself, so cleanup can only go as far as Blacksmith currently exposes.

### Direct use of `MenuBar._showMenubarContextMenu()` relies on a private API

Files:

- `scripts/manager-minstrel.js:13`
- `scripts/manager-minstrel.js:190`
- `../coffee-pub-blacksmith/scripts/api-menubar.js:3133`

Assessment:

- Minstrel imports `MenuBar` directly and calls `_showMenubarContextMenu(...)`.
- The leading underscore indicates an internal/private method.

Why this is a problem:

- Private methods are more likely to change without compatibility guarantees.
- This creates a brittle dependency on Blacksmith internals.

Recommendation:

- Prefer public menubar API entry points where possible.
- For the registered tool itself, `contextMenuItems` is already supported by Blacksmith and is the correct pattern.
- For ad-hoc menus, expose a public helper in Blacksmith rather than calling a private method from Minstrel.

Progress:

- Fixed. Blacksmith now exposes a public `showMenubarContextMenu()` API and Minstrel uses that public entry point instead of calling the private helper directly.

### Window API usage looks acceptable

Files:

- `scripts/manager-minstrel.js:27`
- `scripts/manager-minstrel.js:356`
- `../coffee-pub-blacksmith/scripts/api-windows.js:15`

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

If you want the best foundation improvements first, do these in order:

1. Throttle or defer `saveWindowState()` and stop persisting on every position update.
2. Remove the permanent global document listeners and bind listeners to the window/root lifecycle.
3. Add cached selectors for playlists, cues, scenes, and dashboard data, invalidated by document hooks.
4. Batch playback stop/start operations so runtime sync happens once per batch.
5. Diff sound-scene saves instead of deleting and recreating every `PlaylistSound`.
6. Add proper Blacksmith cleanup paths for hooks and menubar registrations.

## Suggested Instrumentation

To validate improvements, measure:

- Time spent in `MinstrelWindow.getData()`
- Number of `game.settings.set()` calls while dragging/searching
- Number of `PlaylistSound.update()` calls during scene activation
- Number of full menubar/window re-renders per user action

Even simple `console.time()`/`console.timeEnd()` around those paths will quickly show which changes buy the most.

## Bottom Line

The most likely cause of the slowdown you saw is not a single dramatic memory leak. It is accumulated UI and document-update overhead:

- too many full data rebuilds
- too many writes to settings
- too many single-track sequential updates
- incomplete lifecycle cleanup around listeners and Blacksmith registrations

The module is still in a good place to harden. The biggest wins are straightforward and mostly architectural rather than invasive.
