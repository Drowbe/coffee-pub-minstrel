# Dashboard — Architecture

**Audience:** Contributors to the Minstrel codebase.

The Dashboard is the tab a GM lives on during play: what is playing now, favorited scenes, playlists,
tracks and cues, and the transport for all of it. It owns almost no logic — it is a **projection** of the
other subsystems, and its architecture is mostly about not rebuilding that projection too often.

**Files:**

| File | Role |
|---|---|
| `scripts/manager-minstrel.js` | `getDashboardData()`, `getHeaderPlaybackContext()`, `getPlaybackBodySignature()` |
| `scripts/window-minstrel.js` | The dashboard branch of `getData()`, rack search filtering |
| `templates/partials/window-minstrel-body.hbs` | Dashboard markup |

## It is a cache, and the cache is the design

`getDashboardData()` builds one object and memoizes it in `MinstrelManager._dashboardCache`. The cache is
cleared by `requestUiRefresh({ invalidateDashboard: true })` — the default — so any caller that changes
data invalidates it implicitly, and a caller that only changed *playback* can pass
`invalidateDashboard: false` and keep it.

That flag is the whole point. Playback events are frequent and change nothing the dashboard *derives*;
they change only what it *displays as playing*. So the scene-driven refresh paths pass
`invalidateDashboard: false`, and the dashboard's expensive derivation survives an entire scene.

The built object:

| Key | From |
|---|---|
| `nowPlaying` | `PlaylistManager.getNowPlaying()` |
| `favoriteCues` | `CueManager.getCues()`, filtered, with a `cardStyle` tint precomputed |
| `favoriteScenes` | `SoundSceneManager.getSoundScenes()`, filtered, each flagged `isActive` |
| `favoritePlaylists` | `PlaylistManager.getPlaylistSummary()`, filtered |
| `favoriteTracks` | Sounds inside the playlist summary that are favorited |
| `activeSoundScene` | The scene matching `RuntimeManager`'s active id |

## Two single passes, deliberately

Both loops in the builder were rewritten and the shape matters:

- **Scenes** are walked once, picking favorites and the active scene together, rather than a `find` plus
  a `filter`.
- **Sounds** are walked once and **only the favorites are spread**. The previous `flatMap` allocated a
  copy of *every track in the world* per rebuild, to then discard all but a handful. In a large library
  that was the single biggest allocation in the module.

If you add a derived dashboard field, add it inside an existing pass rather than opening a new one over
the same collection.

## Tint precomputation

`favoriteCues` carries a `cardStyle` string built from the cue's tint (`--cue-tint` plus a 0.18-alpha
`--cue-tint-soft`). It is computed in the builder rather than in the template because Handlebars has no
colour maths and a helper would run per card per render. The cache means it runs once per data change.

## The playback signature folds in the active scene

`getPlaybackBodySignature()` is `activeSoundSceneId + '|' + PlaylistManager.getPlaybackSignature()`.

The scene id is folded in specifically for this tab: the favorite-scene cards render an `isActive` flag,
so a scene going active or inactive genuinely changes the Dashboard's markup even when no track changed.
Without that prefix, activating a scene whose tracks were already playing would leave a stale "not
active" card. See [architecture-window](architecture-window.md) for how the signature is used.

`getHeaderPlaybackContext()` is the cheap sibling for the *other* tabs — now-playing plus active scene,
nothing derived — because the header chrome is rendered everywhere but the full dashboard build is not
needed off-tab.

## Search is DOM-only

The three rack search boxes (scenes, playlists, cues) filter through
`_applyDashboardRackSearchFilter(rackName, search)`, which shows and hides rows in place. Typing never
triggers a render. The terms are held in `uiState` (`dashboardSceneSearch`, `dashboardPlaylistSearch`,
`dashboardCueSearch`) and persisted with the window state, and `getData()` also applies them when a real
render happens, so the filtered view survives one.

Both halves are needed: the DOM path keeps typing cheap, the `getData` path keeps the filter correct
across a render that the DOM path knows nothing about.

## What the Dashboard does not own

Nearly everything. The transport buttons call `MinstrelManager.stop*FromUi` methods shared with the
menubar and the right-click sound menu; favorites are stored by `manager-storage.js`; scene activation is
`manager-soundscenes.js`. When something on the Dashboard misbehaves, the bug is almost always in the
subsystem it is projecting — check there before this tab.
