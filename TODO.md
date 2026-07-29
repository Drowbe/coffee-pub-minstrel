# TODO

- Performance (see `documentation/todo.md` § Performance / UI refresh backlog)
- Playback-depth refreshes on the Dashboard/Playlists tabs still escalate to a full body render when playback state *has* changed (`_flushUiRefresh`). **Step 1 done:** a playback fingerprint now skips that render when nothing those tabs show has changed, which covers all scene-driven events (scene layers play sounds inside the hidden scene playlist). **Step 2, remaining:** give those tabs a `refreshPlaybackRows()` targeted updater so even a real change patches rows instead of rebuilding the list — per row only `minstrel-track-row-playing`, the `statusLabel` text, and the play/stop button's `data-action`/`title`/icon change, plus the group header's `-playing` class, `· Playing` suffix and button. Rows are addressable via `data-value="playlistId::soundId"`; add `data-track-value` to the row element itself. Then delete the `bodyEncodesPlayback` branch entirely.
- `templates/partials/window-minstrel-body.hbs` line ~177 tests `{{#if this.isPlaying}}`, but `getPlaylistSummary` emits `playing` — the track volume icon never gets `is-playing`. Fix alongside step 2 above (same row state).
- Make recents more discoverable: today it only surfaces as the clock icon filter on the Playlists tab. Consider a "Recent Tracks" rack on the Dashboard (data already flows through the dashboard cache), or a labeled filter button — or drop the feature and its per-play settings write entirely.
- consider allowing multiple music selections with sequence options
- fix the environment and sound loops so the delay also happens before the first sound plays, so they do not all initially play at once
- fade in/out options for environment in scenes
