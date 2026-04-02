// ==================================================================
// ===== MINSTREL STORAGE ===========================================
// ==================================================================

import { MODULE } from './const.js';
import { SETTING_KEYS } from './settings.js';

function log(message, result = null, debug = false, notification = false) {
    if (typeof BlacksmithUtils !== 'undefined' && BlacksmithUtils.postConsoleAndNotification) {
        BlacksmithUtils.postConsoleAndNotification(MODULE.ID, message, result, debug, notification);
    } else {
        console.log(`${MODULE.TITLE}: ${message}`, result ?? '');
    }
}

function randomId(prefix) {
    return `${prefix}-${foundry.utils.randomID()}`;
}

function getSetting(key, fallback) {
    try {
        if (typeof BlacksmithUtils !== 'undefined' && BlacksmithUtils.getSettingSafely) {
            return BlacksmithUtils.getSettingSafely(MODULE.ID, key, fallback);
        }
        return game.settings.get(MODULE.ID, key);
    } catch (_error) {
        return fallback;
    }
}

async function setSetting(key, value) {
    if (typeof BlacksmithUtils !== 'undefined' && BlacksmithUtils.setSettingSafely) {
        return BlacksmithUtils.setSettingSafely(MODULE.ID, key, value);
    }
    return game.settings.set(MODULE.ID, key, value);
}

function normalizeCueIcon(icon) {
    const value = String(icon ?? '').trim();
    if (!value) return 'fa-solid fa-bell';
    if (value.includes(' ')) return value;
    if (value.startsWith('fa-')) return `fa-solid ${value}`;
    return `fa-solid fa-${value}`;
}

function normalizeAutomationIcon(icon) {
    const value = String(icon ?? '').trim();
    if (!value) return 'fa-solid fa-diagram-project';
    if (value.includes(' ')) return value;
    if (value.startsWith('fa-')) return `fa-solid ${value}`;
    return `fa-solid fa-${value}`;
}

const MINSTREL_PLAYLIST_FOLDER_NAME = 'Minstrel';
const MINSTREL_PLAYLIST_FOLDER_COLOR = '#5a4116';
const MINSTREL_PLAYLIST_SUBFOLDER_COLOR = '#6d4808';

function getPlaylistFolderCollection() {
    return (game.folders?.contents ?? []).filter((folder) => folder?.type === 'Playlist');
}

async function ensurePlaylistFolder(name, color, parentFolder = null) {
    const normalizedName = String(name ?? '').trim();
    const parentId = String(parentFolder?.id ?? '');
    let folder = getPlaylistFolderCollection().find((entry) => (
        String(entry.name ?? '').trim().toLowerCase() === normalizedName.toLowerCase()
        && String(entry.folder?.id ?? entry.folder ?? '') === parentId
    )) ?? null;

    if (!folder) {
        folder = await Folder.create({
            name: normalizedName,
            type: 'Playlist',
            folder: parentFolder?.id ?? null,
            color,
            sorting: 'a'
        });
        return folder;
    }

    const updates = {};
    if (String(folder.color ?? '') !== String(color ?? '')) updates.color = color;
    const currentParentId = String(folder.folder?.id ?? folder.folder ?? '');
    if (currentParentId !== parentId) updates.folder = parentFolder?.id ?? null;
    if (Object.keys(updates).length) {
        await folder.update(updates);
    }
    return folder;
}

function normalizeAutomationImportance(rule) {
    const explicit = String(rule?.importance ?? '').trim().toLowerCase();
    if (['high', 'normal', 'low'].includes(explicit)) return explicit;

    const numericPriority = Number(rule?.priority);
    if (Number.isFinite(numericPriority)) {
        if (numericPriority > 0) return 'high';
        if (numericPriority < 0) return 'low';
    }
    return 'normal';
}

function sanitizeTrackRef(ref) {
    if (!ref || typeof ref !== 'object') return null;
    if (!ref.playlistId || !ref.soundId) return null;
    return {
        playlistId: String(ref.playlistId),
        soundId: String(ref.soundId),
        label: String(ref.label ?? ''),
        playlistName: String(ref.playlistName ?? ''),
        soundName: String(ref.soundName ?? ''),
        path: String(ref.path ?? ''),
        volume: Number.isFinite(Number(ref.volume)) ? Number(ref.volume) : undefined,
        channel: String(ref.channel ?? '')
    };
}

