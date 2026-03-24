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
    if (!ref) return null;
    const type = ['music', 'environment', 'scheduled-one-shot'].includes(layer?.type)
        ? layer.type
        : fallbackType ?? (ref.channel === 'music' ? 'music' : ref.channel === 'cue' ? 'scheduled-one-shot' : 'environment');
    return {
        id: String(layer?.id ?? randomId('layer')),
        type,
        trackRef: ref,
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

function sanitizeAutomationRule(rule) {
    if (!rule || typeof rule !== 'object') return null;
    const sanitizeAutomationClause = (clause, index = 0) => {
        if (!clause || typeof clause !== 'object') return null;
        const type = [
            'combat',
            'round',
            'scene',
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
            habitat: String(clause.habitat ?? '').trim(),
            timeStartMinutes: Number.isFinite(Number(clause.timeStartMinutes)) ? Math.max(0, Math.min(1439, Number(clause.timeStartMinutes))) : 480,
            timeEndMinutes: Number.isFinite(Number(clause.timeEndMinutes)) ? Math.max(0, Math.min(1439, Number(clause.timeEndMinutes))) : 1020,
            dateYear: Number.isFinite(Number(clause.dateYear)) ? Number(clause.dateYear) : '',
            dateMonth: Number.isFinite(Number(clause.dateMonth)) ? Number(clause.dateMonth) : 1,
            dateDay: Number.isFinite(Number(clause.dateDay)) ? Number(clause.dateDay) : 1
        };
    };

    const migratedClauses = [];
    if (rule.eventType && rule.eventType !== 'manualTrigger') {
        migratedClauses.push(sanitizeAutomationClause({
            type: rule.eventType.startsWith('combat') ? 'combat' : rule.eventType.startsWith('round') ? 'round' : 'scene',
            phase: rule.eventType.endsWith('End') ? 'end' : 'start',
            join: 'and'
        }, migratedClauses.length));
    }
    if (rule.sceneTag) {
        migratedClauses.push(sanitizeAutomationClause({
            type: 'habitat',
            join: 'and',
            habitat: rule.sceneTag
        }, migratedClauses.length));
    }
    if (Number.isFinite(Number(rule.timeOfDayHour))) {
        migratedClauses.push(sanitizeAutomationClause({
            type: 'timeOfDay',
            join: 'and',
            timeStartMinutes: Number(rule.timeOfDayHour) * 60,
            timeEndMinutes: Number(rule.timeOfDayHour) * 60
        }, migratedClauses.length));
    }

    return {
        id: String(rule.id ?? randomId('rule')),
        name: String(rule.name ?? 'New Rule').trim() || 'New Rule',
        rules: Array.isArray(rule.rules)
            ? rule.rules.map((clause, index) => sanitizeAutomationClause(clause, index)).filter(Boolean)
            : migratedClauses,
        action: ['start', 'stop'].includes(String(rule.action ?? '').trim().toLowerCase())
            ? String(rule.action).trim().toLowerCase()
            : 'start',
        soundSceneId: rule.soundSceneId ? String(rule.soundSceneId) : null,
        priority: Number.isFinite(Number(rule.priority)) ? Number(rule.priority) : 0,
        delayMs: Number.isFinite(Number(rule.delayMs)) ? Number(rule.delayMs) : 0,
        restorePreviousOnExit: !!rule.restorePreviousOnExit,
        enabled: rule.enabled !== false
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

    getAutomationRules() {
        const raw = getSetting(SETTING_KEYS.AUTOMATION_RULES, []);
        return Array.isArray(raw) ? raw.map(sanitizeAutomationRule).filter(Boolean) : [];
    },

    async saveAutomationRules(rules) {
        return setSetting(SETTING_KEYS.AUTOMATION_RULES, rules.map(sanitizeAutomationRule).filter(Boolean));
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
    }
};
