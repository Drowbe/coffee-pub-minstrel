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

const AUTOMATION_RULE_TYPES = [
    { type: 'combat', label: 'Combat', kind: 'trigger' },
    { type: 'round', label: 'Round', kind: 'trigger' },
    { type: 'scene', label: 'Scene', kind: 'trigger' },
    { type: 'sceneNameContains', label: 'Scene Name Contains', kind: 'condition' },
    { type: 'habitat', label: 'Habitat', kind: 'condition' },
    { type: 'timeOfDay', label: 'Time of Day', kind: 'condition' },
    { type: 'date', label: 'Date', kind: 'condition' }
];

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRuleTypeDefinition(type) {
    return AUTOMATION_RULE_TYPES.find((entry) => entry.type === type) ?? AUTOMATION_RULE_TYPES[0];
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

function formatRuleTypeLabel(type) {
    return getRuleTypeDefinition(type).label;
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

function minutesInRange(value, start, end) {
    const normalizedValue = Math.max(0, Math.min(1439, Number(value) || 0));
    const normalizedStart = Math.max(0, Math.min(1439, Number(start) || 0));
    const normalizedEnd = Math.max(0, Math.min(1439, Number(end) || 0));
    if (normalizedStart <= normalizedEnd) {
        return normalizedValue >= normalizedStart && normalizedValue <= normalizedEnd;
    }
    return normalizedValue >= normalizedStart || normalizedValue <= normalizedEnd;
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

function evaluateClause(clause, context) {
    if (!clause?.type) return true;

    switch (clause.type) {
        case 'combat':
        case 'round':
        case 'scene':
            if (!(context.eventType === clause.type && context.phase === (clause.phase ?? 'start'))) return false;
            if (!clause.sceneId) return true;
            return String(context.scene?.id ?? '') === String(clause.sceneId);
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

function evaluateOrderedClauses(clauses, context) {
    if (!clauses.length) return true;

    let result = evaluateClause(clauses[0], context);
    for (let index = 1; index < clauses.length; index += 1) {
        const clause = clauses[index];
        const clauseValue = evaluateClause(clause, context);
        const join = clause.join ?? 'and';

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

function getMatchingClauseCount(rule, context) {
    return (Array.isArray(rule?.rules) ? rule.rules : []).reduce((count, clause) => {
        return count + (evaluateClause(clause, context) ? 1 : 0);
    }, 0);
}

function getRuleSpecificityScore(rule) {
    return (Array.isArray(rule?.rules) ? rule.rules : []).reduce((score, clause) => {
        switch (clause?.type) {
            case 'scene':
                return score + (clause?.sceneId ? 40 : 20);
            case 'sceneNameContains':
                return score + 35;
            case 'habitat':
                return score + 25;
            case 'timeOfDay':
            case 'date':
                return score + 15;
            case 'combat':
            case 'round':
                return score + 10;
            default:
                return score + 1;
        }
    }, 0);
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

async function executeAutomation(automation, context) {
    if (!automation?.enabled) return false;
    if (!Array.isArray(automation.rules) || !automation.rules.length) {
        return context.eventType === 'manual' && (automation.action === 'stop' || !!automation.soundSceneId);
    }
    if (!evaluateOrderedClauses(Array.isArray(automation.rules) ? automation.rules : [], context)) return false;
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
        return SoundSceneManager.activateSoundScene(automation.soundSceneId, {
            savePrevious: context.eventType === 'combat' && context.phase === 'start'
        });
    }

    return false;
}

export const AutomationManager = {
    _hookIds: [],
    _lastRoundByCombatId: new Map(),

    getRuleTypes() {
        return AUTOMATION_RULE_TYPES.map((entry) => ({ ...entry }));
    },

    formatRuleTypeLabel(type) {
        return formatRuleTypeLabel(type);
    },

    createRuleClause(type = 'combat', join = 'and') {
        const definition = getRuleTypeDefinition(type);
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
            rules: foundry.utils.deepClone(sanitizedRule.rules ?? []),
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
            .filter((rule) => {
                if (!Array.isArray(rule.rules) || !rule.rules.length) {
                    return context.eventType === 'manual' && (rule.action === 'stop' || !!rule.soundSceneId);
                }
                return evaluateOrderedClauses(Array.isArray(rule.rules) ? rule.rules : [], context);
            })
            .sort((a, b) => {
                const matchCountDelta = getMatchingClauseCount(b, context) - getMatchingClauseCount(a, context);
                if (matchCountDelta !== 0) return matchCountDelta;

                const specificityDelta = getRuleSpecificityScore(b) - getRuleSpecificityScore(a);
                if (specificityDelta !== 0) return specificityDelta;

                const importanceDelta = getImportanceWeight(b) - getImportanceWeight(a);
                if (importanceDelta !== 0) return importanceDelta;

                const clauseCountDelta = (Array.isArray(b.rules) ? b.rules.length : 0) - (Array.isArray(a.rules) ? a.rules.length : 0);
                if (clauseCountDelta !== 0) return clauseCountDelta;

                return String(a.name ?? '').localeCompare(String(b.name ?? ''), undefined, { sensitivity: 'base' });
            });

        for (const automation of candidates) {
            if (await executeAutomation(automation, context)) return true;
        }
        return false;
    },

    async triggerRule(ruleId) {
        const automation = this.getRule(ruleId);
        if (!automation) return false;
        const scene = getActiveScene();
        const dateParts = getWorldDateParts();
        return executeAutomation(automation, {
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
        });
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
