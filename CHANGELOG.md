# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [13.0.0] - Initial Build

### Added
- Initial Coffee Pub Minstrel module scaffold, manifest setup, release workflow wiring, localization root, and renamed entry script/module assets.
- Blacksmith ecosystem integration for:
  - Window API registration/opening
  - menubar tools, flyouts, and secondary controls
  - shared window shell and template styling
- World-backed Minstrel storage for:
  - favorites
  - recents
  - sound scenes
  - cues
  - automation rules
  - remembered window state and bounds
- Phase 1 MVP managers for playlists, sound scenes, cues, automation, runtime, and storage.
- Playlist browser with:
  - live search
  - channel/status filters
  - favorites and recents
  - play/pause/resume/stop controls
  - playlist favorites
- Sound Scene system with:
  - left-side scene browser
  - internal sound selector
  - right-side scene editor
  - scene card backgrounds
  - world favorites
  - save/play/stop/delete flows
- Unified scene layer model supporting:
  - single music layer
  - multiple environment layers
  - scheduled one-shot layers
  - per-layer volume
  - loop/repeat behavior
  - enabled state
  - frequency for repeating one-shots
- Scene timeline visualization with:
  - proportional clip-length bars
  - type-colored lanes
  - start markers
  - event markers
  - repeat markers
  - repeated clip bars for looped one-shots
  - timeline tooltips
- Cue management and trigger support.
- Automation scaffolding for combat-linked scene transitions and playback restoration.
- Menubar quick-access flyouts for:
  - sound/environment favorites
  - favorite scenes
  - favorite playlists
  - favorite one-shots

### Changed
- Replaced prototype/example setup with `Coffee Pub Minstrel` naming, descriptions, release URLs, and module identifiers.
- Switched audio classification to Foundry core playlist sound audio channels instead of Minstrel-only inference.
- Reworked the main Minstrel window to align more closely with Artificer/Blacksmith patterns:
  - cleaner pane headers
  - reduced custom button styling
  - shared footer/action treatment
  - icon-first filters and toggles
- Rebuilt the Scene workspace into fixed-width `Scenes` and `Sounds` columns with a flexible editor column.
- Updated browser panes to use pinned controls with a single scrollable content region.
- Converted favorites from star icons to heart icons for Coffee Pub consistency.
- Renamed key menubar/window actions to clearer labels such as `Audio Workstation`, `Sound`, and `Stop Environment`.
- Moved primary transport controls into the bottom action bar layout and reduced low-value footer clutter.
- Improved scene/sound cards to use typed endcaps, tighter content-height rows, and clickable scene cards.
- Added CSS variable-driven layout controls for scene workspace columns, playlist rows, and scene layer rows.

### Fixed
- Fixed the `ApplicationV2.state` collision by moving Minstrel window UI state off the reserved `state` property.
- Fixed environment channel handling so environment tracks appear correctly in selectors and channel-specific actions.
- Fixed search inputs so typing no longer jumps the caret back to the first position after rerenders.
- Fixed slider readouts so scene layer volume percentages update live.
- Fixed menubar/flyout behavior to use the intended Blacksmith context-menu and flyout patterns.
- Fixed scene browser card rendering and selection behavior.
- Fixed scene/sound browser cards so they no longer stretch vertically to fill column height.
- Fixed desktop layout regressions caused by unnecessary responsive overrides on structured track rows.
- Improved duration lookup reliability for timeline rendering with metadata fallback support.

