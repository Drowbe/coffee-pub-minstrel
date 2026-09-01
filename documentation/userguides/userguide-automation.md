# Writing automation rules

**Audience:** the Gamemaster.

How to make Minstrel change the soundtrack on its own -- combat music when a fight starts, the right
ambience when the party reaches a new map. Everything here is Gamemaster only.

![The Automation tab: rules grouped under Combat, Holiday, Scene Moods, Travel and Utility categories, with the rule editor open on the right](../assets/userguide-automation.webp)

## What a rule is

Three things: **when** to look (triggers), **whether this is the right moment** (conditions), and
**what to do** (the action). Rules live in categories you name, and the **Rule Editor** on the right
edits the one you have selected.

Build your scenes first. A rule's action is almost always "play this sound scene", so there is
nothing useful to automate until you have some.

## Write your first rule: combat music

1. Click the plus at the top of the rules list, or **New Rule**.
2. **Rule Name**: "Combat Start".
3. **Category**: pick one, or choose Create New and name it -- "Combat" is a good start.
4. **Action**: Play Sound Scene. **Sound Scene**: your combat scene.
5. Under **Triggers**, choose **Combat** and set its phase to **Start**.
6. Leave Conditions empty. You want this everywhere.
7. Click **Save Rule**.

Start a combat in Foundry and the scene starts.

## Write a rule for one place: map ambience

1. **New Rule**, name it after the location.
2. **Action**: Play Sound Scene, and pick the scene.
3. **Trigger**: **Scene Change**, phase **Start**.
4. Under **Conditions**, add a condition and choose **Specific Scene**, then pick the Foundry scene.
5. Save.

Note that *which* Foundry scene belongs in Conditions, not on the trigger row. The trigger says
"when the map changes"; the condition says "and it is this map".

**Scene Name Contains** does the same job more loosely. One rule matching "Forest" covers Forest -
Day, Deep Forest and Forest Road without a rule for each.

## The other conditions

**Habitat** matches the habitats set on the Foundry scene, so one rule can cover every mountain map
you own without naming any of them.

**Time of Day** matches a range of world time, which is how you get different music for a location by
day and by night: two rules, same scene condition, different time ranges, different sound scenes.

**Date** matches an exact world year, month and day, for anniversaries and festivals.

## Combine several conditions

Conditions sit in groups. **Every group must pass.** Inside a group, each row after the first carries
an **AND**, **OR** or **NOT** control saying how it combines with the rows above it.

There is no operator precedence -- rows combine left to right, in order. "A OR B AND C" means
"(A OR B) AND C". If a rule is not firing the way you expect, read it left to right and you will
usually find the reason.

Add a second group with **Add condition group** when you want a genuine "both of these must hold".

## Decide which rule wins

Several rules can match the same moment. Minstrel picks one, in this order:

1. **Importance** tier: High runs before any Normal, Normal before any Low.
2. **How many condition rows are true right now.** A rule matching scene and time beats one matching
   scene alone.
3. **Specificity** of the condition types, if still tied.
4. **Rule name**, A to Z.

The first rule whose action succeeds wins, and the rest do not run.

The order rules appear in the list has nothing to do with this -- that is grouped by category and name
for browsing. If you want a rule to win, raise its **Importance** or make it more specific; do not try
to reorder the list.

## Stop audio with a rule

Set **Action** to stop instead of play. If you also pick a **Sound Scene**, the rule only stops *that*
scene, so a stop rule scoped to one location cannot silence a different one.

Turn on **Restore previous audio on combat end** for a combat-end rule and the audio from before the
fight comes back, after the delay set in **Combat Restore Delay** in the module settings.

## Delay a rule

**Delay (ms)** waits before acting. A short delay on a scene-change rule lets the map finish loading
before the music arrives, which sounds deliberate rather than abrupt.

## Test a rule without waiting for the trigger

**Run Rule** fires it immediately. Use it while building -- it is much faster than starting a combat
to find out you picked the wrong scene.

## Manage rules you already have

- The power control enables or disables a rule. Disable rather than delete while you are unsure.
- The heart puts it in the menubar quick menu.
- **Duplicate Rule** copies it, which is the fast way to make the night version of a day rule.
- **Delete Rule** removes it.

## When a rule does not fire

Work down this list:

1. Is the rule enabled?
2. Did the trigger actually happen? Scene Change fires when the map changes, not when a token moves.
3. Are the conditions true *at that moment*? A time-of-day condition checks world time, not real time.
4. Is another rule winning? Check for a High importance rule matching the same event.
5. Is the scene already active? A rule that would start the scene already playing succeeds quietly and
   does nothing.
