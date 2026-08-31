# Minstrel Module – Product & Technical Specification

## Overview

**Minstrel** is a sound orchestration module for FoundryVTT designed to enable fast, reliable, and immersive audio control during live gameplay.

The module focuses on:

* Rapid playlist control
* Reusable ambient audio configurations (“Sound Scenes”)
* Event-driven audio automation (e.g., combat start/end)
* Manual cue triggering for dramatic moments

Minstrel is built for **live GM use**, not backend audio management.

---

## Core Principles

* Fast, minimal-click interaction during gameplay
* Designed for real-time orchestration, not configuration-heavy workflows
* Layered audio model (music, ambient, cues)
* Non-destructive integration with Foundry’s existing audio system
* Fully aligned with Coffee Pub ecosystem architecture

---

## Required Technical Constraints

### Blacksmith API (MANDATORY)

All functionality must use **Coffee Pub Blacksmith APIs**.

* Do NOT bypass Blacksmith for:

  * UI creation
  * state management
  * inter-module communication

All interactions should go through Blacksmith abstractions where available.

Reference:
https://github.com/Drowbe/coffee-pub-blacksmith/wiki

---

### Application Framework

* All UI must use **Application V2**
* Windows must be created via **Blacksmith Window API**
* No legacy Application or jQuery-based implementations
* No direct DOM manipulation outside approved patterns

---

### Compatibility Targets

* Architected for FoundryVTT v13 

---

## Core User Goals

The module must enable the GM to:

* Quickly switch music and ambient audio
* Apply a full “mood” with a single action
* Automatically transition audio based on gameplay events
* Trigger one-shot sound effects instantly
* Avoid using Foundry’s default playlist sidebar during play

---

## Audio Model

Minstrel must implement a **layered audio system**:

### Layers

* Music Layer
* Ambient Layer
* Cue Layer (one-shot effects)

### Rules

* Multiple ambient layers allowed simultaneously
* Music is typically exclusive (one active at a time)
* Cues do not replace layers, they overlay
* Support independent volume and fade per layer
* Support crossfading between states

---

## Core Features (MVP)

### 1. Quick Playlist Control

#### Capabilities

* Browse playlists
* View active tracks
* Start, stop, pause, resume
* Skip tracks
* Adjust volume
* Fade in and fade out
* Mark favorites
* Track recently used items

#### Requirement

Must be accessible via a **single Minstrel panel**, not default Foundry UI.

We will also lever age the blacksmith menubar for quick access to the minstrel panel, swapping playlists, etc. 

---

### 2. Sound Scenes (Ambient Presets)

A **Sound Scene** is a reusable audio configuration.

#### Fields

* id
* name
* description
* tags
* linkedFoundryScenes (optional)
* music (playlist or track)
* ambientTracks (array)
* volumes per layer
* fadeIn
* fadeOut
* staggered start (optional)
* restorePreviousOnExit (boolean)
* enabled

#### Behavior

* Activating a Sound Scene applies all defined layers
* Previous state may be saved and restored
* Supports manual and automated triggering

---

### 3. Event-Based Automation

#### Core Events (Phase 1)

* combatStart
* combatEnd
* sceneActivate
* manualTrigger

#### Example Behaviors

* On combatStart:

  * Save current state
  * Fade out exploration audio
  * Start battle music

* On combatEnd:

  * Stop battle layer
  * Restore previous state after delay

* On sceneActivate:

  * Load linked Sound Scene

#### Requirements

* Rules-based system (not hardcoded triggers)
* Support:

  * conditions
  * priorities
  * enable/disable

---

### 4. Cue Board (Manual Triggers)

A **Cue** is a one-shot sound trigger.

#### Fields

* id
* name
* icon
* category
* audioSource
* volume
* cooldown
* duckOthers (boolean)
* stopOnSceneChange (boolean)

#### Capabilities

* Trigger instantly via UI
* Visual grid of buttons
* Optional cooldown to prevent spam
* Optional ducking of music layer

---

## UI / UX Requirements

### General

* Single unified Minstrel panel
* Built using Application V2 via Blacksmith
* Optimized for live GM use

---

### Panel Sections

#### Now Playing

* Active music
* Active ambient layers
* Recent cues
* Volume and fade indicators

#### Scenes

* List of Sound Scenes
* Trigger, edit, favorite
* Assign to Foundry scene

#### Cues

* Grid layout
* Icon-based buttons
* Fast trigger access

#### Playlists

* Lightweight browser
* Favorites and recent

#### Automation

* Rule list
* Event, condition, action
* Enable or disable toggles

---

## Data Model

### Sound Scene

```json
{
  "id": "string",
  "name": "string",
  "description": "string",
  "tags": [],
  "linkedSceneIds": [],
  "music": {},
  "ambientTracks": [],
  "volumes": {},
  "fadeIn": 0,
  "fadeOut": 0,
  "restorePreviousOnExit": true,
  "enabled": true
}
```

---

### Cue

```json
{
  "id": "string",
  "name": "string",
  "icon": "string",
  "category": "string",
  "audioSource": "string",
  "volume": 1.0,
  "cooldown": 0,
  "duckOthers": false,
  "stopOnSceneChange": false
}
```

---

### Automation Rule

```json
{
  "id": "string",
  "name": "string",
  "eventType": "string",
  "conditions": [],
  "actions": [],
  "priority": 0,
  "enabled": true
}
```

---

### Runtime State

```json
{
  "activeSoundScene": null,
  "previousSoundScene": null,
  "activeMusic": null,
  "activeAmbientLayers": [],
  "recentCues": [],
  "combatState": false
}
```

---

## Automation Roadmap

### Phase 1

* combatStart
* combatEnd
* sceneActivate
* manualTrigger

### Phase 2

* bossCombatStart
* regionEnter
* journalOpen
* turnStart
* roundStart

---

## API Requirements

Expose a public API for integration:

* playSoundScene(id)
* stopSoundScene(id)
* triggerCue(id)
* enterCombatState()
* exitCombatState()
* getCurrentAudioState()

All API interactions must follow **Blacksmith-compatible patterns**.

---

## Permissions & Scope

* GM-first design
* Future support for:

  * player-triggered cues (optional)
  * per-client audio differences
  * broadcast/display mode

Do not assume a single global audio state long-term.

---

## Module Interoperability

Must support:

* macro execution
* socket-based triggers
* integration hooks for:

  * Scribe (narrative)
  * Broadcast modules
  * future Coffee Pub modules

---

## Development Phases

### Phase 1 (MVP)

* Playlist control
* Sound Scenes
* Combat automation
* Cue Board

---

### Phase 2

* Scene-linked audio
* Expanded automation rules
* Restore/override logic
* Public API

---

### Phase 3

* Region triggers
* Boss logic
* Broadcast audio separation
* Per-client audio routing

---

## Key Design Directive

This is not a playlist manager.

This is a **real-time audio performance system for tabletop gameplay**.

Every design decision should prioritize:

* speed
* clarity
* reliability during live sessions
