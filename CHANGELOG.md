# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).


## [13.0.3]

### Added
- Playlist-backed automation storage under `Minstrel / Automations`, with one playlist per automation rule.
- Automatic automation migration from the legacy hidden world setting into playlist-backed automation documents.
- Dedicated Minstrel playlist folder structure with themed colors:
  - `Minstrel`
  - `Minstrel / Sound Scenes`
  - `Minstrel / Cue Boards`
  - `Minstrel / Automations`
- A GM-only `Minstrel Audio Workbench` toolbar entry for both the Foundry and Coffee Pub toolbars.
- Automation categories with cue-style category selection/creation and grouped category sections in the automation browser.
- Automation icon/tint customization, duplication, and the new `Scene Name Contains` rule type.

### Changed
- Underlying Minstrel playlist names now use explicit prefixes to avoid export/import and compendium collisions:
  - `[SOUND SCENE] ...`
  - `[CUE] ...`
  - `[AUTOMATION] ...`
- Automation UI continues to show clean rule names from flags while the underlying playlist name carries the prefix.
- Dashboard was rebuilt around three racks:
  - `Sound Scene Rack`
  - `Playlist Rack`
  - `Cue Rack`
- Dashboard playlist rack now supports favorited playlists and favorited tracks together, with row-click playback matching the Playlists tab.
- Scene-facing terminology was updated to `Sound Scene` across the menubar, dashboard, scenes tab, automation targets, folder names, and playlist prefixes.
- Automation `Priority` was replaced by `Importance` with `High`, `Normal`, and `Low`.
- Automation editor structure was clarified with a dedicated `Action to Take` section separate from `Ordered Rules`.
- Scene editing now auto-saves layer mutations without restarting the active sound scene, while detail editing remains intentional.
- Scenes use a cycle-based transport model driven by the current music track, with delayed/repeating layers resetting against that cycle.
- Cue, automation, and dashboard cards were tightened into a more consistent shared card pattern, and cue/editor category handling now mirrors automation where appropriate.
- Playlist and track favorites now live on Foundry playlist/playlist-sound flags instead of hidden settings.

### Fixed
- Automation playlist names no longer collide with ordinary playlists during compendium export/import.
- Minstrel-owned automation playlists are now hidden from the Playlists tab alongside scene and cue-board playlists.
- Scene and cue playlists are now created in the correct `Minstrel` subfolders instead of the playlist root.
- Dashboard playlist actions were restored after layout regressions so play/stop and favorite controls are visible again.
- Slider styling was normalized further so cue and playlist sliders no longer pick up stray boxed input styling, and volume sliders now support double-click reset to `50%`.
- Scene load normalization is now GM-only so player clients do not attempt playlist mutations on startup.
- Scene music active-state display now follows the actual runtime music track instead of stale editor order or disabled rows.
- Scene layer ordering, layer adds, and live layer volume edits now persist correctly without knocking active playback out of sync.
- Delayed environment and one-shot timing now starts at the configured delay, repeats from that delay, and renders at the correct timeline offset.
- Environment repeating clips now render like repeating timeline segments, non-playing music rows are dimmed, and short clips render as dots instead of misleading bars.
- Hidden-tab refresh churn, typing focus theft, and search caret jumps were reduced by narrowing scene refresh behavior and filtering in place.
- Cue save/load now retains the selected source track, blocks save/trigger without a track, and browse/edit mode behavior is more stable.
- Automation operator persistence, `Any Active Sound Scene` stop targets, and match ordering behave correctly with the newer rule model.

## [13.0.2]

### Added
- A GM-only `Minstrel Audio Workbench` toolbar entry for both the Foundry and Coffee Pub toolbars.
- Multi-track scene music support with scene-level transport controls for previous/next track stepping.
- A master scene timeline row with a live scene clock and shared playhead.
- Dashboard racks for favorite scenes, favorite playlists/tracks, and favorite cues with per-rack search.
- Automation rule tint and icon fields, plus quick duplication from the rule editor.
- New automation rule type: `Scene Name Contains`.

### Changed
- Automation rule `Priority` is now `Importance` with `High`, `Normal`, and `Low` options instead of a free numeric field.
- Automation matching now favors the most specifically matching rule set instead of relying on raw numeric priority.
- Dashboard layout was rebuilt to match the connected pane style used elsewhere in Minstrel.
- Cue cards were aligned more closely with automation-card presentation and wrapping behavior.
- Playlist rows and dashboard playlist items now use the same stateful play/stop pattern instead of separate transport buttons.
- Playlist mode controls now use explicit Foundry playback modes with matching icons:
  - soundboard only
  - sequential playback
  - shuffle tracks
  - simultaneous playback
