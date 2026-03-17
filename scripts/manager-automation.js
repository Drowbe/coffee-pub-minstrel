// ==================================================================
// ===== MINSTREL AUTOMATION MANAGER ================================
// ==================================================================

import { RuntimeManager } from './manager-runtime.js';
import { SoundSceneManager } from './manager-soundscenes.js';
import { CueManager } from './manager-cues.js';
import { StorageManager } from './manager-storage.js';

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function executeRule(rule) {
    if (!rule?.enabled) return false;
    if ((rule.delayMs ?? 0) > 0) await delay(rule.delayMs);

    if (rule.eventType === 'combatEnd' && rule.restorePreviousOnExit) {
        await delay(StorageManager.getCombatRestoreDelayMs());
        await SoundSceneManager.stopActiveSoundScene({ restorePrevious: true });
        return true;
    }

    if (rule.soundSceneId) {
        return SoundSceneManager.activateSoundScene(rule.soundSceneId, {
            savePrevious: rule.eventType === 'combatStart'
        });
    }

    return false;
}

export const AutomationManager = {
    _hookIds: [],

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
        const candidates = this.getRules()
            .filter((rule) => rule.enabled && rule.eventType === eventType)
            .sort((a, b) => Number(b.priority) - Number(a.priority));

        const topRule = candidates[0];
        if (!topRule) return false;
        return executeRule(topRule);
    },

    async triggerRule(ruleId) {
        const rule = this.getRule(ruleId);
        return executeRule(rule);
    },

    async initialize() {
        if (typeof BlacksmithHookManager === 'undefined') return;

        this._hookIds.push(
            BlacksmithHookManager.registerHook({
                name: 'combatStart',
                description: 'Minstrel combat start automation',
                context: 'coffee-pub-minstrel',
                priority: 3,
                callback: async () => {
                    RuntimeManager.setCombatState(true);
                    await this.triggerEvent('combatStart');
                }
            })
        );

        this._hookIds.push(
            BlacksmithHookManager.registerHook({
                name: 'deleteCombat',
                description: 'Minstrel combat end automation',
                context: 'coffee-pub-minstrel',
                priority: 3,
                callback: async () => {
                    RuntimeManager.setCombatState(false);
                    await this.triggerEvent('combatEnd');
                }
            })
        );

        this._hookIds.push(
            BlacksmithHookManager.registerHook({
                name: 'canvasReady',
                description: 'Minstrel cue cleanup on scene change',
                context: 'coffee-pub-minstrel',
                priority: 3,
                callback: async () => {
                    await CueManager.stopSceneChangeCues();
                }
            })
        );
    }
};
