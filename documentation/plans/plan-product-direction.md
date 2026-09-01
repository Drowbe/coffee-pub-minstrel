# Coffee Pub Minstrel User Guide

## Purpose

Minstrel is the live-session audio console for Coffee Pub games.

It is meant to help the GM:

- start and stop music quickly
- build reusable ambient sound environments
- trigger dramatic cues
- automate common transitions like combat start/end

Minstrel is **not** primarily a raw asset manager. Foundry playlists remain the source of truth for the underlying audio documents.

---

## Core Concepts

### Foundry Playlists Are The Source

Audio should still live in Foundry playlists and playlist sounds.

Minstrel reads and controls those sounds. It should not create a second conflicting audio system.

Important Foundry fields already matter:

- `Music` channel = music layer
- `Environment` channel = ambience layer
- `Interface` channel = cue / one-shot layer

---

### What A Scene Is

A **Sound Scene** should represent the **holistic sound environment** for a moment, place, or encounter.

Examples:

- `Dock Market at Noon`
- `Stormy Road at Night`
- `Goblin Ambush`
- `Ancient Shrine Interior`

A Sound Scene is not just a single music track. It is the **stack of active sound tracks** that together create the mood.

At minimum, a scene should define:

- one optional music layer
- zero or more persistent environment tracks
- zero or more scheduled one-shot/interface tracks
- per-layer volume
- per-layer start delay
- per-layer repeat / loop behavior
- per-layer cadence for recurring one-shots
- fade behavior
- whether the previous audio state should restore when the scene ends

### Important Boundary

Persistent environment belongs in **Scenes**.

Manual dramatic triggers belong in **Cues**.

That means:

- looping rain, crowd murmur, tavern roomtone, wind, battle music = Scene material
- a wolf howl every 2 minutes = Scene material
- a thunder crack you fire on demand = Cue material
- a sudden dramatic hit you trigger manually = Cue material

So a Scene is not just “music plus ambience”. It is the **programmed environment stack** for the current place or moment.

---

## Intended Workflow

### Before A Session

1. Organize sounds in Foundry playlists.
2. Make sure each playlist sound has the correct Foundry audio channel.
3. Use Minstrel to identify favorite tracks.
4. Build reusable Sound Scenes for locations, moods, and combat states.
5. Build Cues for one-shots.
6. Add automation for common transitions.

### During A Session

1. Use a Scene to set the current environment quickly.
2. Trigger Cues for dramatic beats.
3. Fall back to the Playlist tab only when ad hoc manual control is needed.
4. Use automation to handle recurring transitions.

---

## Tabs

### Dashboard

The dashboard should answer:

- what music is playing?
- what ambience is active?
- what scene is active?
- what are my recent/favorite items?

This is status, not deep editing.

### Playlists

The Playlist tab is the manual control surface.

Use it to:

- search tracks
- preview tracks
- stop / pause / resume
- adjust volume
- mark favorites
- find candidates for scenes

This tab should feel like a fast operations console, not a complicated editor.

### Scenes

This should become the **primary workflow** of Minstrel.

If Scenes are correct, Minstrel becomes useful.
If Scenes are weak, the whole module feels unclear.

Scenes should let the GM define:

- what music is playing, if any
- what environment tracks are active
- what scheduled one-shot/interface tracks recur automatically

Then the GM can still:

- fire a Cue manually whenever needed
- swap music manually if needed

### Cues

Cues are one-shot triggers.

Use them for:

- dramatic hits
- stingers
- interface-style effects
- short triggered moments that should not become part of the persistent environment

### Automation

Automation connects events to scenes or transitions.

Examples:

- `combatStart` -> switch to battle scene
- `combatEnd` -> restore prior scene/state

---

## Scenes: What The UI Should Communicate

The current implementation is not clear enough.

The Scene editor should make it obvious that the user is building a **layer stack**.

### Expected Layout

The expected layout should be closer to other Coffee Pub modules:

- left pane: Scene list
- right pane: selected Scene details
- right pane body: editable track stack / layer stack

