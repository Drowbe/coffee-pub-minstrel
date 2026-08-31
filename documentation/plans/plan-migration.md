# Minstrel Storage Migration Plan

## Goal

Move Minstrel away from storing `Scenes` and `Cues` as large world-setting arrays and instead anchor them to native Foundry `Playlist` documents with Minstrel flags.

This improves:

- scalability
- portability
- compendium export/import
- visibility in the Foundry Playlist directory
- long-term maintainability

## Important Decision

There is **no legacy data migration requirement**.

This module is not live yet and the existing settings-backed scene/cue data can be discarded. We should optimize for the correct architecture, not backwards compatibility.

## Target Architecture

### Scenes

Each Minstrel Scene becomes a real Foundry `Playlist`.

Playlist flags define Minstrel scene metadata:

- `flags.coffee-pub-minstrel.type = "scene"`
- `backgroundImage`
- `tags`
- `restorePreviousOnExit`
- `enabled`
- `favorite`
- future:
  - time-of-day modes
  - trigger metadata
  - transition metadata

Playlist sounds remain native `PlaylistSound` documents and carry Minstrel layer/orchestration flags:

- `layerType = "music" | "environment" | "scheduled-one-shot"`
- `volume`
- `loopMode`
- `frequencySeconds`
- `enabled`
- future timing / sequencing metadata

### Cues

Each Cue Board becomes a real Foundry `Playlist`.

Playlist flags define Minstrel cue-board metadata:

- `flags.coffee-pub-minstrel.type = "cue-board"`
- `enabled`
- `favorite`
- optional category / grouping metadata

Playlist sounds represent the individual cues and carry Minstrel cue flags as needed:

- `cooldown`
- `duckOthers`
- `stopOnSceneChange`
- `enabled`
- `favorite`

This lets a cue playlist behave like a soundboard:

- battle board
- travel board
- comedy board
- horror board

### Automations

Automations stay separate from playlists.

They are Minstrel-owned structured data and should support:

- import JSON
- export JSON

Automations are orchestration/event logic, not audio containers, so they should not be modeled as playlists.

## Folder Strategy

We may use Foundry playlist folders such as:

- `Minstrel Scenes`
- `Minstrel Cues`

But folder placement is only organizational. The real source of truth is the Minstrel type flag on the playlist itself.

Minstrel must not depend on folder structure for correctness.

## What Must Change

### Remove Settings-backed Scene/Cue Persistence

Remove scenes and cues as primary storage from:

- `game.settings[coffee-pub-minstrel.soundScenes]`
- `game.settings[coffee-pub-minstrel.cues]`

These settings should no longer be treated as the source of truth.

### Replace Storage Accessors

Refactor:

- `StorageManager.getSoundScenes()`
- `StorageManager.saveSoundScenes()`
- `StorageManager.getCues()`
- `StorageManager.saveCues()`

So they operate against native playlists and flags instead of module settings arrays.

### Replace Managers

Refactor:

- `SoundSceneManager`
- `CueManager`

So they:

- query Foundry playlists by Minstrel flag type
- read/write scene and cue metadata via playlist and playlist-sound flags
- create/delete/update native playlist documents as needed

### UI Expectations

The Minstrel UI should continue to present:

- scenes
- cue boards
- soundboards
- scene layers

But the underlying records should now come from native playlists.

The Foundry Playlist tab/sidebar should also reflect Minstrel-managed assets naturally, because they are real playlists.

## Scene Mapping

### Playlist-level Scene Fields

- `id` -> native playlist id
- `name` -> playlist name
- `description` -> playlist description or Minstrel flag
- `backgroundImage` -> Minstrel flag
- `tags` -> Minstrel flag
- `restorePreviousOnExit` -> Minstrel flag
- `enabled` -> Minstrel flag
- `favorite` -> Minstrel flag

### PlaylistSound-level Scene Fields

- source sound document remains native Foundry data
- Minstrel flags add:
  - `layerType`
  - `volume`
  - `loopMode`
  - `frequencySeconds`
  - `enabled`

## Cue Mapping

### Playlist-level Cue Board Fields

- `id` -> native playlist id
- `name` -> playlist name
- `enabled` -> Minstrel flag
- `favorite` -> Minstrel flag

### PlaylistSound-level Cue Fields

- sound identity remains native Foundry data
- Minstrel flags add:
  - `cooldown`
  - `duckOthers`
  - `stopOnSceneChange`
  - `enabled`
  - `favorite`

## Cutover Plan

### Phase 1

- introduce playlist/playlist-sound flag schema
- build helpers for:
  - scene playlists
  - cue-board playlists
  - playlist sound flag reads/writes

### Phase 2

- switch `SoundSceneManager` reads to playlist-backed scenes
- switch `CueManager` reads to playlist-backed cue boards
- switch scene/cue save/delete flows to native playlist document operations

### Phase 3

- update UI assumptions where needed:
  - scene creation creates a scene playlist
  - cue-board creation creates a cue playlist
  - scene layer edits write sound flags
  - cue edits write sound flags

### Phase 4

- remove scene/cue settings as active storage
- keep automation settings/import-export path
- verify playlist sidebar / compendium portability workflows

## Non-Goals

- no attempt to migrate existing settings-backed scene/cue data
- no reliance on folder hierarchy for logic
- no playlist duplication unless a real workflow requires it

## Expected Outcome

After cutover:

- scenes are portable as playlists
- cue boards are portable as playlists
- users can manage/export/import them through native Foundry playlist and compendium workflows
- automations remain explicitly import/exportable JSON from the Audio Workstation
