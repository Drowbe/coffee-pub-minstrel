# TODO

- Performance (see `documentation/todo.md` § Performance / UI refresh backlog)
- Playback-depth refreshes on the Dashboard/Playlists tabs still escalate to a full body render (`_flushUiRefresh` → `needsFullBodyForPlayback`). During an active scene this re-renders the ~1000-line template on every playback event — steady GC pressure over a long session. Follow the targeted-DOM pattern of `refreshPlaybackChrome`: update only now-playing/track-state regions on those tabs.
- Make recents more discoverable: today it only surfaces as the clock icon filter on the Playlists tab. Consider a "Recent Tracks" rack on the Dashboard (data already flows through the dashboard cache), or a labeled filter button — or drop the feature and its per-play settings write entirely.
- consider allowing multiple music selections with sequence options
- fix the environment and sound loops so the delay also happens before the first sound plays, so they do not all initially play at once
- fade in/out options for environment in scenes