This is closer to the Recipe Browser / Crafting Station pattern:

- browse/select on the left
- build/edit on the right

That is easier to understand than the current giant form.

### Expected Mental Model

The GM should see something closer to:

- Scene metadata at the top of the details pane
- a stack of sound tracks below
- each track editable as a row/card
- explicit `Add Layer` control
- clear distinction between:
  - music
  - environment
  - scheduled one-shot

### Expected Scene Layer Row

Each layer row should make sense on its own.

At minimum a layer row should show:

- layer type
  - music
  - environment
  - scheduled one-shot
- source track
- volume
- fade in
- fade out
- start delay
- repeat / loop behavior
- repeat interval or cadence when relevant
- enabled toggle
- remove layer

Nice next additions:

- order / drag-to-reorder
- loop spacing / repeat delay if the underlying sound model supports it
- per-layer notes / tags

### Important Implementation Rule

If Foundry already stores a property on the playlist sound document, Minstrel should prefer using or surfacing that property rather than inventing a parallel conflicting setting.

Examples:

- audio channel
- looping / repeat behavior
- fade duration if already available on the sound

Scene-specific settings should only exist when they represent **activation behavior** rather than raw document identity.

Good scene-specific settings:

- start delay
- stagger order
- per-scene layer volume override
- scheduled interval / cadence for recurring one-shots
- restore previous on exit

---

## Scenes: Recommended Data Model

The current scene model is too coarse. The target mental model should be closer to:

```js
{
  id,
  name,
  description,
  tags,
  enabled,
  favorite,
  restorePreviousOnExit,
  layers: [
    {
      id,
      type: "music" | "environment" | "scheduled-one-shot",
      trackRef,
      volume,
      fadeIn,
      fadeOut,
      startDelayMs,
      loopMode,
      intervalMs,
      enabled
    }
  ]
}
```

This is clearer than splitting one special `music` field and one bulk `ambientTracks` array in the UI.

Internally, the implementation may still optimize music vs ambience behavior differently, but the **user-facing model** should still feel like a stack of tracks.

---

## Scenes: Fastest High-Value Features

To make Scenes usable quickly, prioritize:

1. left-list / right-details Scene layout
2. layer-stack editing UI
3. simple sound selection workflow
4. `Save Current As Scene`
5. `Play Scene`
6. `Duplicate Scene`
7. `Favorite Scene`
8. per-layer volume / delay / fade / repeat controls

### Simple Sound Selection Is Critical

Adding sounds must be easy.

Expected good options:

- drag and drop from the Foundry playlist sidebar into the Scene layer stack
- drag and drop from a Minstrel sound selector panel
- an internal picker panel similar to the Artificer recipe/components/craft-area workflow

The current “large checkbox list” model is not acceptable for long-term use.

The preferred direction is likely:

- left: Scene list
- middle: sound selector / search panel
- right: Scene layer stack / details

or

- left: Scene list
- right: Scene details with an `Add Sound` action that opens a Minstrel selector panel

The goal is that adding a sound should feel like **curating a stack**, not filling out a form.

### Save Current As Scene

This is likely the highest-value feature in the module.

If the GM already has a good live mix running, they should be able to capture it as a scene instead of rebuilding it manually.

---

## Current UX Assessment

The current Scene editor is not good enough for live use.

Why it feels bad:

- it does not communicate the layer-stack model
- it mixes metadata and configuration without hierarchy
- ambience selection as a giant checkbox list is hard to reason about
- it does not support the programmed one-shot environment model clearly
- there is no obvious “this is the environment I am constructing” feeling
- the difference between Scene, Playlist, and Cue is not visually clear enough

That means the next major UX pass should focus on **Scenes first**.

---

## Product Direction

The recommended product hierarchy is:

- **Scenes** = primary live orchestration workflow
- **Cues** = one-shot triggers
- **Playlists** = source library and manual fallback
- **Automation** = convenience layer on top

If Minstrel succeeds, it will be because Scenes become fast, legible, and powerful.
