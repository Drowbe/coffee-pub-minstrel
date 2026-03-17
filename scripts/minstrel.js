// ==================================================================
// ===== MODULE IMPORTS =============================================
// ==================================================================

import { MODULE } from './const.js';
import { registerSettings } from './settings.js';
import { MinstrelManager } from './manager-minstrel.js';

// Import Blacksmith API bridge
import { BlacksmithAPI } from '/modules/coffee-pub-blacksmith/api/blacksmith-api.js';

// ==================================================================
// ===== MODULE INITIALIZATION ======================================
// ==================================================================

Hooks.once('init', async () => {
    await loadTemplates([
        'modules/coffee-pub-minstrel/templates/window-minstrel.hbs',
        'modules/coffee-pub-minstrel/templates/partials/window-minstrel-body.hbs'
    ]);
});

Hooks.once('ready', async () => {
    try {
        registerSettings();

        if (typeof BlacksmithModuleManager !== 'undefined') {
            BlacksmithModuleManager.registerModule(MODULE.ID, {
                name: MODULE.NAME,
                version: MODULE.VERSION
            });
        }

        await MinstrelManager.initialize();

        if (typeof BlacksmithUtils !== 'undefined' && BlacksmithUtils.postConsoleAndNotification) {
            BlacksmithUtils.postConsoleAndNotification(
                MODULE.ID,
                `${MODULE.TITLE}: Initialized`,
                null,
                false,
                false
            );
        }
    } catch (error) {
        if (typeof BlacksmithUtils !== 'undefined' && BlacksmithUtils.postConsoleAndNotification) {
            BlacksmithUtils.postConsoleAndNotification(
                MODULE.ID,
                `${MODULE.TITLE}: Initialization failed`,
                error?.message ?? String(error),
                false,
                true
            );
        } else {
            console.error(`${MODULE.TITLE}: Initialization failed`, error);
        }
    }
});