function sanitizePlaylistRef(ref) {
    if (!ref || typeof ref !== 'object') return null;
    if (!ref.playlistId) return null;
    return {
        playlistId: String(ref.playlistId),
        playlistName: String(ref.playlistName ?? '')
    };
}

function sanitizeAmbientTrack(track) {
    const ref = sanitizeTrackRef(track);
    if (!ref) return null;
    return {
        ...ref,
        volume: Number.isFinite(Number(track.volume)) ? Number(track.volume) : 0.75,
        fadeIn: Number.isFinite(Number(track.fadeIn)) ? Number(track.fadeIn) : 0,
        fadeOut: Number.isFinite(Number(track.fadeOut)) ? Number(track.fadeOut) : 0,
        delayMs: Number.isFinite(Number(track.delayMs)) ? Number(track.delayMs) : 0
    };
}

function sanitizeSceneLayer(layer, fallbackType = null) {
    const ref = sanitizeTrackRef(layer?.trackRef ?? layer);
    const sourceTrackRef = sanitizeTrackRef(layer?.sourceTrackRef) ?? ref;
    if (!ref) return null;
    const type = ['music', 'environment', 'scheduled-one-shot'].includes(layer?.type)
        ? layer.type
        : fallbackType ?? (ref.channel === 'music' ? 'music' : ref.channel === 'cue' ? 'scheduled-one-shot' : 'environment');
    return {
        id: String(layer?.id ?? randomId('layer')),
        type,
        trackRef: ref,
        sourceTrackRef,
        volume: Number.isFinite(Number(layer?.volume)) ? Number(layer.volume) : (type === 'music' ? 0.75 : type === 'scheduled-one-shot' ? 1 : 0.65),
        fadeIn: Number.isFinite(Number(layer?.fadeIn)) ? Number(layer.fadeIn) : 0,
        fadeOut: Number.isFinite(Number(layer?.fadeOut)) ? Number(layer.fadeOut) : 0,
        startDelayMs: Number.isFinite(Number(layer?.startDelayMs ?? layer?.delayMs)) ? Number(layer.startDelayMs ?? layer.delayMs) : 0,
        frequencySeconds: Number.isFinite(Number(layer?.frequencySeconds)) ? Number(layer.frequencySeconds) : 120,
        loopMode: String(layer?.loopMode ?? 'loop').trim() || 'loop',
        enabled: layer?.enabled !== false
    };
}

function sanitizeSoundScene(scene) {
    if (!scene || typeof scene !== 'object') return null;
    const music = sanitizeTrackRef(scene.music);
    const explicitLayers = Array.isArray(scene.layers)
        ? scene.layers.map((layer) => sanitizeSceneLayer(layer)).filter(Boolean)
        : [];
    const migratedLayers = explicitLayers.length ? explicitLayers : [
        music ? sanitizeSceneLayer({
            type: 'music',
            trackRef: {
                ...music,
                volume: Number.isFinite(Number(scene.music?.volume)) ? Number(scene.music.volume) : 0.75
            },
            volume: Number.isFinite(Number(scene.music?.volume)) ? Number(scene.music.volume) : 0.75,
            fadeIn: Number.isFinite(Number(scene.fadeIn)) ? Number(scene.fadeIn) : 0,
            fadeOut: Number.isFinite(Number(scene.fadeOut)) ? Number(scene.fadeOut) : 0
        }, 'music') : null,
        ...(Array.isArray(scene.ambientTracks) ? scene.ambientTracks.map((track) => sanitizeSceneLayer(track, 'environment')) : [])
    ].filter(Boolean);
    return {
        id: String(scene.id ?? randomId('scene')),
        name: String(scene.name ?? 'New Sound Scene').trim() || 'New Sound Scene',
        description: String(scene.description ?? '').trim(),
        backgroundImage: String(scene.backgroundImage ?? '').trim(),
        tags: Array.isArray(scene.tags) ? scene.tags.map((tag) => String(tag).trim()).filter(Boolean) : [],
        linkedSceneIds: [],
        music: music ? {
            ...music,
            volume: Number.isFinite(Number(scene.music?.volume)) ? Number(scene.music.volume) : 0.75
        } : null,
        ambientTracks: Array.isArray(scene.ambientTracks) ? scene.ambientTracks.map(sanitizeAmbientTrack).filter(Boolean) : [],
        layers: migratedLayers,
        volumes: {
            music: Number.isFinite(Number(scene.volumes?.music)) ? Number(scene.volumes.music) : 0.75,
            ambient: Number.isFinite(Number(scene.volumes?.ambient)) ? Number(scene.volumes.ambient) : 0.65,
            cues: Number.isFinite(Number(scene.volumes?.cues)) ? Number(scene.volumes.cues) : 1
        },
        fadeIn: Number.isFinite(Number(scene.fadeIn)) ? Number(scene.fadeIn) : 0,
        fadeOut: Number.isFinite(Number(scene.fadeOut)) ? Number(scene.fadeOut) : 0,
        restorePreviousOnExit: scene.restorePreviousOnExit !== false,
        enabled: scene.enabled !== false,
        favorite: !!scene.favorite
    };
}

