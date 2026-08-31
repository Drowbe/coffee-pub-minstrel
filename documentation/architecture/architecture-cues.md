# Cues — Architecture

**Audience:** Contributors to the Minstrel codebase.

A cue is a one-shot dramatic sound the GM fires by hand — a horn, a scream, a door. Cues are grouped into
boards, can duck the music underneath them, and can carry a cooldown so a fat-fingered double click does
not double-fire.

**Files:**

| File | Role |
|---|---|
| `scripts/manager-cues.js` | Boards, the cue model, trigger, duck, cooldown |
| `scripts/manager-runtime.js` | Cooldown map, active cue refs, recent cues |

## A cue board is a playlist

Same pattern as sound scenes. A cue board **is** a `Playlist` with
`flags.coffee-pub-minstrel.type = 'cue-board'`, named `[CUE] <board>`, filed in the "Cue Boards" folder.
Each cue is a `PlaylistSound` inside it, carrying `flags.coffee-pub-minstrel.cueMeta`.

| Data | Lives on |
|---|---|
| Board name | `cueBoardMeta` on the playlist |
| Icon, tint, volume, cooldown, `duckOthers`, `stopOnSceneChange`, favorite, enabled, `sourceTrack` | `cueMeta` on the `PlaylistSound` |

A cue's id is the composite string `"playlistId::soundId"` — the same shape as a track ref's DOM value —
parsed by `parseCueId`.

`ensureCueBoardPlaylist(boardName)` matches an existing board by `cueBoardMeta.boardName` *or* by the
playlist's display name with the `[CUE]` prefix stripped, both case-insensitively. That dual match is
what lets a board renamed in the Playlists sidebar still resolve.

## Source track resolution has three fallbacks

`buildCueFromSound` resolves the track a cue plays in this order:

1. **`cueMeta.sourceTrack`** — the sanitized ref recorded when the cue was created. The normal path.
2. **`resolveLegacySourceTrack(sound)`** — a path match against every non-cue-board track in the world,
   for cues created before `sourceTrack` was recorded.
3. **`createTrackRef(sound)`** — the cue's own sound, as a last resort.

Step 2 excludes cue-board playlists from its candidates deliberately: without that filter a cue would
match its own copy and the "legacy" resolution would be a no-op that looks like a success.

## Triggering a cue

`triggerCue(cueId)` runs a fixed sequence. Every step after the cooldown check is conditional, but the
order is not negotiable:

1. **Reject if disabled, trackless, or on cooldown.**
2. **Duck**, if `duckOthers` — snapshot the current music and ambient volumes, then fade those tracks to
   0.45. The snapshot is taken *before* the cue plays, so the restore targets the pre-cue mix.
3. **Play** on the `cue` channel, non-exclusive, no fade-in.
4. **Schedule the duck restore** at a flat 2500ms.
5. **Record** the cue as recent, arm its cooldown, and — if `stopOnSceneChange` — add its ref to the
   active-cue set.
6. **Schedule the cue-end cleanup**, sized from the track duration.

### The duck restore is a fixed 2.5 seconds

It is not derived from the cue's length. A cue longer than 2.5s will have the music come back up
underneath it while it is still playing. This is a deliberate simplification, not an oversight — but it
is the first thing to look at if someone reports the mix "coming back too early."

The restore timer is registered as a module deferred timeout, so shutdown cancels it. That has a
consequence worth stating: **shutting down mid-duck leaves the mix ducked.** The volumes are real
`PlaylistSound` volumes, not an overlay.

### The cue-end timer always schedules

`cueEndMs` is the track duration + 150ms, floored at 250ms — **or a flat 60s when the duration cannot be
resolved at all.** The fallback matters: an earlier version skipped the timer entirely on a zero
duration, so a `stopOnSceneChange` cue whose duration could not be probed leaked its active ref until the
next scene change, one per trigger.

The timer's job is to remove the active cue ref, resync runtime layers, and refresh the UI — the cue is
finished and should stop showing as playing.

## Cooldowns

`RuntimeManager.setCueCooldown(id, ms)` and `isCueOnCooldown(id)` implement a simple expiry map, with two
details worth knowing:

- `isCueOnCooldown` **deletes on read** when expired, so a re-checked cue cleans up after itself.
- `setCueCooldown` **sweeps the whole map** opportunistically on every write. Without it, a cue triggered
  once and never again would sit in the map for the whole session — the map only ever shrank when a
  specific cue was re-checked.

A cooldown of 0 arms nothing; `setCueCooldown` returns early.

## `stopOnSceneChange` and the active cue set

A cue flagged `stopOnSceneChange` adds its track ref to `RuntimeManager`'s active-cue set when it fires.
`stopSceneChangeCues()` stops every ref in that set with no fade and clears it; it is called from
`_runSceneStartAutomationOncePerCanvas` so a lingering cue does not bleed across a scene transition.

`addActiveCueRef` dedupes with the same `isSameRef` guard used for ambient tracks, so hammering one cue
does not stack duplicate refs.

## Where cues intersect the rest of the module

- **Scheduled one-shots in a sound scene are not cues.** They are scene layers of type
  `scheduled-one-shot`, play on the same `interface`/`cue` channel, and are managed entirely by
  `manager-soundscenes.js`. They share a channel, not an implementation.
- Because they share a channel, **Stop One-Shots stops both** — scene one-shots and triggered cues alike
  — and clears the active cue refs. It deliberately does *not* cancel the duck-restore timers, which must
  still fire or the mix stays quiet. This asymmetry is the subtlest thing in the stop path.
- `getCues()` is cached (`cueCache`); every write path calls `invalidateCache()`.
