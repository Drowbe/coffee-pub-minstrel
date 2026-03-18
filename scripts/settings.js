// ==================================================================
// ===== IMPORTS ====================================================
// ==================================================================

import { MODULE } from './const.js';

// ==================================================================
// ===== SETTING KEYS ===============================================
// ==================================================================

export const SETTING_KEYS = {
    DEFAULT_FADE_SECONDS: 'defaultFadeSeconds',
    RECENT_LIMIT: 'recentLimit',
    COMBAT_RESTORE_DELAY_MS: 'combatRestoreDelayMs',
    SOUND_SCENES: 'soundScenes',
    CUES: 'cues',
    AUTOMATION_RULES: 'automationRules',
    FAVORITES: 'favorites',
    FAVORITE_PLAYLISTS: 'favoritePlaylists',
    RECENTS: 'recents',
    WINDOW_STATE: 'windowStateMinstrel'
};

// ==================================================================
// ===== SETTINGS REGISTRATION ======================================
// ==================================================================

export const registerSettings = () => {
    game.settings.register(MODULE.ID, SETTING_KEYS.DEFAULT_FADE_SECONDS, {
        name: `${MODULE.ID}.defaultFadeSeconds-Label`,
        hint: `${MODULE.ID}.defaultFadeSeconds-Hint`,
        scope: 'world',
        config: true,
        default: 2,
        type: Number,
        range: {
            min: 0,
            max: 30,
            step: 1
        }
    });

    game.settings.register(MODULE.ID, SETTING_KEYS.RECENT_LIMIT, {
        name: `${MODULE.ID}.recentLimit-Label`,
        hint: `${MODULE.ID}.recentLimit-Hint`,
        scope: 'world',
        config: true,
        default: 12,
        type: Number,
        range: {
            min: 3,
            max: 50,
            step: 1
        }
    });

    game.settings.register(MODULE.ID, SETTING_KEYS.COMBAT_RESTORE_DELAY_MS, {
        name: `${MODULE.ID}.combatRestoreDelayMs-Label`,
        hint: `${MODULE.ID}.combatRestoreDelayMs-Hint`,
        scope: 'world',
        config: true,
        default: 3000,
        type: Number,
        range: {
            min: 0,
            max: 30000,
            step: 500
        }
    });

    game.settings.register(MODULE.ID, SETTING_KEYS.SOUND_SCENES, {
        scope: 'world',
        config: false,
        default: [],
        type: Object
    });

    game.settings.register(MODULE.ID, SETTING_KEYS.CUES, {
        scope: 'world',
        config: false,
        default: [],
        type: Object
    });

    game.settings.register(MODULE.ID, SETTING_KEYS.AUTOMATION_RULES, {
        scope: 'world',
        config: false,
        default: [],
        type: Object
    });

    game.settings.register(MODULE.ID, SETTING_KEYS.FAVORITES, {
        scope: 'world',
        config: false,
        default: [],
        type: Object
    });

    game.settings.register(MODULE.ID, SETTING_KEYS.FAVORITE_PLAYLISTS, {
        scope: 'world',
        config: false,
        default: [],
        type: Object
    });

    game.settings.register(MODULE.ID, SETTING_KEYS.RECENTS, {
        scope: 'world',
        config: false,
        default: [],
        type: Object
    });

    game.settings.register(MODULE.ID, SETTING_KEYS.WINDOW_STATE, {
        scope: 'client',
        config: false,
        default: {
            tab: 'dashboard',
            selectedSoundSceneId: null,
            selectedCueId: null,
            selectedRuleId: null,
            bounds: {}
        },
        type: Object
    });
};
