# Minstrel — Architecture

**Audience:** Contributors to the Minstrel codebase, and anyone extending or debugging it.

Minstrel is the live-session audio console for Coffee Pub games: start and stop music, build reusable
ambient environments, fire dramatic cues, and automate transitions like combat start. This page is the
map — what the pieces are, how they hand off, and the handful of facts that explain the rest. Each
subsystem has its own page.

**Files:**

| File | Role |
|---|---|
| `scripts/minstrel.js` | Entry point. Two Foundry hooks (`init`, `ready`) and a `disableModule` teardown |
| `scripts/const.js` | `MODULE` constants, read from `module.json` at import time |
| `scripts/settings.js` | `SETTING_KEYS` and the `game.settings` registrations |
| `scripts/manager-minstrel.js` | Orchestration: init order, the UI refresh pipeline, menubar/toolbar integration, dashboard data |
| `scripts/manager-runtime.js` | In-memory session state. Every timer handle and "what is playing" fact lives here |
| `scripts/manager-storage.js` | Settings reads/writes, sanitizers, blank-record factories, playlist folders |
| `scripts/manager-playlists.js` | The audio layer. Everything that actually plays, stops, fades or reads a `PlaylistSound` |
| `scripts/manager-soundscenes.js` | Sound scenes: the layer model, activation, scheduling, the scene clock |
| `scripts/manager-cues.js` | Cue boards and one-shot cue triggering |
| `scripts/manager-automation.js` | Rules: triggers, conditions, ranking, and the Foundry hooks that drive them |
| `scripts/window-minstrel.js` | The ApplicationV2 window and all five tabs |
| `templates/partials/window-minstrel-body.hbs` | The tab bodies |

## Two facts explain most of the codebase

**1. Foundry playlists are the database.** Minstrel has no store of its own for scenes and cues. A sound
scene *is* a `Playlist` document carrying `flags.coffee-pub-minstrel.type = 'scene'`; a cue board *is* a
playlist carrying `type = 'cue-board'`. Their metadata rides on the same documents — `sceneMeta` /
`cueBoardMeta` on the playlist, `layerMeta` / `cueMeta` on each `PlaylistSound`. Only settings-shaped
data (automation rules, favorites, recents, window state) lives in `game.settings`.

This is the single most load-bearing decision in the module, and it propagates everywhere: scenes survive
without Minstrel installed, a GM can inspect one in the Playlists sidebar, and the audio a scene plays is
a real `PlaylistSound` with a real `PlaylistSound#sync`. It also means **deleting a playlist deletes a
scene**, and that scene layers play the sound *inside the scene playlist* rather than the library track
they were built from — which is what makes the render fingerprint in [architecture-window](architecture-window.md) work.

**2. Minstrel is GM-only, hard.** `MinstrelManager.initialize()` returns immediately for a non-GM, before
registering the window, hooks, automation, or any Blacksmith integration. `requestUiRefresh` and
`openWindow` are no-ops for players. There is no player-facing surface to reason about — a player's
client runs the module's imports and nothing else.

## Startup order, and why it is that order

`minstrel.js` does very little: `init` preloads the two Handlebars templates; `ready` awaits
`BlacksmithAPI.waitForReady()`, registers settings, registers the module with Blacksmith, and calls
`MinstrelManager.initialize()`.

Inside `initialize()` the order is deliberate, and was arrived at by fixing a bug:

```
registerWindowIntegration       -- window class known to Blacksmith's window API
registerCacheInvalidationHooks  -- playlist create/update/delete -> debounced cache flush
registerSettingsMemoInvalidation
exposeDebugHandle
registerMenubarIntegration      -- ALL UI first
registerToolbarIntegration
syncRuntimeLayers + requestUiRefresh
AutomationManager.initialize()  -- automation LAST
syncActiveSceneFromPlayback
```

