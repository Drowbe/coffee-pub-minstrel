# Sound scenes — Architecture

**Audience:** Contributors to the Minstrel codebase.

A sound scene is a reusable audio program: one or more music tracks played in sequence, any number of
ambient beds, and scheduled one-shots that fire on a timer. This is the largest and most timing-sensitive
subsystem in the module.

**Files:**

| File | Role |
|---|---|
| `scripts/manager-soundscenes.js` | The whole subsystem: model, save, activation, scheduling, stop |
| `scripts/manager-runtime.js` | Scene clock, scheduled handles, music sequence handle, layer activity |
| `scripts/manager-playlists.js` | Every actual play/stop the scene performs |

## A scene is a playlist

There is no scene record. A sound scene **is** a `Playlist` document with
`flags.coffee-pub-minstrel.type = 'scene'`, named `[SOUND SCENE] <name>`, filed in the "Sound Scenes"
folder, with `mode: DISABLED` so Foundry's own playlist controls never drive it.

| Data | Lives on |
|---|---|
| Scene name, description, background, tags, fades, `restorePreviousOnExit` | `flags.coffee-pub-minstrel.sceneMeta` on the playlist |
| Layer type, volume, fades, delay, frequency, loop mode, enabled, `sourceTrackRef` | `flags.coffee-pub-minstrel.layerMeta` on each `PlaylistSound` |

`buildSoundSceneFromPlaylist(playlist)` is the read model — it reconstitutes the scene object the rest of
the code works with, sorting layers by `sound.sort`. `saveSoundScene` is the write model, diffing draft
layers against existing sounds into create / update / delete operations rather than recreating the
playlist.

### Layers hold a copy, and remember their source

A scene layer's `PlaylistSound` is a **copy inside the scene playlist**, not a reference to the library
track it was built from. The original is preserved in `layerMeta.sourceTrackRef`.

This is worth internalizing, because a lot follows from it:

- A scene plays sounds that live in the scene's own playlist. Changing the library track later does not
  change the scene.
- Persisted duration flags are inherited by the copy through `toObject()`, so a scene built from probed
  tracks already knows its durations.
- **Scene playback never changes a row on the Dashboard or Playlists tabs**, because those tabs render
  library playlists and the scene's sounds are not among them. This is precisely what the render
  fingerprint in [architecture-window](architecture-window.md) exploits.
- Scene layer rows currently show the scene playlist rather than the source playlist, which is a known
  usability gap (`documentation/todo.md`).

## Three layer types

| Layer type | Foundry channel | Behavior |
|---|---|---|
| `music` | `music` | Played one at a time, in sequence, each advancing to the next at its end |
| `environment` | `environment` | Started together, optionally after `startDelayMs`, looped |
| `scheduled-one-shot` | `interface` | Fired on a `frequencySeconds` timer, or once if `loopMode !== 'loop'` |

`normalizeLayerType` falls back to the sound's channel when `layerMeta.layerType` is missing, so a layer
created outside Minstrel still classifies sensibly.

## Activation

`activateSoundScene(id)` waits for audio unlock, optionally snapshots current playback for later restore,
then calls `startSoundSceneCycle(scene, musicIndex, { resetEverything })`. The whole body is wrapped in
`PlaylistManager._beginBatch()` / `_endBatch()` so the multi-layer start produces one runtime sync.

`resetEverything` is the distinction between **starting** a scene and **advancing** it:

- `true` — a fresh activation. Ambient layers and one-shots are (re)scheduled from zero.
- `false` — the music sequence advancing to its next track. Ambient and one-shot layers are left alone,
  because restarting them at every music change would be audible and wrong.

**Ambient beds already playing are preserved across activation.** Before stopping the outgoing scene,
activation collects the undelayed ambient layers that are already playing and passes them to
`stopPlaylistExcept` as exceptions — so a shared bed continues rather than stopping and restarting.

## Four kinds of timer, and why each is tracked separately

