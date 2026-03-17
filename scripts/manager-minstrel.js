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
import { MenuBar } from '/modules/coffee-pub-blacksmith/scripts/api-menubar.js';

export const MinstrelManager = {
    _menubarRegistered: false,
    _windowRegistered: false,
    WINDOW_ID: `${MODULE.ID}-window`,
    CONTROL_BAR_ID: 'minstrel-controls',

    async initialize() {
        this.registerWindowIntegration();
        await AutomationManager.initialize();
        await this.registerMenubarIntegration();
    },

    registerWindowIntegration() {
        if (this._windowRegistered) return;

        const blacksmith = game.modules.get('coffee-pub-blacksmith')?.api;
        if (typeof blacksmith?.registerWindow !== 'function') return;

        blacksmith.registerWindow(this.WINDOW_ID, {
            title: MODULE.TITLE,
            moduleId: MODULE.ID,
            open: (options = {}) => this._openWindowInstance(options)
        });

        this._windowRegistered = true;
    },

    unregisterWindowIntegration() {
        if (!this._windowRegistered) return;

        const blacksmith = game.modules.get('coffee-pub-blacksmith')?.api;
        if (typeof blacksmith?.unregisterWindow === 'function') {
            blacksmith.unregisterWindow(this.WINDOW_ID);
        }

        this._windowRegistered = false;
    },

    async registerMenubarIntegration() {
        if (this._menubarRegistered) return;

        const blacksmith = game.modules.get('coffee-pub-blacksmith')?.api;
        if (!blacksmith?.registerMenubarTool) return;

        blacksmith.registerSecondaryBarType?.(this.CONTROL_BAR_ID, {
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
            onClick: () => blacksmith.toggleSecondaryBar?.(this.CONTROL_BAR_ID),
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

        blacksmith.registerMenubarTool('minstrel-ambience-tool', {
            icon: 'fa-solid fa-music',
            name: 'minstrel-ambience-tool',
            title: 'Ambience',
            tooltip: 'Quick ambience menu',
            onClick: (event) => this.openAmbienceMenu(event),
            zone: 'right',
            group: 'utility',
            groupOrder: 30,
            order: 40,
            moduleId: MODULE.ID,
            gmOnly: false,
            leaderOnly: false,
            visible: true,
            toggleable: false,
            active: false,
            iconColor: null,
            buttonNormalTint: null,
            buttonSelectedTint: 'rgba(108, 75, 41, 0.9)',
            contextMenuItems: () => this.getAmbienceContextMenuItems()
        });

        if (typeof blacksmith.registerSecondaryBarTool === 'function') {
            blacksmith.registerSecondaryBarTool(this.CONTROL_BAR_ID, 'minstrel-panel');
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
            blacksmith.registerSecondaryBarItem?.(this.CONTROL_BAR_ID, item.id, {
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

    openAmbienceMenu(event) {
        const items = this.getAmbienceContextMenuItems();
        if (!items.length) return;

        const x = Number(event?.clientX ?? 0);
        const y = Number(event?.clientY ?? 0);
        MenuBar._showMenubarContextMenu(items, x, y);
    },

    getAmbienceContextMenuItems() {
        const favorites = StorageManager.getFavorites();
        const items = [
            {
                name: 'Panel',
                icon: 'fa-solid fa-window-maximize',
                description: 'Open the full Minstrel panel',
                onClick: () => this.openWindow()
            }
        ];

        if (!favorites.length) {
            items.push({
                name: 'No Favorites Saved',
                icon: 'fa-solid fa-star',
                description: 'Mark tracks as favorites in Minstrel to access them here.',
                onClick: () => {}
            });
            return items;
        }

        favorites.slice(0, 12).forEach((trackRef) => {
            items.push({
                name: trackRef.soundName || 'Favorite Track',
                icon: this.getTrackIcon(trackRef),
                description: trackRef.playlistName || 'Playlist',
                onClick: async () => {
                    await PlaylistManager.playTrack(trackRef, this.getPlaybackOptions(trackRef));
                    this.requestUiRefresh();
                }
            });
        });

        return items;
    },

    getPlaybackOptions(trackRef) {
        if (trackRef?.channel === 'ambient') return { layer: 'ambient', exclusive: false };
        if (trackRef?.channel === 'cue') return { layer: 'cue', exclusive: false };
        return { layer: 'music', exclusive: true };
    },

    getTrackIcon(trackRef) {
        if (trackRef?.channel === 'ambient') return 'fa-solid fa-wind';
        if (trackRef?.channel === 'cue') return 'fa-solid fa-bolt';
        return 'fa-solid fa-music';
    },

    openWindow() {
        const blacksmith = game.modules.get('coffee-pub-blacksmith')?.api;
        if (typeof blacksmith?.openWindow === 'function') {
            return blacksmith.openWindow(this.WINDOW_ID);
        }

        return this._openWindowInstance();
    },

    _openWindowInstance(options = {}) {
        const existingWindow = RuntimeManager.getState().windowRef;
        if (existingWindow) {
            existingWindow.render(true);
            return existingWindow;
        }

        const windowState = StorageManager.getWindowState();
        const windowOptions = foundry.utils.deepClone(options);
        if (windowState.bounds && Object.keys(windowState.bounds).length) {
            windowOptions.position = windowState.bounds;
        }

        const windowRef = new MinstrelWindow(windowOptions);
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