- Scene editing now auto-saves layer changes while keeping scene details as an intentional edit/save flow.
- Scene defaults now use `0s` fade in / `0s` fade out.
- Top header panels now use shared panel styling, shared slider styling, and centralized panel background image variables.
- Minstrel window sizing now enforces a minimum width of `1300` and minimum height of `750`.

### Fixed
- Active scene load normalization is now GM-only so player clients do not try to mutate playlists on startup.
- Scene playback state now normalizes correctly on load and scene play actions switch the editor to the selected scene.
- Scene music active-state display now follows the actual runtime music track instead of stale editor order or disabled rows.
- Scene layer reordering now persists correctly across save/reopen.
- Scene layer auto-save no longer restarts the active scene on every tweak.
- Scene layer volume changes no longer rewrite the whole scene and interrupt playback.
- Added scene layers now appear immediately while a scene is active.
- Delayed environment and one-shot timing now starts at the configured delay, repeats from that delay, and renders at the correct timeline offset.
- Environment repeating clips now render like repeating timeline segments instead of dim full-width beds.
- Non-playing music tracks are dimmed and only the active music track shows the live progress line.
- Short clips now render as dots instead of misleading oversized bars.
- Scene transport updates were narrowed to reduce focus stealing, hidden-tab churn, and typing lag.
- Search inputs for scenes, playlists, and scene sounds now filter in place without blowing away caret position.
- Cue save/load retains the selected source track and blocks save/trigger when no track is selected.
- Cue browser mode now hides the editor until explicitly opened, and cue save closes the editor.
- Cue category creation no longer creates an empty default cue sheet before save.
- Cue editor, playlist sliders, and shared range controls now use the same unboxed slider treatment.
- Cue and automation hover states were restored where recent style refactors had dropped them.
- Dashboard playlist rack actions, hover behavior, and click-to-play behavior now match the Playlists tab.
- Playlist filtering now hides playlist groups with no matching sounds when search/channel/status filters are active.
- `Any Active Scene` stop actions now save and execute correctly instead of falling back to a specific scene.
- Ordered automation clause operators now persist correctly instead of reverting `OR` back to `AND`.
- Scene source playlist names are now preserved separately from scene-owned playback tracks, though follow-up cleanup is still tracked in `documentation/todo.md`.

## [13.0.1]

### Added
- `documentation/performance.md` with ranked findings, progress tracking, and Blacksmith API usage notes.
- Selector caching and invalidation hooks for playlists, scenes, cues, and dashboard data.
- Blacksmith lifecycle cleanup for hooks, menubar tools, and secondary bar items.
- A public Blacksmith menubar context-menu wrapper so Minstrel no longer depends on private menubar internals.
- Scene read/edit mode, environment start-delay support, and delayed timeline offsets.
- Cue tinting, cue favorites on cards, cue-sheet selection, and shorthand Font Awesome icon handling.
- A first-pass ordered automation rules engine with clause reordering, `AND` / `OR` / `NOT`, Artificer habitat support, time-of-day ranges, and in-game date matching.

### Changed
- Window-state persistence is now throttled, global listeners are scoped to the window lifecycle, and playlist runtime sync is batched.
- Sound-scene saves now diff playlist sounds instead of deleting and recreating them.
- `MinstrelWindow.getData()` is now tab-aware to avoid rebuilding unrelated tab context on every render.
- Playlists, Scenes, Cues, Dashboard, and Automation were all refreshed to use cleaner card-first presentation, stateful play/stop controls, and more consistent icon-driven affordances.
- The secondary Minstrel menubar now uses GM-only access, left-click navigation, right-click favorites, and clearer scene/audio state.
- User-facing naming was restored to `Playlists`.

### Fixed
- Foundry compatibility warnings caused by deprecated globals:
  - `AudioHelper` -> `foundry.audio.AudioHelper`
  - `loadTemplates` -> `foundry.applications.handlebars.loadTemplates`
  - `renderTemplate` -> `foundry.applications.handlebars.renderTemplate`
- Cue save/load, validation, favorite-state, icon-state, and editor-layout regressions.
- Scene read-view image/background regressions and delayed one-shot timing behavior.
- Menubar scene/track labeling and favorite-environment flyout placement.
- Automation habitat selection, action targeting, and split-column scrolling.
- The global `Now Playing` panel now prefers active scene details, falls back cleanly, and clears stale cue state after cues finish naturally.



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
