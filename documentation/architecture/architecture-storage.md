# Storage — Architecture

**Audience:** Contributors to the Minstrel codebase.

Where every piece of Minstrel data lives, how it is sanitized on the way in, and why several writes are
deliberately delayed. For the document half of the story — scenes and cues as playlists — see
[architecture-soundscenes](architecture-soundscenes.md) and [architecture-cues](architecture-cues.md).

**Files:**

| File | Role |
|---|---|
| `scripts/settings.js` | `SETTING_KEYS` and the eight `game.settings.register` calls |
| `scripts/manager-storage.js` | Every settings read and write, the sanitizers, blank-record factories, and playlist folders |

## Minstrel stores almost nothing in settings

Only data with no natural document home lives in `game.settings`. Everything with a document home — every
sound scene, every cue — is a Foundry playlist, not a setting. The complete settings surface:

| Key | Scope | Holds |
|---|---|---|
| `defaultFadeSeconds` | world | Default crossfade length |
| `recentLimit` | world | How many recents to keep |
| `combatRestoreDelayMs` | world | Delay before restoring audio after combat |
| `automationRules` | world | Every automation rule (see [architecture-automation](architecture-automation.md)) |
| `favorites` | world | Favorited track refs |
| `favoritePlaylists` | world | Favorited playlist ids |
| `recents` | world | Recently played track refs |
| `windowStateMinstrel` | world | Selected tab, selections, search boxes, window position |

The first three are user-facing config; the rest are data the module maintains and are hidden from the
settings sheet.

## Everything is sanitized on read, not trusted on write

`getAutomationRules`, `getFavorites`, `getFavoritePlaylists`, `getRecents` and `getWindowState` all run
their stored value through a sanitizer before returning it. This is the module's actual schema
enforcement: a stored rule missing a field, holding a stale clause type, or written by an older Minstrel
is normalized at the boundary rather than crashing a consumer downstream.

The `createBlank*` factories (`createBlankSoundScene`, `createBlankCue`, `createBlankAutomationRule`) are
the other half — they define the shape a new record starts in, so the sanitizer and the factory should
always be edited together.

`getSetting` / `setSetting` prefer Blacksmith's `getSettingSafely` / `setSettingSafely` and fall back to
raw `game.settings` inside a try/catch. A read of an unregistered or failed setting returns the caller's
fallback rather than throwing.

## Two performance mechanisms, and the invariant they share

Both exist because settings are expensive in Foundry: a `game.settings.set` is a database write **plus a
socket broadcast to every connected client**.

**A memo in front of reads.** `settingsMemo` caches the sanitized `recents`, `favorites` and
`favoritePlaylists`. `getPlaylistSummary` reads recents on every rebuild, so re-sanitizing per read was
pure waste. Two things invalidate the memo: Minstrel's own saves update it directly, and an
`updateSetting` hook (`registerSettingsMemoInvalidation`) nulls it when *another client* writes.

> **The returned arrays are shared, not copies.** A caller that mutates one corrupts the memo for
> everyone. Treat everything out of these getters as read-only.

**A debounce behind writes.** `pendingSettingWrites` coalesces hot-path saves. Recents update on nearly
every track start, so `saveRecents` writes the memo synchronously — the UI reflects the change at once —
and schedules the actual `game.settings.set` behind a 2-second trailing debounce.

The invariant tying them together: **the memo is always current even when the write has not happened
yet.** Readers never observe the delay. The only place that could leak is shutdown, which is why
`MinstrelManager.shutdown()` awaits `flushPendingSettingWrites()` before tearing anything else down. If
you add another debounced setting, add it to that flush or it will silently lose the last write of every
session.

## Playlist folders

`ensureMinstrelPlaylistFolder(kind)` creates and returns the Foundry folder that Minstrel-owned playlists
live in — one for sound scenes, one for cue boards. It is idempotent, and the create/rename paths in both
managers call it on every save so a playlist that was dragged out of its folder is filed back.

This is cosmetic, not structural: nothing resolves a scene or a cue board *by folder*. Ownership is
determined by the `flags.coffee-pub-minstrel.type` flag alone, so a playlist that ends up in the wrong
folder still works. The folder exists to keep the sidebar navigable.

## Window state

`windowStateMinstrel` persists the selected tab, the selected scene / cue / rule, the search boxes, the
channel and status filters, and the window position. It is written through
`_queueWindowStateSave(updates, { delayMs = 400 })` — a trailing debounce, because it is driven by
typing and dragging — and flushed on close by `_flushWindowStateSave`.

`sceneDetailsEditMode` is deliberately **not** restored from storage: it is derived at construction as
`!state.selectedSoundSceneId`, so reopening the window with no scene selected lands in edit mode and
reopening with one selected lands in view mode. `cueEditMode` is likewise forced to `false` on open.
Persisting either would restore the user into a half-finished edit with a draft that no longer matches
the document.