function sanitizeCue(cue) {
    if (!cue || typeof cue !== 'object') return null;
    const ref = sanitizeTrackRef(cue.track);
    return {
        id: String(cue.id ?? randomId('cue')),
        name: String(cue.name ?? 'New Cue').trim() || 'New Cue',
        icon: normalizeCueIcon(cue.icon ?? 'fa-solid fa-bell'),
        category: String(cue.category ?? '').trim(),
        categoryMode: String(cue.categoryMode ?? '').trim() === 'create' ? 'create' : 'existing',
        tintColor: String(cue.tintColor ?? '#b96c26').trim() || '#b96c26',
        track: ref,
        volume: Number.isFinite(Number(cue.volume)) ? Number(cue.volume) : 1,
        cooldown: Number.isFinite(Number(cue.cooldown)) ? Number(cue.cooldown) : 0,
        duckOthers: !!cue.duckOthers,
        stopOnSceneChange: !!cue.stopOnSceneChange,
        favorite: !!cue.favorite,
        enabled: cue.enabled !== false
    };
}

/** v3: scene document filter removed from triggers (use Scene condition); one-time hoist from legacy trigger.sceneId. */
const AUTOMATION_SCHEMA_VERSION = 3;
const AUTOMATION_TRIGGER_TYPES = new Set(['combat', 'round', 'scene', 'worldTime', 'worldDate', 'manual']);
const AUTOMATION_CONDITION_TYPES = new Set(['scene', 'sceneNameContains', 'habitat', 'timeOfDay', 'date']);

function sanitizeConditionClause(clause, index = 0) {
    if (!clause || typeof clause !== 'object') return null;
    const type = AUTOMATION_CONDITION_TYPES.has(clause.type) ? clause.type : 'habitat';
    return {
        id: String(clause.id ?? randomId(`rule-clause-${index}`)),
        type,
        join: ['and', 'or', 'not'].includes(clause.join) ? clause.join : 'and',
        phase: ['start', 'end'].includes(clause.phase) ? clause.phase : 'start',
        sceneId: clause.sceneId ? String(clause.sceneId) : '',
        sceneNameContains: String(clause.sceneNameContains ?? '').trim(),
        habitat: String(clause.habitat ?? '').trim(),
        timeStartMinutes: Number.isFinite(Number(clause.timeStartMinutes)) ? Math.max(0, Math.min(1439, Number(clause.timeStartMinutes))) : 480,
        timeEndMinutes: Number.isFinite(Number(clause.timeEndMinutes)) ? Math.max(0, Math.min(1440, Number(clause.timeEndMinutes))) : 1020,
        dateYear: Number.isFinite(Number(clause.dateYear)) ? Number(clause.dateYear) : '',
        dateMonth: Number.isFinite(Number(clause.dateMonth)) ? Number(clause.dateMonth) : 1,
        dateDay: Number.isFinite(Number(clause.dateDay)) ? Number(clause.dateDay) : 1
    };
}

function sanitizeTriggerClause(clause, index = 0) {
    if (!clause || typeof clause !== 'object') return null;
    const type = AUTOMATION_TRIGGER_TYPES.has(clause.type) ? clause.type : 'scene';
    return {
        id: String(clause.id ?? randomId(`rule-trg-${index}`)),
        type,
        join: 'or',
        phase: ['start', 'end'].includes(clause.phase) ? clause.phase : 'start'
    };
}

