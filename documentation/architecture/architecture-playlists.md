# Playlists and playback — Architecture

**Audience:** Contributors to the Minstrel codebase.

`manager-playlists.js` is the audio layer: **the only module that plays, stops, fades or pauses
anything.** Sound scenes, cues and automation all express themselves as calls into it. If you are adding
something that makes noise, it belongs here and gets called from above.

**Files:**

| File | Role |
|---|---|
| `scripts/manager-playlists.js` | Track refs, channels, durations, playback verbs, the playlist summary |
| `scripts/manager-runtime.js` | Where "what is currently playing" is recorded |

## Track refs are the currency

Nothing in Minstrel passes a `PlaylistSound` around. Everything passes a **track ref**, built by
`createTrackRef(sound)`:

```js
{ playlistId, soundId, label, playlistName, soundName, path, volume, playing, channel }
```

It is a plain snapshot object — safe to store in settings, compare, and put in a template context.
`resolveTrackRef(ref)` turns one back into live `{ playlist, sound }` documents, returning nulls if
either has been deleted. **Never hold a `PlaylistSound` across an await**; resolve from a ref each time.

The string form `"playlistId::soundId"` is the DOM/serialization form, parsed by `parseTrackRefValue`.
Row elements key off it, and cue ids use the same shape.

`isSameRef(a, b)` compares by `playlistId` + `soundId` only. Use it rather than object identity or deep
equality — two refs for the same sound built at different times will differ in `volume` and `playing`.

## Channels: Minstrel's three names for Foundry's three

Foundry's `PlaylistSound#channel` is `music` / `environment` / `interface`. Minstrel normalizes those to
`music` / `ambient` / `cue`, with anything unrecognized becoming `unknown`.

| Foundry | Minstrel | Used for |
|---|---|---|
| `music` | `music` | Scene music, the music sequence |
| `environment` | `ambient` | Ambient / environment layers |
| `interface` | `cue` | Cues and scheduled one-shots |

`getSoundChannel` reads the channel through a **six-candidate fallback chain** (`sound.channel`,
`_source.channel`, `audioChannel`, `_source.audioChannel`, `audio.channel`, `toObject().channel`). That
is not defensive padding: the property has moved between Foundry versions and between a live document and
a `_source` snapshot, and a sound whose channel resolves to `unknown` silently drops out of every
channel-scoped stop. If a stop stops everything except one track, check this first.

## Duration resolution is a three-step ladder

Durations matter because the sound scene timeline lays out from them. Resolution order:

1. **Live buffer** — `getTrackDurationSecondsFromSound` reads five possible properties off a playing
   sound. Free and exact when the track is already loaded.
2. **Persisted flag** — `flags.coffee-pub-minstrel.durationSeconds` on the `PlaylistSound`. Written
   once, GM-only, fire-and-forget, on the first successful probe. Scene playlist copies inherit it
   through `toObject()`, so a scene built from a probed track starts already knowing its durations.
3. **`Audio()` metadata probe** — `getDurationSecondsFromPath`, an LRU-cached network load of just the
   file metadata. Slowest; its result is then persisted so step 2 covers it next time.

`peekTrackDurationSeconds` is the **synchronous** fast path (steps 1–2 only, no probe). The scene editor
uses it so the timeline lays out correctly on first paint instead of re-rendering when probes resolve.

The persist step is guarded three ways: GM-only, positive-finite only, and skipped when an existing flag
is within 0.5s. The `.catch()` is deliberately silent — a missing permission or a deleted document is
expected, and the in-memory cache still covers the session.

## Batching, and why `sync` is a parameter

Most playback verbs take `{ sync = true }`. Scene activation plays several layers in sequence, and each
`PlaylistSound` update would otherwise trigger its own runtime sync and UI refresh. `_beginBatch()` /
`_endBatch()` bracket a multi-track operation; the individual calls pass `sync: false` and one sync runs
at the end via `_queueRuntimeSync()`.

If you add a verb, take the `sync` option and thread it through, or scene activation will regain the
per-layer refresh storm this exists to prevent.

## Stops are a family, not one function

Choosing the wrong one is the usual cause of "it did not stop":

| Verb | Stops |
|---|---|
| `stopTrack(ref)` | One track |
| `stopLayer(layer, …, exceptRef)` | One Minstrel layer, optionally sparing a ref |
| `stopLayersByChannels(channels, …)` | Everything on the named channels |
| `stopAmbientTracksNotInKeySet(keys)` | Ambient tracks *outside* a desired set — the scene-transition verb |
| `stopPlaylist(id)` / `stopPlaylistExcept(id, refs)` | One playlist, optionally sparing refs |
| `stopAllAudio()` | Everything Minstrel can see |

`stopAmbientTracksNotInKeySet` and `stopPlaylistExcept` exist so a scene change can keep a shared ambient
bed playing rather than stopping and restarting it — an audible glitch the "except" forms avoid.

**Stopping audio is not the same as stopping a scene.** These verbs stop *sounds*; they do not cancel the
timers that will start more. Cancelling those is `manager-soundscenes.js`'s job, and the UI-level stop
handlers in `MinstrelManager` deliberately do both. See [architecture-soundscenes](architecture-soundscenes.md).

## Audio unlock gates everything

Foundry throws on **any** `PlaylistSound` document update while audio is locked — including a *stop*,
because `_onUpdate` → `sync` → `_createSound`. `waitForAudioUnlock()` therefore gates scene activation,
scene stop, and the playback-normalization pass, not just the play paths. Post-gesture these awaits are
resolved no-ops. A UI-driven action is safe by construction: the click that triggered it is itself the
unlocking gesture.

## Caches

`invalidateCache(...keys)` clears the derived selector caches (playlist summary, track options, now
playing). Every internal write path invalidates synchronously; the `create/update/deletePlaylist(Sound)`
hooks exist only to catch **external or socket-driven** changes, and they run behind a 120ms trailing
debounce with a 480ms ceiling because fades emit `updatePlaylistSound` bursts.

`getPlaybackSignature()` is a compact fingerprint of what is playing, used by the window to decide whether
a render is needed at all. It deliberately **excludes volume and `pausedTime`** — both drift continuously
during a fade and were never rendered live, so including them would defeat the optimization entirely. See
[architecture-window](architecture-window.md).
