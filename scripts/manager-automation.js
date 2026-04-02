// ==================================================================
// ===== MINSTREL AUTOMATION MANAGER ================================
// ==================================================================

import { MODULE } from './const.js';
import { RuntimeManager } from './manager-runtime.js';
import { SoundSceneManager } from './manager-soundscenes.js';
import { CueManager } from './manager-cues.js';
import { StorageManager } from './manager-storage.js';

const PLAYLIST_TYPE_AUTOMATION = 'automation';
const automationCache = {
    rules: null
};
const AUTOMATION_PLAYLIST_PREFIX = '[AUTOMATION]';

const AUTOMATION_TRIGGER_TYPES = [
    { type: 'combat', label: 'Combat' },
    { type: 'round', label: 'Round' },
    { type: 'scene', label: 'Scene' },
    { type: 'worldTime', label: 'World Time (minute changes)' },
    { type: 'worldDate', label: 'World Date (day changes)' },
    { type: 'manual', label: 'Manual (editor Run)' }
];

const AUTOMATION_CONDITION_TYPES = [
    { type: 'scene', label: 'Scene' },
    { type: 'sceneNameContains', label: 'Scene Name Contains' },
    { type: 'habitat', label: 'Habitat' },
    { type: 'timeOfDay', label: 'Time of Day' },
    { type: 'date', label: 'Date' }
];

/** @type {((...args: unknown[]) => Promise<void>) | null} */
let updateWorldTimeHookCallback = null;

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function getTriggerTypeDefinition(type) {
    return AUTOMATION_TRIGGER_TYPES.find((entry) => entry.type === type) ?? AUTOMATION_TRIGGER_TYPES[2];
}

function getConditionTypeDefinition(type) {
    return AUTOMATION_CONDITION_TYPES.find((entry) => entry.type === type) ?? AUTOMATION_CONDITION_TYPES[2];
}

function getAutomationPlaylists() {
    return (game.playlists?.contents ?? [])
        .filter((playlist) => playlist?.getFlag?.(MODULE.ID, 'type') === PLAYLIST_TYPE_AUTOMATION)
        .sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? ''), undefined, { sensitivity: 'base' }));
}

function getAutomationMeta(playlist) {
    return foundry.utils.deepClone(playlist?.getFlag?.(MODULE.ID, 'automationMeta') ?? {});
}

function formatAutomationPlaylistName(ruleName) {
    const baseName = String(ruleName ?? 'New Rule').trim() || 'New Rule';
    return `${AUTOMATION_PLAYLIST_PREFIX} ${baseName}`;
}

function buildRuleFromPlaylist(playlist) {
    if (!playlist) return null;
    const automationMeta = getAutomationMeta(playlist);
    return StorageManager.sanitizeAutomationRule({
        id: String(playlist.id),
        name: String(automationMeta.name ?? playlist.name ?? 'New Rule')
            .replace(/^\[AUTOMATION\]\s*/i, '')
            .trim() || 'New Rule',
        ...automationMeta
    });
}

function getActiveScene() {
    return canvas?.scene ?? game.scenes?.get?.(game.user?.viewedScene) ?? null;
}

function getSceneArtificerHabitats(scene) {
    if (!scene || !AutomationManager.isArtificerAvailable()) return [];
    const data = scene.getFlag('coffee-pub-artificer', 'scene') ?? {};
    const habitats = Array.isArray(data.habitats)
        ? data.habitats
        : typeof data.habitats === 'string'
            ? data.habitats.split(',')
            : [];

    return habitats
        .map((entry) => String(entry ?? '').trim().toLowerCase())
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b));
}

