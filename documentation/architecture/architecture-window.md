# The window and the render pipeline — Architecture

**Audience:** Contributors to the Minstrel codebase.

One ApplicationV2 window with five tabs, and the refresh machinery that decides when any of it repaints.
The refresh pipeline is the part worth reading closely: it is where nearly all of Minstrel's performance
work lives, and where a naive change does the most damage.

**Files:**

| File | Role |
|---|---|
| `scripts/window-minstrel.js` | The `MinstrelWindow` class, `uiState`, `getData`, action handlers, targeted DOM updaters |
| `scripts/manager-minstrel.js` | `requestUiRefresh`, `_scheduleUiRefreshFlush`, `_flushUiRefresh` |
| `templates/window-minstrel.hbs` + `templates/partials/window-minstrel-body.hbs` | Shell and tab bodies |

## One window, one part, five tabs

`MinstrelWindow extends BlacksmithWindowBaseV2` — imported statically from Blacksmith's
`api/blacksmith-api.js` bridge, never from its `scripts/` path.

There is a single `PARTS.content`, so a render rebuilds the whole body. Tabs are not separate parts;
`uiState.tab` selects which branch of `getData()` runs. The five are **dashboard**, **soundScenes**,
**playlists**, **cues**, **automation**.

`getData()` branches on the active tab and builds *only* that tab's context. Nothing rebuilds the
playlist summary while the Automation tab is open — which is why "defer the expensive builders until the
tab is shown" is already done and listed as deliberately-not-todo.

## `uiState` is the window's own state

Selections, drafts, search boxes and filters live on `this.uiState`, seeded from the persisted window
state at construction. Drafts (`soundSceneDraft`, `cueDraft`, `automationRuleDraft`) are working copies —
edits mutate the draft, and only an explicit save writes the document or setting.

Two fields are deliberately derived rather than restored: `sceneDetailsEditMode` is
`!state.selectedSoundSceneId`, and `cueEditMode` is always `false` on open. See
[architecture-storage](architecture-storage.md).

## The refresh pipeline

Every UI update in the module goes through one entry point:

```js
MinstrelManager.requestUiRefresh({
  refreshWindow = true,
  refreshMenubar = true,
  invalidateDashboard = true,
  windowRefreshDepth = 'full'   // or 'playback'
});
```

It does **not** render. It merges the request into a pending record and schedules a flush. Across a burst
of calls the merge is a monotone OR: `refreshWindow` and `refreshMenubar` accumulate, and `full`
dominates `playback`. A scene activation that fires eight requests produces one render.

### Scheduling: rAF with a timeout backstop

`_scheduleUiRefreshFlush` arms **both** a `requestAnimationFrame` and a 250ms `setTimeout`; whichever
fires first cancels the other.

The backstop is not belt-and-braces. **Browsers pause rAF for hidden or unfocused windows**, so a world
loading in a background tab never flushed — which is how the menubar came to be empty until the user's
first click. The timeout caps staleness while alt-tabbed at 250ms.

### The flush, and the playback fingerprint

`_flushUiRefresh` picks one of three paths:

- **`full` depth** → `refreshPreservingUi()`, a body render that restores focus and scroll.
- **`playback` depth on a tab whose markup encodes playback** (dashboard, playlists) → compare the live
  `getPlaybackBodySignature()` against the signature captured when the body was last built. Render only
  if they differ.
- **Otherwise** → the targeted DOM path: `refreshPlaybackChrome()` + `refreshSceneTransportUi()`.

The fingerprint is the single most valuable optimization in the module, and it works because of a fact
from [architecture-soundscenes](architecture-soundscenes.md): **scene layers play the `PlaylistSound` inside the scene playlist**,
and the Dashboard and Playlists tabs render library playlists. So a music advance, a delayed environment
start, or a one-shot firing changes nothing those two tabs display — and an active scene fires several of
those per minute, each of which used to rebuild the entire track list.

The signature is scoped to non-Minstrel-owned playlists and deliberately excludes volume and
`pausedTime`, which drift continuously during fades and were never rendered live.

> **Where the signature is captured matters.** `getData()` records
> `this._renderedPlaybackSignature` as it builds the context, not in `_onRender`. A scene timer firing
> between context prep and paint must not be mistaken for "already rendered." Paths that bail before
> rendering never reach it, so the stale signature correctly forces the next attempt.

**Known trade-off:** a playback event no longer incidentally repaints an unrelated external edit — another
client renaming a track, say. Those were never guaranteed to repaint anyway; the document hooks only
invalidate caches, they never rendered. This is narrower, not broken.

## `_onRender`, and the bug it exists to fix

ApplicationV2 **never calls `activateListeners`.** V1 code that lived there simply did not run.

The 1 Hz scene-clock ticker was wired that way, so the Sound Scenes master playhead only ticked if the
window's very first render happened to be on that tab — and the constant full re-renders of the time
masked it by repainting anyway. `_onRender` now re-syncs root listeners and the ticker on every render
and tab switch. `activateListeners` survives as a deprecated shim.

If you add per-render wiring, put it in `_onRender`. Anything you put in `activateListeners` is dead
code.

## Targeted DOM updaters

These patch the DOM in place instead of rendering, and are what the `playback` path falls through to:

| Method | Updates |
|---|---|
| `refreshPlaybackChrome()` | Toolbar and now-playing chrome |
| `refreshSceneTransportUi()` | Sound Scenes transport, no-ops off that tab |
| `_updateSceneClockDisplay()` | Master elapsed/duration, playhead, active music row styling — the 1 Hz tick |
| `_applyPlaylistSearchFilter()` and friends | Show/hide rows for search, without a render |

Search filtering is DOM-only by design: typing must not rebuild the body, and the search terms are
restored into `uiState` so an eventual render keeps them.

## Debounces in the window

| What | Delay | Why |
|---|---|---|
| Window state save | 400ms trailing | Driven by typing and dragging; flushed on close |
| Scene layer volume persist | 350ms trailing | A slider drag emits continuously |
| Automation save-button dirty check | 150ms | Full form collection + stable-stringify, previously per keystroke |
| Scene duration layout refresh | debounced | Async duration probes resolving one at a time |

## Diagnostics

`game.modules.get('coffee-pub-minstrel').minstrelDebug` exposes `renderStats`
(`bodyRenders` / `bodyRendersSkipped` / `fullRenders`), `playbackSignature()`,
`renderedPlaybackSignature()` and `resetRenderStats()`. Read-only, GM-only, removed on shutdown. It
exists because ES modules are unreachable from the console and the counters are only useful live — if you
are changing anything on this page, watch `bodyRendersSkipped` climb while a scene plays.

## Open work

`refreshPlaybackRows()` — a targeted updater for the *genuine* playback changes (manual play/stop, channel
stops), after which the `bodyEncodesPlayback` branch can be deleted entirely. Row state is just the row
class, `statusLabel`, and the play/stop button; rows key off `data-value="playlistId::soundId"`.
