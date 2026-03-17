// ==================================================================
// ===== MINSTREL ORCHESTRATION MANAGER =============================
// ==================================================================

import { MODULE } from './const.js';
import { AutomationManager } from './manager-automation.js';
import { CueManager } from './manager-cues.js';
import { PlaylistManager } from './manager-playlists.js';
import { RuntimeManager } from './manager-runtime.js';
import { SoundSceneManager } from './manager-soundscenes.js';
import { StorageManager } from './manager-storage.js';
import { MinstrelWindow } from './window-minstrel.js';

export const MinstrelManager = {
    _menubarRegistered: false,

    async initialize() {
        await AutomationManager.initialize();
        await this.registerMenubarIntegration();
    },

    async registerMenubarIntegration() {
        if (this._menubarRegistered) return;

        const blacksmith = game.modules.get('coffee-pub-blacksmith')?.api;
        if (!blacksmith?.registerMenubarTool) return;

        const barType = 'minstrel-controls';
        blacksmith.registerSecondaryBarType?.(barType, {
            name: 'Minstrel',
            title: 'Minstrel Controls',
            icon: 'fa-solid fa-music',
            height: 36,
            persistence: 'manual',
            moduleId: MODULE.ID
        });

        blacksmith.registerMenubarTool('minstrel-panel', {
            icon: 'fa-solid fa-music',
            name: 'minstrel-panel',
            title: 'Minstrel',
            tooltip: 'Open Minstrel controls',
            onClick: () => blacksmith.toggleSecondaryBar?.(barType),
            zone: 'middle',
            group: 'utility',
            groupOrder: 30,
            order: 20,
            moduleId: MODULE.ID,
            gmOnly: false,
            leaderOnly: false,
            visible: true,
            toggleable: true,
            active: false,
            iconColor: null,
            buttonNormalTint: null,
            buttonSelectedTint: 'rgba(108, 75, 41, 0.9)'
        });

        if (typeof blacksmith.registerSecondaryBarTool === 'function') {
            blacksmith.registerSecondaryBarTool(barType, 'minstrel-panel');
        }

        const items = [
            {
                id: 'minstrel-open-panel',
                icon: 'fa-solid fa-window-maximize',
                label: 'Panel',
                title: 'Open Minstrel Panel',
                onClick: () => this.openWindow()
            },
            {
                id: 'minstrel-stop-music',
                icon: 'fa-solid fa-circle-stop',
                label: 'Music',
                title: 'Stop Music Layer',
                onClick: async () => {
                    await PlaylistManager.stopLayer('music');
                    this.requestUiRefresh();
                }
            },
            {
                id: 'minstrel-stop-ambient',
                icon: 'fa-solid fa-wind',
                label: 'Ambient',
                title: 'Stop Ambient Layer',
                onClick: async () => {
                    await PlaylistManager.stopLayer('ambient');
                    this.requestUiRefresh();
                }
            },
            {
                id: 'minstrel-stop-all',
                icon: 'fa-solid fa-volume-xmark',
                label: 'All',
                title: 'Stop All Audio',
                onClick: async () => {
                    await PlaylistManager.stopAllAudio();
                    RuntimeManager.setActiveSoundSceneId(null);
                    this.requestUiRefresh();
                }
            },
            {
                id: 'minstrel-restore-audio',
                icon: 'fa-solid fa-rotate-left',
                label: 'Restore',
                title: 'Restore Previous Audio Snapshot',
                onClick: async () => {
                    const snapshot = RuntimeManager.getPreviousSnapshot();
                    if (snapshot) await PlaylistManager.restorePlaybackSnapshot(snapshot);
                    this.requestUiRefresh();
                }
            }
        ];

        for (const item of items) {
            blacksmith.registerSecondaryBarItem?.(barType, item.id, {
                icon: item.icon,
                label: item.label,
                title: item.title,
                order: 10,
                moduleId: MODULE.ID,
                visible: true,
                onClick: item.onClick
            });
        }

        this._menubarRegistered = true;
    },

    openWindow() {
        const existingWindow = RuntimeManager.getState().windowRef;
        if (existingWindow) {
            existingWindow.render(true);
            return existingWindow;
        }

        const windowState = StorageManager.getWindowState();
        const options = {};
        if (windowState.bounds && Object.keys(windowState.bounds).length) {
            options.position = windowState.bounds;
        }

        const windowRef = new MinstrelWindow(options);
        RuntimeManager.setWindowRef(windowRef);
        windowRef.render(true);
        return windowRef;
    },

    requestUiRefresh() {
        const windowRef = RuntimeManager.getState().windowRef;
        if (windowRef) windowRef.render(true);
        const blacksmith = game.modules.get('coffee-pub-blacksmith')?.api;
        blacksmith?.renderMenubar?.(true);
    },

    getDashboardData() {
        const nowPlaying = PlaylistManager.getNowPlaying();
        const favorites = StorageManager.getFavorites();
        const recents = StorageManager.getRecents();
        const cues = CueManager.getCues();
        const soundScenes = SoundSceneManager.getSoundScenes();

        return {
            nowPlaying,
            favorites,
            recents,
            recentCues: RuntimeManager.getRecentCueIds()
                .map((cueId) => cues.find((cue) => cue.id === cueId))
                .filter(Boolean),
            activeSoundScene: soundScenes.find((scene) => scene.id === RuntimeManager.getState().activeSoundSceneId) ?? null
        };
    }
};
