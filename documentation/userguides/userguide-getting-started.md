# Getting Started with Minstrel

**Audience:** the Gamemaster, in the first five minutes after enabling Minstrel.

What Minstrel does, what it needs installed, and what appears on screen once it is on.

## What Minstrel is for

Minstrel is an audio console for running a session. Instead of hunting through the Playlists sidebar
mid-scene, you get one window with your music, your ambience, and your sound effects laid out the way
you actually use them -- plus rules that can change the soundtrack for you when combat starts or the
party moves to a new map.

Your audio still lives in ordinary Foundry playlists. Minstrel plays and stops those sounds; it does
not import, copy or convert your files, and everything you build stays visible in the Playlists
sidebar.

## What you need

- Foundry VTT version 13.
- Coffee Pub Blacksmith, installed and enabled. Minstrel will not run without it.
- At least one playlist with some sounds in it.

## Minstrel is Gamemaster only

Only the Gamemaster can open or use Minstrel. Players see nothing -- no window, no toolbar button, no
menu. If a player tries, they are told "Only the Gamemaster can use Coffee Pub Minstrel."

The audio itself still reaches everyone, because Minstrel plays normal Foundry playlist sounds.

## What appears when you enable it

Two things, both Gamemaster only:

- A music note button in the Foundry toolbar, which opens the Minstrel window.
- A Minstrel bar in the Blacksmith menubar, showing the active sound scene and what is playing, with
  buttons to stop music, environment, one-shots, or everything.

## The five tabs

They sit across the top of the window in this order. Each has its own guide.

**[Dashboard](userguide-dashboard.md)** is where you run a session: what is playing, your favourite
scenes, playlists and cues, and the transport for all of it.

**[Sound Scenes](userguide-soundscenes.md)** is where you build reusable audio programs -- music,
ambience and timed effects together, started with one click. This is the tab that does the most for
you.

**[Cues](userguide-cues.md)** are single sounds you fire by hand at the moment you want them.

**[Playlists](userguide-playlists.md)** is your whole audio library: find a sound, audition it, play
it, mark it as a favourite.

**[Automation](userguide-automation.md)** is where you write rules that change the soundtrack for
you when combat starts or the party reaches a new map.

![The Dashboard tab: Now Playing, Music, Environment and Interface readouts above the Sound Scene, Playlist and Cue racks](../assets/product-overview.webp)

## Your first five minutes

1. Open Minstrel from the toolbar.
2. Go to **Playlists** and find a track you like. Play it, to confirm sound is working.
3. Mark two or three tracks as favourites. They appear on the **Dashboard**.
4. Go to **Sound Scenes** and create one. Add a music layer and an environment layer, then start it.
   Both play together, and the menubar shows the scene as active.
5. Stop it from the menubar, or from the bar at the bottom of the window.

That is enough to run a session. Read the [Dashboard guide](userguide-dashboard.md) next, since that
is the tab you will keep open, then the [sound scenes guide](userguide-soundscenes.md) when you want
to build properly. Automation can wait until you have a few scenes worth switching between.

## The three kinds of sound

Minstrel sorts everything by which Foundry channel a sound uses, and this is worth knowing because
the stop buttons work per channel:

| Foundry channel | In Minstrel | Used for |
|---|---|---|
| Music | Music | The main track, played one at a time |
| Environment | Environment | Background beds that loop under everything |
| Interface | Interface | Short effects that fire and finish: cues and scene one-shots |

If a sound is on the wrong channel in Foundry, Minstrel will treat it as the wrong kind. That is the
first thing to check if a track will not stop when you expect it to.

## Stop means stop

The stop buttons are not pause. **Stop Music** also cancels the scene's music sequence, so the next
track will not start on its own. **Stop Environment** cancels any layer that was waiting to fade in
later. **Stop One-Shots** cancels the timers for repeating effects and silences cues. **Stop All**
tears the whole scene down.

Once stopped, none of those timers come back until you activate the scene again.

## Settings

Three settings, in Configure Settings under Coffee Pub Minstrel:

- **Default Fade Seconds** -- the fade length Minstrel uses when it starts or stops a track and the
  scene does not specify its own.
- **Recent Track Limit** -- how many recently played tracks are remembered for the world.
- **Combat Restore Delay** -- how long Minstrel waits, in milliseconds, before restoring the previous
  audio once combat automation ends. Raise it if the music returns before the after-combat chatter
  has settled.

## If something is not working

Check that Coffee Pub Blacksmith is enabled first -- almost everything routes through it.

If audio does not start until you click something, that is Foundry, not Minstrel: browsers refuse to
play sound until you interact with the page. A scene that automation started will begin the moment
you click anything.

Defects we know about are in [known issues](known-issues.md).
