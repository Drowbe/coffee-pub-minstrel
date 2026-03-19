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
  - scene-scoped background image browsing
  - clickable sound preview cards
- Playlist-backed Minstrel scene persistence using native Foundry playlists with Minstrel flags for scene metadata and scene track behavior.
- Playlist-backed Minstrel cue-board persistence using native Foundry playlists/sounds with Minstrel flags.
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
- `migration.md` documenting the cutover from hidden settings-backed scene/cue storage to native playlist-backed Minstrel data.
- `todo.md` tracking future work such as:
  - time-of-day scene modes
  - real-time preview mode while editing scenes

### Changed
- Replaced prototype/example setup with `Coffee Pub Minstrel` naming, descriptions, release URLs, and module identifiers.
- Switched audio classification to Foundry core playlist sound audio channels instead of Minstrel-only inference.
- Moved scene/cue persistence off hidden settings arrays and onto real Foundry playlists flagged as Minstrel scenes and cue boards.
- Reworked the main Minstrel window to align more closely with Artificer/Blacksmith patterns:
  - cleaner pane headers
  - reduced custom button styling
  - shared footer/action treatment
  - icon-first filters and toggles
- Reworked the scene details header so restore/enabled/favorite controls live with the scene actions and all scene actions use the shared icon-action treatment.
- Reworked the scene detail form layout into a tighter editing grid with:
  - title
  - card background path/browser
  - tags
  - fade values
  - reduced-height description
- Rebuilt the Scene workspace into fixed-width `Scenes` and `Sounds` columns with a flexible editor column.
- Updated browser panes to use pinned controls with a single scrollable content region.
- Converted favorites from star icons to heart icons for Coffee Pub consistency.
- Renamed key menubar/window actions to clearer labels such as `Audio Workstation`, `Sound`, and `Stop Environment`.
- Moved primary transport controls into the bottom action bar layout and reduced low-value footer clutter.
- Improved scene/sound cards to use typed endcaps, tighter content-height rows, and clickable scene cards.
- Converted scene and sound browser card actions to the shared icon-action style.
- Updated scene-facing terminology to use `tracks` in the UI rather than `layers`.
- Replaced the top metrics strip with:
  - `Now Playing`
  - `Music Volume`
  - `Environment Volume`
  - `Interface Volume`
- Added global audio channel sliders in the top strip that resolve and update Foundry core audio settings at runtime.
- Added CSS variable-driven layout controls for scene workspace columns, playlist rows, and scene layer rows.
- Simplified playlist controls:
  - removed `Skip`
  - removed per-track `Pause` / `Resume`
  - replaced manual volume apply with auto-saving volume sliders
  - converted play/stop/favorite controls to the shared icon-action style
- Reworked playlist grouping and ordering so playlists sort alphabetically, same-name playlists separate by type, and sounds sort alphabetically within each playlist.
- Filtered Minstrel-owned playlists out of source-library views so scenes and cue boards do not recurse back into the playlist browser or sound selector.

### Fixed
- Fixed the `ApplicationV2.state` collision by moving Minstrel window UI state off the reserved `state` property.
- Fixed environment channel handling so environment tracks appear correctly in selectors and channel-specific actions.
- Fixed playlist filtering so channel-filtered views hide playlist groups with no matching sounds.
- Fixed search inputs so typing no longer jumps the caret back to the first position after rerenders.
- Fixed slider readouts so scene layer volume percentages update live.
- Fixed menubar/flyout behavior to use the intended Blacksmith context-menu and flyout patterns.
- Fixed scene browser card rendering and selection behavior.
- Fixed scene/sound browser cards so they no longer stretch vertically to fill column height.
- Fixed desktop layout regressions caused by unnecessary responsive overrides on structured track rows.
- Improved duration lookup reliability for timeline rendering with metadata fallback support.
- Fixed Foundry V12+ compatibility warning by switching deprecated `Sound#node` access to `Sound#sourceNode`.
- Fixed selector preview behavior so only one preview sound can play at a time.
- Fixed selector preview playback to audition locally at an audible preview volume.
- Fixed selector playing-state styling by tracking the active preview row and applying the playing class while the preview is active.
- Fixed scene/sound pane rerenders so selecting scenes or previewing sounds preserves scroll position instead of jumping back to the top.
- Fixed scene save behavior so saving an actively playing scene restarts that scene with the newly saved data.
- Removed stale settings-backed scene/cue registrations and dead storage methods so the codebase now matches the playlist-backed architecture.

