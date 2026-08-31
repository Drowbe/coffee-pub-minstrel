# Automation — Architecture

**Audience:** Contributors to the Minstrel codebase.

Automation rules start and stop sound scenes in response to game events: combat beginning, a round
turning over, the canvas changing scene, world time passing. A rule is triggers + conditions + an action.

**Files:**

| File | Role |
|---|---|
| `scripts/manager-automation.js` | Rule model, evaluation, ranking, actions, hook registration |
| `scripts/manager-storage.js` | Rule sanitizer and the `automationRules` setting |
| `scripts/window-minstrel.js` | The Automation tab's clause editor |

## Rules live in settings, not playlists

Unlike scenes and cues, rules have no natural document home, so they live in the `automationRules` world
setting and are sanitized on every read by `StorageManager.sanitizeAutomationRule`. `getRules()` caches
the sanitized list; every write invalidates it.

A rule is roughly:

```js
{
  id, name, category, enabled, importance,   // 'high' | 'normal' | 'low'
  triggers: [ { type, phase } ],
  conditionGroups: [ { clauses: [ { type, join, ...clauseFields } ] } ],
  action: 'start' | 'stop',
  soundSceneId, delayMs, restorePreviousOnExit
}
```

## Five Foundry hooks drive everything

All are registered through `BlacksmithHookManager` with `context: 'coffee-pub-minstrel'` and priority 3,
and all are **post-hooks** — none of them cancel anything:

| Hook | Emits |
|---|---|
| `combatStart` | `combat/start`, plus `round/start` if the combat begins past round 0 |
| `updateCombat` | `round/end` then `round/start` on a round change |
| `deleteCombat` | `combat/end` |
| `canvasTearDown` | `scene/end` |
| `canvasReady` | `scene/start` |

> Blacksmith's HookManager makes cancellation **opt-in** via a top-level `canCancel: true`. None of
> Minstrel's callbacks return a value, so none of them can cancel. If you ever add a `pre*` hook here,
> remember that a callback returning a bare boolean would be inert without `canCancel` — and dangerous
> with it.

World time is handled separately: `updateWorldTime` compares a snapshot and emits `worldDate/tick` on a
date change and `worldTime/tick` on a minute change, so a rule can key on either without re-deriving.

## Evaluation: three different combinators

The order of operations for a **single rule** is fixed and each level uses a different combinator, which
is the thing most likely to surprise you:

- **Triggers combine with OR.** Any listed trigger may fire the rule.
- **Condition groups combine with AND.** Every group must pass.
- **Clauses inside a group combine left-to-right using each clause's own `join`** (`and` / `or` / `not`).
  There is no precedence — it is a running fold, so `A or B and C` evaluates as `(A or B) and C`.

`group.innerJoin` is legacy. The sanitizer strips it; it survives only as a fallback for a malformed row
that has no per-clause `join`.

An empty clause list passes. An unset clause field passes. This is deliberate — a half-built rule in the
editor should not match nothing in a confusing way — but it means **a rule with no conditions matches
every event of its trigger type.**

### Condition clause types

| Type | Matches on |
|---|---|
| `scene` | A specific Foundry scene id |
| `sceneNameContains` | Substring of the active scene's name |
| `habitat` | A habitat key on the active scene, via Blacksmith's geography API |
| `timeOfDay` | World-time minute range (`timeStartMinutes` … `timeEndMinutes`) |
| `date` | An exact world year / month / day |

Habitat reads `api.geography.getHabitats(scene)`. Blacksmith owns the vocabulary and the storage, and ran
the one-time migration off Artificer's old scene flag. Minstrel is a consumer — it writes no habitat data
and does not gate on any harvesting module being installed. Keys come back lowercase, deduped, in
vocabulary order.

## Ranking: when several rules match the same event

Every enabled matching rule is a candidate; they are sorted and then executed in order until one returns
true. A no-op success still stops the chain.

1. **Importance tier** — `high`, then `normal`, then `low`. A high rule is always considered before any
   normal or low rule, regardless of how specific the others are.
2. **Matching condition count** in this context — scene + time beats scene alone.
3. **Static specificity score** — clause-type weights.
4. **Rule name**, A→Z, case-insensitive, as a stable tiebreak.

Sidebar and playlist ordering play no part in this. `getAutomationPlaylists` sorts by name for discovery
only.

## Actions

`executeAutomationActions` applies the rule's `delayMs` first, then branches:

- **`action: 'stop'`** — stops the active scene, optionally restoring the previous snapshot. If the rule
  names a `soundSceneId`, it only acts when *that* scene is the active one, so a stop rule scoped to one
  scene cannot stop a different one.
- **Combat end with `restorePreviousOnExit`** — waits `combatRestoreDelayMs`, then stops and restores.
  This branch is checked before the generic start, so a combat-end rule does not accidentally start a
  scene.
- **`soundSceneId` set** — activates that scene, unless it is already active, in which case the rule
  returns success without re-activating. `savePrevious` is true only on combat start, so entering combat
  can be undone but an ordinary scene change does not accumulate snapshots.

A rule with no `soundSceneId` and no stop action returns false and the chain continues to the next
candidate.

## The scene-start catch-up

`_runSceneStartAutomationOncePerCanvas` runs once per canvas load, GM-only, guarded by
`_sceneStartHandledForCurrentCanvas`. It stops lingering scene-change cues and then fires the
`scene/start` event, so loading straight into a world with a habitat- or scene-conditioned rule starts the
right audio without waiting for a scene *change*.

**It is called fire-and-forget from `initialize()`, and that is load-bearing.** Activating a scene awaits
`game.audio.unlock`, which resolves only on the first user gesture. Awaiting the catch-up would park the
whole module init — menubar registration included — until the user clicked. See
[architecture-minstrel](architecture-minstrel.md).