**UI registration must precede automation.** Automation's scene-start catch-up can activate a sound
scene, and playing anything awaits `game.audio.unlock`, which resolves only on the first user gesture.
With automation first, the entire chain — menubar registration included — parked until the user clicked,
so Minstrel's menubar items were invisible until then and then appeared simultaneously with the scene
starting. The catch-up is fire-and-forget for the same reason: init must complete regardless.

`shutdown()` mirrors it, and its order matters as much: timers cancelled, pending debounced setting
writes **flushed** (not dropped), window closed, then integrations unregistered.

## Manager topology

The managers form a layered graph, not a peer mesh. Dependencies point downward:

```
        window-minstrel  ──────────────┐
               │                       │
        manager-minstrel (orchestrator)
         │        │        │           │
  soundscenes   cues   automation      │
         │        │        │           │
         └────────┴────────┴──> manager-playlists ──> Foundry Playlist / PlaylistSound
                  │                    │
                  ├──> manager-runtime ┘   (in-memory state, no persistence)
                  └──> manager-storage     (game.settings, sanitizers, folders)
```

`manager-playlists.js` is the only module that plays or stops audio. Sound scenes, cues and automation
all express themselves as calls into it; none of them touch `PlaylistSound` playback directly. When
adding a feature that makes noise, add it there and call it from above.

`manager-runtime.js` holds every mutable session fact — active scene id, scene clock, scheduled layer
handles, music sequence handle, cue cooldowns, active cue refs, preview state, and the module's deferred
timeouts. It persists nothing. Its real job is **teardown**: because every timer handle is registered
there, `shutdown()` can cancel all of them without each subsystem tracking its own.

## The three kinds of state

Knowing which bucket a fact belongs in answers most "where do I put this" questions:

| Kind | Lives in | Survives reload | Examples |
|---|---|---|---|
| Documents | Foundry playlists + flags | Yes | Sound scenes, cue boards, layers, cues |
| Settings | `game.settings` | Yes | Automation rules, favorites, recents, window state |
| Runtime | `manager-runtime.js` | No | Active scene id, timers, cooldowns, what is playing |

Runtime state is deliberately *not* persisted. After a reload Minstrel does not assume a scene is still
active — `syncActiveSceneFromPlayback()` infers it from what is actually playing, which is the honest
source of truth and avoids a stale "active scene" that no longer matches the audio.

## Blacksmith integration

Blacksmith is a hard dependency (`relationships.requires`), and every use goes through its public API or
the importable bridge — never through `scripts/` paths, which are not a stable contract.

| Surface | Used for |
|---|---|
| `BlacksmithWindowBaseV2` (from `api/blacksmith-api.js`) | The window base class. Imported statically so `extends` resolves at module-evaluation time |
| `BlacksmithHookManager` | All five Foundry hooks automation registers (see [architecture-automation](architecture-automation.md)) |
| `BlacksmithUtils` | `postConsoleAndNotification` logging, `getSettingSafely` / `setSettingSafely` |
| `api.menubar` | The Minstrel secondary bar and its transport controls |
| `api.geography` | Scene habitats for automation conditions |
| `api.toolbar`, `api.windows` | Toolbar tool and window open |

Two rules hold at every call site. **Resolve after `ready`, never at module top level** — a top-level
`game.modules.get(...)` throws because `game` does not exist yet, and ES modules cache a failed
evaluation, so the throw disables the module for the whole session rather than being retried. The base
class is the exception that proves it: it comes from a real ES import, which resolves at evaluation time.
And **every call is optional-chained** with a sane fallback, so a Blacksmith predating a given API
degrades rather than throwing. The version floor is declared once, in `module.json`.

## Where to start reading

- Something plays when it should not, or will not play: [architecture-playlists](architecture-playlists.md)
- A scene starts wrong, or a layer times wrong: [architecture-soundscenes](architecture-soundscenes.md)
- The window renders too often, or not often enough: [architecture-window](architecture-window.md)
- A rule fires, or does not: [architecture-automation](architecture-automation.md)
- A cue double-fires or will not stop: [architecture-cues](architecture-cues.md)
- Something is not saved, or is saved twice: [architecture-storage](architecture-storage.md)