function sanitizeConditionGroup(group, index = 0) {
    if (!group || typeof group !== 'object') return null;
    let innerJoin = ['and', 'or'].includes(group.innerJoin) ? group.innerJoin : 'and';
    let clauses = Array.isArray(group.clauses)
        ? group.clauses.map((c, i) => sanitizeConditionClause(c, i)).filter(Boolean)
        : [];
    /** Legacy UI stored “Any of (OR)” on the group while row joins stayed `and`; fold into explicit row ORs. */
    if (innerJoin === 'or' && clauses.length > 1 && clauses.slice(1).every((c) => c.join === 'and')) {
        clauses = clauses.map((c, i) => (i >= 1 ? { ...c, join: 'or' } : c));
        innerJoin = 'and';
    }
    return {
        id: String(group.id ?? randomId(`cndgrp-${index}`)),
        innerJoin: 'and',
        clauses
    };
}

function migrateAutomationRuleV1ToV2(rule) {
    const sanitizeLegacyClause = (clause, index = 0) => {
        if (!clause || typeof clause !== 'object') return null;
        const type = [
            'combat',
            'round',
            'scene',
            'sceneNameContains',
            'habitat',
            'timeOfDay',
            'date'
        ].includes(clause.type) ? clause.type : 'combat';
        return {
            id: String(clause.id ?? randomId(`rule-clause-${index}`)),
            type,
            join: ['and', 'or', 'not'].includes(clause.join) ? clause.join : 'and',
            phase: ['start', 'end'].includes(clause.phase) ? clause.phase : 'start',
            sceneId: clause.sceneId ? String(clause.sceneId) : '',
            sceneNameContains: String(clause.sceneNameContains ?? '').trim(),
            habitat: String(clause.habitat ?? '').trim(),
            timeStartMinutes: Number.isFinite(Number(clause.timeStartMinutes)) ? Math.max(0, Math.min(1439, Number(clause.timeStartMinutes))) : 480,
            timeEndMinutes: Number.isFinite(Number(clause.timeEndMinutes)) ? Math.max(0, Math.min(1440, Number(clause.timeEndMinutes))) : 1020,
            dateYear: Number.isFinite(Number(clause.dateYear)) ? Number(clause.dateYear) : '',
            dateMonth: Number.isFinite(Number(clause.dateMonth)) ? Number(clause.dateMonth) : 1,
            dateDay: Number.isFinite(Number(clause.dateDay)) ? Number(clause.dateDay) : 1
        };
    };

    const migratedClauses = [];
    if (rule.eventType && rule.eventType !== 'manualTrigger') {
        migratedClauses.push(sanitizeLegacyClause({
            type: rule.eventType.startsWith('combat') ? 'combat' : rule.eventType.startsWith('round') ? 'round' : 'scene',
            phase: rule.eventType.endsWith('End') ? 'end' : 'start',
            join: 'and'
        }, migratedClauses.length));
    }
    if (rule.sceneTag) {
        migratedClauses.push(sanitizeLegacyClause({
            type: 'habitat',
            join: 'and',
            habitat: rule.sceneTag
        }, migratedClauses.length));
    }
    if (Number.isFinite(Number(rule.timeOfDayHour))) {
        migratedClauses.push(sanitizeLegacyClause({
            type: 'timeOfDay',
            join: 'and',
            timeStartMinutes: Number(rule.timeOfDayHour) * 60,
            timeEndMinutes: Number(rule.timeOfDayHour) * 60
        }, migratedClauses.length));
    }

    const rawRules = Array.isArray(rule.rules) && rule.rules.length
        ? rule.rules.map((c, i) => sanitizeLegacyClause(c, i)).filter(Boolean)
        : migratedClauses;

    const triggerKinds = new Set(['combat', 'round', 'scene']);
    const triggers = [];
    const conditionClauses = [];
    for (const c of rawRules) {
        if (triggerKinds.has(c.type)) {
            if (String(c.sceneId ?? '').trim()) {
                conditionClauses.push(sanitizeConditionClause(
                    {
                        type: 'scene',
                        join: 'and',
                        sceneId: c.sceneId,
                        phase: c.phase,
                        sceneNameContains: '',
                        habitat: '',
                        timeStartMinutes: c.timeStartMinutes,
                        timeEndMinutes: c.timeEndMinutes,
                        dateYear: c.dateYear,
                        dateMonth: c.dateMonth,
                        dateDay: c.dateDay
                    },
                    conditionClauses.length
                ));
            }
            triggers.push(sanitizeTriggerClause(c, triggers.length));
        } else {
            conditionClauses.push(sanitizeConditionClause(c, conditionClauses.length));
        }
    }
    if (!triggers.length) {
        triggers.push(sanitizeTriggerClause({ type: 'scene', phase: 'start' }, 0));
    }

    const { rules: _droppedLegacyRules, ...base } = rule;
    return {
        ...base,
        automationSchemaVersion: AUTOMATION_SCHEMA_VERSION,
        triggers,
        conditionGroups: [sanitizeConditionGroup({
            id: randomId('cndgrp-0'),
            innerJoin: 'and',
            clauses: conditionClauses
        }, 0)]
    };
}

