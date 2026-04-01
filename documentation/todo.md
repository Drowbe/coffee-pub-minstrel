# TODO

## Performance / UI refresh backlog

- **Sound Scenes tab:** When only transport numbers or playhead position change, patch the DOM (or a narrow partial) instead of relying on full `getData` / body re-render where safe.
- **Dashboard tab:** Lazy-invalidate `getDashboardData()` / refresh favorite lists when the Dashboard tab is focused, or debounce invalidation after bulk playlist/world updates.
- **Playlists tab:** Defer or debounce heavy `getPlaylistSummary()` work until the Playlists tab is shown (or after a short idle) so background playback does not rebuild large lists unnecessarily.
- **Redundant surfaces:** Audit mirroring the same playback state in the toolbar, Blacksmith menubar/secondary bar, and tab bodies; consolidate refresh targets so one canonical path updates “current track” display.
- **Optional:** Throttle or gate `refreshSecondaryBarState` similarly to menubar if profiling shows it hot.

- Add time-of-day modes to scenes so a single scene can support variants such as dawn, day, dusk, and night.
- Add a preview mode for scenes so changes can be heard in real time while editing, such as live volume adjustments.
- Fix scene-layer source playlist labeling so rows show the original source playlist, not the Minstrel scene playlist, which is currently useless for finding similar sounds.
- Pull HTML out of JavaScript so JS is responsible for data and templates are responsible for markup.
- Leverage Handlebars partials so the template structure stays modular instead of turning into a Frankenstein template.
- Simplify CSS so we stop creating one-off classes for every individual element.
- Split CSS by feature/location so styles live near the UI they belong to instead of growing one mega-CSS file.
- Group and label CSS sections clearly so it is obvious what each block of styles is for.
- Untangle the cue/automation/card-class overlap so we stop multiclassing unrelated components just to approximate the same UI.
- Expand automations beyond scenes so rules can trigger other Minstrel actions and systems.
- Add automation support for triggering a cue from a matching string in chat or a specific dice roll.