Every timer is registered in `RuntimeManager` so shutdown can cancel all of them. They are kept in
distinct buckets because the stop verbs need to cancel them **selectively**:

| Timer | Handle | Cancelled by |
|---|---|---|
| Music sequence advance | `musicSequenceHandle` | `stopMusicPlayback`, scene stop |
| Delayed environment start | scheduled handle, `layerType: 'environment'` | `stopEnvironmentPlayback`, scene stop |
| One-shot recurrence | scheduled handle, `layerType: 'scheduled-one-shot'` | `stopOneShotPlayback`, scene stop |
| One-shot "mark inactive" follow-up | `scheduledLayerFollowupTimeouts` | `stopOneShotPlayback`, shutdown |

Scheduled handles carry a `layerType` tag for exactly this reason — without it, per-channel cancellation
could not tell an environment timer from a one-shot timer.

### "Stop" means stop

Channel stop buttons are global mixer controls, and each one cancels the scene timers feeding its
channel — not just the audio currently audible. **Stop Music** cancels the music sequence, so music does
not return at the current track's end. **Stop Environment** cancels pending delayed starts, so a delayed
layer cannot begin after the stop. **Stop One-Shots** cancels recurrence timers and their follow-ups.
Cancelled timers stay cancelled until the scene is re-activated.

One deliberate exception: `stopOneShotPlayback` leaves **cue duck-restore timers running**. Those restore
music and environment volume after a cue ducked them, and skipping them would leave the mix quiet
forever. See [architecture-cues](architecture-cues.md).

## Layer activity and the overlap guard

`RuntimeManager.markSceneLayerActive/Inactive(layerId)` tracks which layers are sounding. Its main job is
preventing one-shot pile-up: a one-shot whose recurrence interval is shorter than the track is long would
retrigger over itself, churning playlist documents. `triggerPlayback` returns early if the layer is
already active.

The layer is marked inactive by a follow-up timer sized from the track's duration + 150ms. That timer
**always schedules**, even when the duration could not be probed — an earlier version only scheduled it
on a successful probe, which leaked one permanently-active layer per trigger.

## The scene clock

`RuntimeManager.setSceneClock({ soundSceneId, startedAt, elapsedOffsetMs, durationSeconds, musicIndex })`
is what the Sound Scenes tab's master transport reads. It is a **computed** clock: nothing ticks it, and
the UI derives elapsed time from `startedAt` plus wall time.

`elapsedOffsetMs` comes from `computeMusicStartOffsetsSeconds`, so when the sequence advances to track 3
the master playhead jumps to track 3's offset in the program rather than restarting at zero.

The 1 Hz ticker that repaints it lives in the window, not here, and is wired through `_onRender` — see
[architecture-window](architecture-window.md) for why that placement is load-bearing.

## Stopping a scene

`stopActiveSoundScene({ restorePrevious })` waits for audio unlock (a stop is a document update, which
Foundry also rejects pre-unlock), cancels every scheduled handle and the music sequence, clears the
one-shot "already fired once" set, stops the music and ambient channels plus the scene playlist inside a
batch, and clears the clock and layer activity.

`restorePrevious` replays the snapshot taken at activation, so leaving a scene can return the session to
whatever was playing before it.

## Gotchas worth knowing before you edit

- **Audio unlock gates stops, not just plays.** Activation stops the outgoing scene *before* it plays
  anything, so an automation-driven scene start before the first user gesture hits the stop path first.
  Both `activateSoundScene` and `stopActiveSoundScene` await `waitForAudioUnlock()`.
- **`_endBatch` must be in a `finally`.** An exception mid-activation would otherwise leave the batch
  open and suppress every subsequent sync for the session.
- **One-shot initial delay has a 1s floor** and is at least one full frequency interval, so a one-shot
  never fires the instant a scene starts.
- **`getSoundScenes()` is cached** (`soundSceneCache`); every write path calls `invalidateCache()`.
