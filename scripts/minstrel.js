// ==================================================================
// ===== MODULE IMPORTS =============================================
// ==================================================================

import { BlacksmithAPI } from '/modules/coffee-pub-blacksmith/api/blacksmith-api.js';
import { MODULE } from './const.js';
import { registerSettings } from './settings.js';
import { MinstrelManager } from './manager-minstrel.js';

// ==================================================================
// ===== MODULE INITIALIZATION ======================================
// ==================================================================

Hooks.once('init', async () => {
    await foundry.applications.handlebars.loadTemplates([
        'modules/coffee-pub-minstrel/templates/window-minstrel.hbs',
        'modules/coffee-pub-minstrel/templates/partials/window-minstrel-body.hbs'
    ]);
});

Hooks.once('ready', async () => {
    try {
        const blacksmith = game.modules.get('coffee-pub-blacksmith');
        if (blacksmith?.active && typeof BlacksmithAPI?.waitForReady === 'function') {
            await BlacksmithAPI.waitForReady();
        }

        registerSettings();

        if (typeof BlacksmithModuleManager?.registerModule === 'function') {
            BlacksmithModuleManager.registerModule(MODULE.ID, {
                name: MODULE.NAME,
                version: MODULE.VERSION
            });
        }

        await MinstrelManager.initialize();

        if (game.user?.isGM && typeof BlacksmithUtils?.postConsoleAndNotification === 'function') {
            BlacksmithUtils.postConsoleAndNotification(
                MODULE.ID,
                `${MODULE.TITLE}: Initialized`,
                null,
                false,
                false
            );
        }
    } catch (error) {
        if (typeof BlacksmithUtils?.postConsoleAndNotification === 'function') {
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

Hooks.on('disableModule', (moduleId) => {
    if (moduleId !== MODULE.ID) return;
    void MinstrelManager.shutdown();
});
