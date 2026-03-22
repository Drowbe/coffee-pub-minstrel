// ==================================================================
// ===== MINSTREL AUTOMATION MANAGER ================================
// ==================================================================

import { RuntimeManager } from './manager-runtime.js';
import { SoundSceneManager } from './manager-soundscenes.js';
import { CueManager } from './manager-cues.js';
import { StorageManager } from './manager-storage.js';

const AUTOMATION_RULE_TYPES = [
    { type: 'combatStart', label: 'Combat Start', kind: 'trigger' },
    { type: 'combatEnd', label: 'Combat End', kind: 'trigger' },
    { type: 'roundStart', label: 'Round Start', kind: 'trigger' },
    { type: 'roundEnd', label: 'Round End', kind: 'trigger' },
    { type: 'sceneChange', label: 'Scene Change', kind: 'trigger' },
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
    const worldDate = new Date((Number(game.time?.worldTime ?? 0) || 0) * 1000);
    return {
        isoDate: worldDate.toISOString().slice(0, 10),
        hour: worldDate.getUTCHours()
    };
}

function evaluateClause(clause, context) {
    if (!clause?.type) return true;

    switch (clause.type) {
        case 'combatStart':
        case 'combatEnd':
        case 'roundStart':
        case 'roundEnd':
        case 'sceneChange':
            return context.eventType === clause.type;
        case 'habitat': {
            const expected = String(clause.habitat ?? '').trim().toLowerCase();
            if (!expected) return true;
            return context.habitats.includes(expected);
        }
        case 'timeOfDay':
            return context.hour === Math.max(0, Math.min(23, Number(clause.timeHour) || 0));
        case 'date':
            return !clause.date || context.isoDate === clause.date;
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

async function executeAutomation(automation, context) {
    if (!automation?.enabled) return false;
    if (!Array.isArray(automation.rules) || !automation.rules.length) {
        return context.eventType === 'manual' && !!automation.soundSceneId;
    }
    if (!evaluateOrderedClauses(Array.isArray(automation.rules) ? automation.rules : [], context)) return false;
    if ((automation.delayMs ?? 0) > 0) await delay(automation.delayMs);

    if (context.eventType === 'combatEnd' && automation.restorePreviousOnExit) {
        await delay(StorageManager.getCombatRestoreDelayMs());
        await SoundSceneManager.stopActiveSoundScene({ restorePrevious: true });
        return true;
    }

    if (automation.soundSceneId) {
        return SoundSceneManager.activateSoundScene(automation.soundSceneId, {
            savePrevious: context.eventType === 'combatStart'
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

    createRuleClause(type = 'combatStart', join = 'and') {
        const definition = getRuleTypeDefinition(type);
        return {
            id: foundry.utils.randomID(),
            type: definition.type,
            join,
            habitat: '',
            timeHour: 12,
            date: ''
        };
    },

    getRules() {
        return StorageManager.getAutomationRules();
    },

    getRule(ruleId) {
        return this.getRules().find((rule) => rule.id === ruleId) ?? null;
    },

    async saveRule(rule) {
        const rules = this.getRules();
        const next = rules.some((entry) => entry.id === rule.id)
            ? rules.map((entry) => entry.id === rule.id ? rule : entry)
            : [...rules, rule];
        await StorageManager.saveAutomationRules(next);
        return rule;
    },

    async deleteRule(ruleId) {
        const next = this.getRules().filter((rule) => rule.id !== ruleId);
        await StorageManager.saveAutomationRules(next);
    },

    async triggerEvent(eventType) {
        const scene = getActiveScene();
        const dateParts = getWorldDateParts();
        const context = {
            eventType,
            scene,
            habitats: getSceneArtificerHabitats(scene),
            isoDate: dateParts.isoDate,
            hour: dateParts.hour
        };

        const candidates = this.getRules()
            .filter((rule) => rule.enabled)
            .sort((a, b) => Number(b.priority) - Number(a.priority));

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
            scene,
            habitats: getSceneArtificerHabitats(scene),
            isoDate: dateParts.isoDate,
            hour: dateParts.hour
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
        if (typeof BlacksmithHookManager === 'undefined' || this._hookIds.length) return;

        const registrations = [
            {
                name: 'combatStart',
                description: 'Minstrel combat start automation',
                callback: async (combat) => {
                    RuntimeManager.setCombatState(true);
                    if (combat?.id) this._lastRoundByCombatId.set(String(combat.id), Number(combat.round ?? 0));
                    await this.triggerEvent('combatStart');
                    if (Number(combat?.round ?? 0) > 0) {
                        await this.triggerEvent('roundStart');
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
                        await this.triggerEvent('roundEnd');
                    }
                    this._lastRoundByCombatId.set(combatId, nextRound);
                    if (nextRound > 0 && nextRound !== previousRound) {
                        await this.triggerEvent('roundStart');
                    }
                }
            },
            {
                name: 'deleteCombat',
                description: 'Minstrel combat end automation',
                callback: async (combat) => {
                    if (combat?.id) this._lastRoundByCombatId.delete(String(combat.id));
                    RuntimeManager.setCombatState(false);
                    await this.triggerEvent('combatEnd');
                }
            },
            {
                name: 'canvasReady',
                description: 'Minstrel scene change automation',
                callback: async () => {
                    await CueManager.stopSceneChangeCues();
                    await this.triggerEvent('sceneChange');
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
