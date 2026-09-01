# Building and firing cues

**Audience:** the Gamemaster.

How to set up cues and fire them at the right moment. Everything here is Gamemaster only.

![The Cues tab: cue sheets grouped under Cartoon, Movement and Stingers headings, each cue a coloured card with an icon](../assets/userguide-cues.webp)

## What a cue is

A single sound you fire by hand, at the moment you want it: a horn, a scream, a sad trombone. Unlike
a scene layer, nothing schedules a cue -- you click it.

Cues are grouped into **cue sheets**, which are just headings you name. Each cue is a card with an
icon and a colour, because during play you will find a red trumpet faster than you will read a list.

## Make a cue

1. Click the plus at the top of the tab, or **New Cue**.
2. Give it a **Cue Name**.
3. Pick the **Track** it plays.
4. Choose a **Cue Sheet**, or type a name under **New Cue Sheet** to start a new group.
5. Set an **Icon** and a **Tint**. Both are for finding it at speed; spend the ten seconds.
6. Set **Volume**.
7. Click **Save Cue**.

## Fire a cue

Click its card. It plays once and finishes. You can fire it again immediately unless you have given
it a cooldown.

Cues are also available from the Dashboard's Cue Rack and the menubar quick menu if you heart them,
which is where you want the four or five you will actually use tonight.

## Duck the music under a cue

Turn on **Duck music and ambience** and the music and environment channels drop to make room when
the cue fires, then come back up.

The volumes return after **two and a half seconds**, and that is fixed -- it is not measured from the
cue's length. A cue longer than that will have the music rising underneath it while it is still
playing. For anything longer than a couple of seconds, leave ducking off and drop the music yourself
with the channel slider.

## Stop a cue firing twice

**Cooldown**, in seconds, blocks the cue from firing again until it expires. Set it on anything you
might double-click in the moment -- a horn blast played twice a tenth of a second apart sounds like a
mistake, because it is one.

A cooldown of zero means no cooldown.

## Clear a cue when the scene changes

Turn on **Stop on scene change** for a cue that should not bleed across a transition -- a long alarm
bell, a rumble. When you start a different sound scene, that cue is silenced.

Leave it off for short effects. They will have finished on their own.

## Organise cues you already have

- **Edit Cue** opens an existing cue for changes; **Save Cue** commits them.
- The heart marks it a favourite, putting it in the Dashboard's Cue Rack and the menubar quick menu.
- The power control enables or disables it without deleting it.
- **Delete Cue** removes it.

Rename a cue sheet by editing the cue sheet name on any cue in it.

## Cues and scene one-shots are not the same thing

Both play short sounds on the Interface channel, and **Stop One-Shots** stops both. The difference is
what starts them: you fire a cue, while a scene's scheduled one-shot fires itself on a timer.

If you want a sound every ninety seconds, that is a scene layer, not a cue. If you want it when the
door opens, that is a cue.

## Where cues live

Each cue sheet is an ordinary Foundry playlist named with a `[CUE]` prefix, in a Cue Boards folder,
with one sound per cue. You will see them in the Foundry sidebar and can ignore them there.
