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

function getActiveScene() {
    return canvas?.scene ?? game.scenes?.get?.(game.user?.viewedScene) ?? null;
}

function getSceneArtificerTags(scene) {
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

function matchesSceneTag(rule) {
    const expectedTags = String(rule?.sceneTag ?? '')
        .split(',')
        .map((entry) => entry.trim().toLowerCase())
        .filter(Boolean);
    if (!expectedTags.length) return true;
    const scene = getActiveScene();
    if (!scene) return false;
    const tags = getSceneArtificerTags(scene);
    return expectedTags.some((expected) => tags.includes(expected));
}

async function applyTimeOfDay(rule) {
    if (!Number.isFinite(Number(rule?.timeOfDayHour))) return;
    if (typeof game.time?.advance !== 'function') return;

    const targetHour = Math.max(0, Math.min(23, Number(rule.timeOfDayHour)));
    const currentWorldTime = Number(game.time.worldTime ?? 0);
    const secondsPerDay = 86400;
    const dayStart = Math.floor(currentWorldTime / secondsPerDay) * secondsPerDay;
    let targetWorldTime = dayStart + (targetHour * 3600);
    if (targetWorldTime < currentWorldTime) targetWorldTime += secondsPerDay;
    const delta = targetWorldTime - currentWorldTime;
    if (delta > 0) {
        await game.time.advance(delta);
    }
}

async function executeRule(rule) {
    if (!rule?.enabled) return false;
    if (!matchesSceneTag(rule)) return false;
    if ((rule.delayMs ?? 0) > 0) await delay(rule.delayMs);
    await applyTimeOfDay(rule);

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

        for (const rule of candidates) {
            if (await executeRule(rule)) return true;
        }
        return false;
    },

    async triggerRule(ruleId) {
        const rule = this.getRule(ruleId);
        return executeRule(rule);
    },

    isArtificerAvailable() {
        return !!game.modules?.get('coffee-pub-artificer')?.active;
    },

    getArtificerTagOptions() {
        if (!this.isArtificerAvailable()) return [];
        const tags = new Set();
        for (const scene of game.scenes?.contents ?? []) {
            for (const tag of getSceneArtificerTags(scene)) {
                tags.add(tag);
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
                callback: async () => {
                    RuntimeManager.setCombatState(true);
                    await this.triggerEvent('combatStart');
                }
            },
            {
                name: 'deleteCombat',
                description: 'Minstrel combat end automation',
                callback: async () => {
                    RuntimeManager.setCombatState(false);
                    await this.triggerEvent('combatEnd');
                }
            },
            {
                name: 'canvasReady',
                description: 'Minstrel cue cleanup on scene change',
                callback: async () => {
                    await CueManager.stopSceneChangeCues();
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