function sanitizeAutomationRule(rule) {
    if (!rule || typeof rule !== 'object') return null;

    let working = { ...rule };
    const hasTriggersAndGroups = Array.isArray(working.triggers) && Array.isArray(working.conditionGroups);
    const schemaNum = Number(working.automationSchemaVersion) || 0;
    const hasV2PlusShape = schemaNum >= 2 && hasTriggersAndGroups;

    if (!hasV2PlusShape && Array.isArray(working.rules) && working.rules.length) {
        working = migrateAutomationRuleV1ToV2(working);
    } else if (!hasV2PlusShape) {
        working.automationSchemaVersion = AUTOMATION_SCHEMA_VERSION;
        working.triggers = [sanitizeTriggerClause({ type: 'scene', phase: 'start' }, 0)];
        working.conditionGroups = [sanitizeConditionGroup({
            id: randomId('cndgrp-0'),
            innerJoin: 'and',
            clauses: []
        }, 0)];
    }

    const schemaAfterMigrate = Number(working.automationSchemaVersion) || 0;
    const needsTriggerSceneHoist = schemaAfterMigrate < 3 && (working.triggers ?? []).some((t) => String(t?.sceneId ?? '').trim());
    const hoistedFromTriggers = [];
    if (needsTriggerSceneHoist) {
        for (const t of working.triggers ?? []) {
            if (String(t?.sceneId ?? '').trim()) {
                hoistedFromTriggers.push(
                    sanitizeConditionClause(
                        { type: 'scene', join: 'and', sceneId: t.sceneId },
                        hoistedFromTriggers.length
                    )
                );
            }
        }
    }
    const triggers = (working.triggers ?? []).map((t, i) => sanitizeTriggerClause({ ...t, sceneId: '' }, i)).filter(Boolean);

    let conditionGroups = (working.conditionGroups ?? []).map((g, i) => sanitizeConditionGroup(g, i)).filter(Boolean);
    if (hoistedFromTriggers.length) {
        if (conditionGroups.length) {
            const g0 = conditionGroups[0];
            const merged = [...hoistedFromTriggers, ...(g0.clauses ?? [])];
            conditionGroups[0] = sanitizeConditionGroup({ ...g0, clauses: merged }, 0);
        } else {
            conditionGroups = [sanitizeConditionGroup({ innerJoin: 'and', clauses: hoistedFromTriggers }, 0)];
        }
    }

    return {
        id: String(working.id ?? randomId('rule')),
        name: String(working.name ?? 'New Rule').trim() || 'New Rule',
        category: String(working.category ?? '').trim(),
        categoryMode: String(working.categoryMode ?? '').trim() === 'create' ? 'create' : 'existing',
        icon: normalizeAutomationIcon(working.icon ?? 'fa-solid fa-diagram-project'),
        tintColor: String(working.tintColor ?? '#4f6588').trim() || '#4f6588',
        automationSchemaVersion: AUTOMATION_SCHEMA_VERSION,
        triggers: triggers.length ? triggers : [sanitizeTriggerClause({ type: 'scene', phase: 'start' }, 0)],
        conditionGroups: conditionGroups.length
            ? conditionGroups
            : [sanitizeConditionGroup({ id: randomId('cndgrp-0'), innerJoin: 'and', clauses: [] }, 0)],
        action: ['start', 'stop'].includes(String(working.action ?? '').trim().toLowerCase())
            ? String(working.action).trim().toLowerCase()
            : 'start',
        soundSceneId: working.soundSceneId ? String(working.soundSceneId) : null,
        importance: normalizeAutomationImportance(working),
        delayMs: Number.isFinite(Number(working.delayMs)) ? Number(working.delayMs) : 0,
        restorePreviousOnExit: !!working.restorePreviousOnExit,
        enabled: working.enabled !== false
    };
}