function getWorldDateParts() {
    const calendar = game.time?.calendar;
    if (calendar?.timeToComponents) {
        const components = calendar.timeToComponents(game.time.worldTime);
        const monthData = calendar.months?.values?.[components.month];
        return {
            isoDate: '',
            hour: Math.max(0, Math.min(23, Number(components.hour ?? 0))),
            minutes: Math.max(0, Math.min(1439, (Number(components.hour ?? 0) * 60) + Number(components.minute ?? 0))),
            year: Number(components.year ?? 0) + Number(calendar.years?.yearZero ?? 0),
            month: Number(monthData?.ordinal ?? (Number(components.month ?? 0) + 1)),
            day: Number(components.dayOfMonth ?? 0) + 1
        };
    }

    const worldDate = new Date((Number(game.time?.worldTime ?? 0) || 0) * 1000);
    return {
        isoDate: worldDate.toISOString().slice(0, 10),
        hour: worldDate.getUTCHours(),
        minutes: (worldDate.getUTCHours() * 60) + worldDate.getUTCMinutes(),
        year: worldDate.getUTCFullYear(),
        month: worldDate.getUTCMonth() + 1,
        day: worldDate.getUTCDate()
    };
}

/** Last minute-of-day in world time (0 = midnight, 1439 = 11:59 PM). */
const TIME_OF_DAY_LAST_MINUTE = 1439;
/** End-handle sentinel: 1440 = through end of day (same as up-to-and-including 11:59 PM). */
const TIME_OF_DAY_END_SENTINEL = 1440;

function minutesInRange(value, start, end) {
    const v = Math.max(0, Math.min(TIME_OF_DAY_LAST_MINUTE, Number(value) || 0));
    const s = Math.max(0, Math.min(TIME_OF_DAY_LAST_MINUTE, Number(start) || 0));
    const eRaw = Math.max(0, Math.min(TIME_OF_DAY_END_SENTINEL, Number(end) || 0));
    const eInclusive = eRaw >= TIME_OF_DAY_END_SENTINEL ? TIME_OF_DAY_LAST_MINUTE : Math.min(TIME_OF_DAY_LAST_MINUTE, eRaw);

    if (s <= eRaw) {
        return v >= s && v <= eInclusive;
    }
    return v >= s || v <= eInclusive;
}

