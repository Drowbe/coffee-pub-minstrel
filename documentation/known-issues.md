# Known Issues

**Audience:** anyone running Minstrel who hits something that looks broken.

Defects that are real and unfixed. What is fixed is in the CHANGELOG; what we intend to build is not
here.

## A cue longer than 2.5 seconds un-ducks under itself

A cue set to duck other audio restores the music and environment volumes on a fixed 2.5-second timer,
not when the cue finishes. A cue longer than that will have the music come back up while it is still
playing.

Workaround: none within the module; use a shorter cue, or turn off ducking for that cue.

## Shutting down mid-duck leaves the mix quiet

If Minstrel is disabled, or the world is closed, in the 2.5 seconds after a ducking cue fires, the
restore timer is cancelled with everything else and the music and environment tracks keep the reduced
volume. These are real playlist volumes rather than an overlay, so they persist.

Workaround: raise the affected tracks' volumes in the Playlists sidebar, or stop and restart the
scene.

## Scene layer rows name the scene playlist, not the source

A sound scene stores a copy of each track inside its own playlist, so a layer row identifies the scene
rather than the library playlist the track came from. This makes it hard to find similar sounds from
the scene editor.

Workaround: search the Playlists tab by track name.