export const StorageManager = {
    log,

    getDefaultFadeSeconds() {
        return Math.max(0, Number(getSetting(SETTING_KEYS.DEFAULT_FADE_SECONDS, 2)) || 0);
    },

    getRecentLimit() {
        return Math.max(3, Number(getSetting(SETTING_KEYS.RECENT_LIMIT, 12)) || 12);
    },

    getCombatRestoreDelayMs() {
        return Math.max(0, Number(getSetting(SETTING_KEYS.COMBAT_RESTORE_DELAY_MS, 3000)) || 0);
    },

    createBlankSoundScene() {
        return sanitizeSoundScene({
            layers: []
        });
    },

    createBlankCue() {
        return sanitizeCue({});
    },

    createBlankAutomationRule() {
        return sanitizeAutomationRule({});
    },

    sanitizeAutomationRule(rule) {
        return sanitizeAutomationRule(rule);
    },

    getAutomationRules() {
        const raw = getSetting(SETTING_KEYS.AUTOMATION_RULES, []);
        return Array.isArray(raw) ? raw.map(sanitizeAutomationRule).filter(Boolean) : [];
    },

    async saveAutomationRules(rules) {
        return setSetting(SETTING_KEYS.AUTOMATION_RULES, rules.map(sanitizeAutomationRule).filter(Boolean));
    },

    async clearAutomationRulesSetting() {
        return setSetting(SETTING_KEYS.AUTOMATION_RULES, []);
    },

    getFavorites() {
        const raw = getSetting(SETTING_KEYS.FAVORITES, []);
        return Array.isArray(raw) ? raw.map(sanitizeTrackRef).filter(Boolean) : [];
    },

    async saveFavorites(favorites) {
        return setSetting(SETTING_KEYS.FAVORITES, favorites.map(sanitizeTrackRef).filter(Boolean));
    },

    getFavoritePlaylists() {
        const raw = getSetting(SETTING_KEYS.FAVORITE_PLAYLISTS, []);
        return Array.isArray(raw) ? raw.map(sanitizePlaylistRef).filter(Boolean) : [];
    },

    async saveFavoritePlaylists(playlists) {
        return setSetting(SETTING_KEYS.FAVORITE_PLAYLISTS, playlists.map(sanitizePlaylistRef).filter(Boolean));
    },

    getRecents() {
        const raw = getSetting(SETTING_KEYS.RECENTS, []);
        return Array.isArray(raw) ? raw.map(sanitizeTrackRef).filter(Boolean) : [];
    },

    async saveRecents(recents) {
        return setSetting(SETTING_KEYS.RECENTS, recents.map(sanitizeTrackRef).filter(Boolean));
    },

    getWindowState() {
        const raw = getSetting(SETTING_KEYS.WINDOW_STATE, {});
        const state = raw && typeof raw === 'object' ? raw : {};
        return {
            tab: String(state.tab ?? 'dashboard'),
            selectedSoundSceneId: state.selectedSoundSceneId ? String(state.selectedSoundSceneId) : null,
            sceneSearch: String(state.sceneSearch ?? ''),
            sceneSoundSearch: String(state.sceneSoundSearch ?? ''),
            sceneSoundFilter: String(state.sceneSoundFilter ?? 'all'),
            selectedCueId: state.selectedCueId ? String(state.selectedCueId) : null,
            selectedRuleId: state.selectedRuleId ? String(state.selectedRuleId) : null,
            playlistSearch: String(state.playlistSearch ?? ''),
            playlistChannelFilter: String(state.playlistChannelFilter ?? 'all'),
            playlistStatusFilter: String(state.playlistStatusFilter ?? 'all'),
            bounds: state.bounds && typeof state.bounds === 'object' ? state.bounds : {}
        };
    },

    async saveWindowState(windowState) {
        return setSetting(SETTING_KEYS.WINDOW_STATE, {
            ...this.getWindowState(),
            ...windowState
        });
    },

    async ensureMinstrelPlaylistFolder(kind) {
        const rootFolder = await ensurePlaylistFolder(
            MINSTREL_PLAYLIST_FOLDER_NAME,
            MINSTREL_PLAYLIST_FOLDER_COLOR,
            null
        );
        return ensurePlaylistFolder(
            String(kind ?? '').trim() || 'Unsorted',
            MINSTREL_PLAYLIST_SUBFOLDER_COLOR,
            rootFolder
        );
    }
};