function escapeRegExp(value) {
    return String(value ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchesSceneNameContains(sceneName, expected) {
    const needle = String(expected ?? '').trim().toLowerCase();
    if (!needle) return true;
    const haystack = String(sceneName ?? '').trim().toLowerCase();
    if (!haystack) return false;
    const phrasePattern = needle
        .split(/\s+/)
        .filter(Boolean)
        .map((part) => escapeRegExp(part))
        .join('\\s+');
    if (!phrasePattern) return true;
    const regex = new RegExp(`\\b${phrasePattern}\\b`, 'i');
    return regex.test(haystack);
}

function evaluateTriggerClause(clause, context) {
    if (!clause?.type) return false;
    switch (clause.type) {
        case 'combat':
        case 'round':
        case 'scene':
            if (!(context.eventType === clause.type && context.phase === (clause.phase ?? 'start'))) return false;
            if (!clause.sceneId) return true;
            return String(context.scene?.id ?? '') === String(clause.sceneId);
        case 'worldTime':
            return context.eventType === 'worldTime';
        case 'worldDate':
            return context.eventType === 'worldDate';
        case 'manual':
            return context.eventType === 'manual';
        default:
            return false;
    }
}

function triggersMatchOR(triggers, context) {
    const list = Array.isArray(triggers) ? triggers : [];
    if (!list.length) return false;
    return list.some((t) => evaluateTriggerClause(t, context));
}

function evaluateConditionClause(clause, context) {
    if (!clause?.type) return true;
    switch (clause.type) {
        case 'scene': {
            if (!clause.sceneId) return true;
            return String(context.scene?.id ?? '') === String(clause.sceneId);
        }
        case 'habitat': {
            const expected = String(clause.habitat ?? '').trim().toLowerCase();
            if (!expected) return true;
            return context.habitats.includes(expected);
        }
        case 'sceneNameContains':
            return matchesSceneNameContains(context.scene?.name, clause.sceneNameContains);
        case 'timeOfDay':
            return minutesInRange(context.minutes, clause.timeStartMinutes, clause.timeEndMinutes);
        case 'date':
            if (!clause.dateYear) return true;
            return Number(context.year) === Number(clause.dateYear)
                && Number(context.month) === Number(clause.dateMonth)
                && Number(context.day) === Number(clause.dateDay);
        default:
            return true;
    }
}

function evaluateConditionGroup(group, context) {
    const clauses = Array.isArray(group?.clauses) ? group.clauses : [];
    if (!clauses.length) return true;
    const defaultJoin = group.innerJoin === 'or' ? 'or' : 'and';

    let result = evaluateConditionClause(clauses[0], context);
    for (let index = 1; index < clauses.length; index += 1) {
        const clause = clauses[index];
        const clauseValue = evaluateConditionClause(clause, context);
        const join = clause.join ?? defaultJoin;

        if (join === 'or') {
            result = result || clauseValue;
            continue;
        }
        if (join === 'not') {
            result = result && !clauseValue;
            continue;
        }
        result = result && clauseValue;
    }
    return result;
}

function evaluateConditionGroups(groups, context) {
    const list = Array.isArray(groups) ? groups : [];
    if (!list.length) return true;
    for (const group of list) {
        if (!evaluateConditionGroup(group, context)) return false;
    }
    return true;
}

function ruleMatches(automation, context) {
    if (!automation?.enabled) return false;
    const triggers = automation.triggers ?? [];
    const groups = automation.conditionGroups ?? [];
    const hasConditions = groups.some((g) => (g.clauses ?? []).length > 0);
    if (!triggers.length && !hasConditions) {
        return context.eventType === 'manual' && (automation.action === 'stop' || !!automation.soundSceneId);
    }
    return triggersMatchOR(triggers, context) && evaluateConditionGroups(groups, context);
}

function getMatchingConditionCount(rule, context) {
    const groups = Array.isArray(rule?.conditionGroups) ? rule.conditionGroups : [];
    return groups.reduce((count, group) => {
        const clauses = group.clauses ?? [];
        return count + clauses.reduce((inner, clause) => inner + (evaluateConditionClause(clause, context) ? 1 : 0), 0);
    }, 0);
}

function getTriggerSpecificityScore(rule) {
    return (Array.isArray(rule?.triggers) ? rule.triggers : []).reduce((score, clause) => {
        switch (clause?.type) {
            case 'scene':
                return score + (clause?.sceneId ? 40 : 20);
            case 'combat':
            case 'round':
                return score + 12;
            case 'worldTime':
            case 'worldDate':
                return score + 8;
            case 'manual':
                return score + 2;
            default:
                return score + 1;
        }
    }, 0);
}

function getConditionSpecificityScore(rule) {
    return (Array.isArray(rule?.conditionGroups) ? rule.conditionGroups : []).reduce((score, group) => {
        const clauses = group.clauses ?? [];
        return score + clauses.reduce((inner, clause) => {
            switch (clause?.type) {
                case 'scene':
                    return inner + (clause?.sceneId ? 40 : 20);
                case 'sceneNameContains':
                    return inner + 35;
                case 'habitat':
                    return inner + 25;
                case 'timeOfDay':
                case 'date':
                    return inner + 15;
                default:
                    return inner + 1;
            }
        }, 0);
    }, 0);
}

function getRuleSpecificityScore(rule) {
    return getTriggerSpecificityScore(rule) + getConditionSpecificityScore(rule);
}

function getImportanceWeight(rule) {
    switch (String(rule?.importance ?? 'normal').trim().toLowerCase()) {
        case 'high':
            return 1;
        case 'low':
            return -1;
        default:
            return 0;
    }
}

function totalConditionClauseCount(rule) {
    return (Array.isArray(rule?.conditionGroups) ? rule.conditionGroups : []).reduce(
        (n, g) => n + (g.clauses ?? []).length,
        0
    );
}

async function executeAutomationActions(automation, context) {
    if (!automation?.enabled) return false;
    if ((automation.delayMs ?? 0) > 0) await delay(automation.delayMs);

    if ((automation.action ?? 'start') === 'stop') {
        const activeSoundSceneId = RuntimeManager.getState().activeSoundSceneId;
        if (automation.soundSceneId && String(activeSoundSceneId ?? '') !== String(automation.soundSceneId)) return false;
        await SoundSceneManager.stopActiveSoundScene({ restorePrevious: !!automation.restorePreviousOnExit });
        return true;
    }

    if (context.eventType === 'combat' && context.phase === 'end' && automation.restorePreviousOnExit) {
        await delay(StorageManager.getCombatRestoreDelayMs());
        await SoundSceneManager.stopActiveSoundScene({ restorePrevious: true });
        return true;
    }

    if (automation.soundSceneId) {
        if (String(RuntimeManager.getState().activeSoundSceneId ?? '') === String(automation.soundSceneId)) {
            return true;
        }
        return SoundSceneManager.activateSoundScene(automation.soundSceneId, {
            savePrevious: context.eventType === 'combat' && context.phase === 'start'
        });
    }

    return false;
}

export const AutomationManager = {
    _hookIds: [],
    _lastRoundByCombatId: new Map(),
    _lastWorldTimeSnapshot: null,

    getTriggerTypes() {
        return AUTOMATION_TRIGGER_TYPES.map((entry) => ({ ...entry }));
    },

    getConditionTypes() {
        return AUTOMATION_CONDITION_TYPES.map((entry) => ({ ...entry }));
    },

    /** @deprecated Use getTriggerTypes / getConditionTypes */
    getRuleTypes() {
        return [...this.getTriggerTypes(), ...this.getConditionTypes()];
    },

    formatTriggerTypeLabel(type) {
        return getTriggerTypeDefinition(type).label;
    },

    formatConditionTypeLabel(type) {
        return getConditionTypeDefinition(type).label;
    },

    createTriggerClause(type = 'scene') {
        const definition = getTriggerTypeDefinition(type);
        return {
            id: foundry.utils.randomID(),
            type: definition.type,
            join: 'or',
            phase: 'start',
            sceneId: ''
        };
    },

    createConditionClause(type = 'habitat', join = 'and') {
        const definition = getConditionTypeDefinition(type);
        return {
            id: foundry.utils.randomID(),
            type: definition.type,
            join,
            phase: 'start',
            sceneId: '',
            sceneNameContains: '',
            habitat: '',
            timeStartMinutes: 480,
            timeEndMinutes: 1020,
            dateYear: '',
            dateMonth: 1,
            dateDay: 1
        };
    },

    /** @deprecated Use createTriggerClause / createConditionClause */
    createRuleClause(type = 'combat', join = 'and') {
        if (['combat', 'round', 'scene', 'worldTime', 'worldDate', 'manual'].includes(type)) {
            return this.createTriggerClause(type);
        }
        return this.createConditionClause(type, join);
    },

    invalidateCache() {
        automationCache.rules = null;
    },

    getRules() {
        if (!automationCache.rules) {
            automationCache.rules = getAutomationPlaylists()
                .map((playlist) => buildRuleFromPlaylist(playlist))
                .filter(Boolean);
        }
        return automationCache.rules;
    },

    getRule(ruleId) {
        return this.getRules().find((rule) => rule.id === ruleId) ?? null;
    },

    ruleHasManualTrigger(rule) {
        return (Array.isArray(rule?.triggers) ? rule.triggers : []).some((t) => t.type === 'manual');
    },

    async saveRule(rule) {
        const sanitizedRule = StorageManager.sanitizeAutomationRule(rule);
        if (!sanitizedRule) return null;

        const automationsFolder = await StorageManager.ensureMinstrelPlaylistFolder('Automations');
        let playlist = sanitizedRule?.id ? game.playlists?.get(sanitizedRule.id) ?? null : null;

        const automationMeta = {
            name: sanitizedRule.name,
            category: sanitizedRule.category,
            categoryMode: sanitizedRule.categoryMode,
            icon: sanitizedRule.icon,
            tintColor: sanitizedRule.tintColor,
            automationSchemaVersion: sanitizedRule.automationSchemaVersion,
            triggers: foundry.utils.deepClone(sanitizedRule.triggers ?? []),
            conditionGroups: foundry.utils.deepClone(sanitizedRule.conditionGroups ?? []),
            rules: [],
            action: sanitizedRule.action,
            soundSceneId: sanitizedRule.soundSceneId,
            importance: sanitizedRule.importance,
            delayMs: sanitizedRule.delayMs,
            restorePreviousOnExit: !!sanitizedRule.restorePreviousOnExit,
            enabled: sanitizedRule.enabled !== false
        };

        if (!playlist || playlist.getFlag?.(MODULE.ID, 'type') !== PLAYLIST_TYPE_AUTOMATION) {
            playlist = await Playlist.create({
                name: formatAutomationPlaylistName(sanitizedRule.name),
                mode: CONST.PLAYLIST_MODES?.DISABLED ?? 0,
                folder: automationsFolder?.id ?? null,
                sorting: 'm',
                flags: {
                    [MODULE.ID]: {
                        type: PLAYLIST_TYPE_AUTOMATION,
                        automationMeta
                    }
                }
            });
        } else {
            await playlist.update({
                name: formatAutomationPlaylistName(sanitizedRule.name),
                folder: automationsFolder?.id ?? null,
                flags: {
                    [MODULE.ID]: {
                        type: PLAYLIST_TYPE_AUTOMATION,
                        automationMeta
                    }
                }
            });
        }

        this.invalidateCache();
        return buildRuleFromPlaylist(playlist);
    },

    async deleteRule(ruleId) {
        const playlist = game.playlists?.get(ruleId) ?? null;
        if (!playlist || playlist.getFlag?.(MODULE.ID, 'type') !== PLAYLIST_TYPE_AUTOMATION) return;
        await playlist.delete();
        this.invalidateCache();
    },

    async migrateLegacySettingsToPlaylists() {
        const existingAutomationPlaylists = getAutomationPlaylists();
        if (existingAutomationPlaylists.length) return false;

        const legacyRules = StorageManager.getAutomationRules();
        if (!legacyRules.length) return false;

        for (const rule of legacyRules) {
            await this.saveRule({
                ...rule,
                id: null
            });
        }

        await StorageManager.clearAutomationRulesSetting();
        this.invalidateCache();
        return true;
    },

    async triggerEvent(eventType, phase = 'start') {
        const scene = getActiveScene();
        const dateParts = getWorldDateParts();
        const context = {
            eventType,
            phase,
            scene,
            habitats: getSceneArtificerHabitats(scene),
            isoDate: dateParts.isoDate,
            hour: dateParts.hour,
            minutes: dateParts.minutes,
            year: dateParts.year,
            month: dateParts.month,
            day: dateParts.day
        };

        const candidates = this.getRules()
            .filter((rule) => rule.enabled)
            .filter((rule) => ruleMatches(rule, context))
            .sort((a, b) => {
                const matchCountDelta = getMatchingConditionCount(b, context) - getMatchingConditionCount(a, context);
                if (matchCountDelta !== 0) return matchCountDelta;

                const specificityDelta = getRuleSpecificityScore(b) - getRuleSpecificityScore(a);
                if (specificityDelta !== 0) return specificityDelta;

                const importanceDelta = getImportanceWeight(b) - getImportanceWeight(a);
                if (importanceDelta !== 0) return importanceDelta;

                const clauseCountDelta = totalConditionClauseCount(b) - totalConditionClauseCount(a);
                if (clauseCountDelta !== 0) return clauseCountDelta;

                return String(a.name ?? '').localeCompare(String(b.name ?? ''), undefined, { sensitivity: 'base' });
            });

        for (const automation of candidates) {
            if (await executeAutomationActions(automation, context)) return true;
        }
        return false;
    },

    async triggerRule(ruleId) {
        const automation = this.getRule(ruleId);
        if (!automation) return false;
        if (!this.ruleHasManualTrigger(automation)) {
            ui.notifications?.warn?.('Add a “Manual (editor Run)” trigger to test this rule from the editor.');
            return false;
        }
        const scene = getActiveScene();
        const dateParts = getWorldDateParts();
        const context = {
            eventType: 'manual',
            phase: 'start',
            scene,
            habitats: getSceneArtificerHabitats(scene),
            isoDate: dateParts.isoDate,
            hour: dateParts.hour,
            minutes: dateParts.minutes,
            year: dateParts.year,
            month: dateParts.month,
            day: dateParts.day
        };
        if (!ruleMatches(automation, context)) return false;
        return executeAutomationActions(automation, context);
    },

    async _handleUpdateWorldTime() {
        if (!game.user?.isGM) return;
        const parts = getWorldDateParts();
        const dateKey = `${parts.year}-${parts.month}-${parts.day}`;
        const snapshot = this._lastWorldTimeSnapshot;
        if (snapshot !== null) {
            if (snapshot.dateKey !== dateKey) {
                await this.triggerEvent('worldDate', 'tick');
            }
            if (snapshot.minutes !== parts.minutes) {
                await this.triggerEvent('worldTime', 'tick');
            }
        }
        this._lastWorldTimeSnapshot = { dateKey, minutes: parts.minutes };
    },

    isArtificerAvailable() {
        return !!game.modules?.get('coffee-pub-artificer')?.active;
    },

    getArtificerTagOptions() {
        if (!this.isArtificerAvailable()) return [];
        const tags = new Set();
        for (const scene of game.scenes?.contents ?? []) {
            for (const habitat of getSceneArtificerHabitats(scene)) {
                tags.add(habitat);
            }
        }
        return Array.from(tags).sort((a, b) => a.localeCompare(b));
    },

    async initialize() {
        if (!game.user?.isGM) return;
        await this.migrateLegacySettingsToPlaylists();

        if (typeof Hooks !== 'undefined' && !updateWorldTimeHookCallback) {
            updateWorldTimeHookCallback = async () => {
                await this._handleUpdateWorldTime();
            };
            Hooks.on('updateWorldTime', updateWorldTimeHookCallback);
        }

        if (typeof BlacksmithHookManager === 'undefined' || this._hookIds.length) return;

        const registrations = [
            {
                name: 'combatStart',
                description: 'Minstrel combat start automation',
                callback: async (combat) => {
                    RuntimeManager.setCombatState(true);
                    if (combat?.id) this._lastRoundByCombatId.set(String(combat.id), Number(combat.round ?? 0));
                    await this.triggerEvent('combat', 'start');
                    if (Number(combat?.round ?? 0) > 0) {
                        await this.triggerEvent('round', 'start');
                    }
                }
            },
            {
                name: 'updateCombat',
                description: 'Minstrel round change automation',
                callback: async (combat, changed) => {
                    if (!combat?.id || !combat?.started || !Object.hasOwn(changed ?? {}, 'round')) return;
                    const combatId = String(combat.id);
                    const previousRound = Number(this._lastRoundByCombatId.get(combatId) ?? 0);
                    const nextRound = Number(changed.round ?? combat.round ?? 0);
                    if (previousRound > 0 && nextRound !== previousRound) {
                        await this.triggerEvent('round', 'end');
                    }
                    this._lastRoundByCombatId.set(combatId, nextRound);
                    if (nextRound > 0 && nextRound !== previousRound) {
                        await this.triggerEvent('round', 'start');
                    }
                }
            },
            {
                name: 'deleteCombat',
                description: 'Minstrel combat end automation',
                callback: async (combat) => {
                    if (combat?.id) this._lastRoundByCombatId.delete(String(combat.id));
                    RuntimeManager.setCombatState(false);
                    await this.triggerEvent('combat', 'end');
                }
            },
            {
                name: 'canvasTearDown',
                description: 'Minstrel scene end automation',
                callback: async () => {
                    await this.triggerEvent('scene', 'end');
                }
            },
            {
                name: 'canvasReady',
                description: 'Minstrel scene start automation',
                callback: async () => {
                    await CueManager.stopSceneChangeCues();
                    await this.triggerEvent('scene', 'start');
                }
            }
        ];

        this._hookIds = registrations.map((registration) => ({
            name: registration.name,
            callbackId: BlacksmithHookManager.registerHook({
                name: registration.name,
                description: registration.description,
                context: 'coffee-pub-minstrel',
                priority: 3,
                callback: registration.callback
            })
        }));
    },

    shutdown() {
        this._lastRoundByCombatId.clear();
        this._lastWorldTimeSnapshot = null;

        if (typeof Hooks !== 'undefined' && updateWorldTimeHookCallback) {
            Hooks.off('updateWorldTime', updateWorldTimeHookCallback);
            updateWorldTimeHookCallback = null;
        }

        if (typeof BlacksmithHookManager === 'undefined') {
            this._hookIds = [];
            return;
        }

        for (const hookRef of this._hookIds) {
            if (!hookRef?.name || !hookRef?.callbackId) continue;
            BlacksmithHookManager.unregisterHook({
                name: hookRef.name,
                callbackId: hookRef.callbackId
            });
        }
        this._hookIds = [];
    }
};
