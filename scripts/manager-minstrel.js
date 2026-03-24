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

function toRgbaString(color, alpha = 1) {
    const normalized = String(color ?? '').trim();
    const hex = normalized.startsWith('#') ? normalized.slice(1) : normalized;
    if (![3, 6].includes(hex.length) || /[^0-9a-f]/i.test(hex)) {
        return `rgba(185, 108, 38, ${alpha})`;
    }

    const expanded = hex.length === 3
        ? hex.split('').map((char) => `${char}${char}`).join('')
        : hex;

    const red = parseInt(expanded.slice(0, 2), 16);
    const green = parseInt(expanded.slice(2, 4), 16);
    const blue = parseInt(expanded.slice(4, 6), 16);
    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

export const MinstrelManager = {
    _menubarRegistered: false,
    _windowRegistered: false,
    _cacheHookRefs: [],
    _dashboardCache: null,
    WINDOW_ID: `${MODULE.ID}-window`,
    CONTROL_BAR_ID: 'minstrel-controls',
    MENUBAR_TOOL_IDS: ['minstrel-panel', 'minstrel-sound-tool'],
    SECONDARY_BAR_ITEM_IDS: [
        'minstrel-active-scene',
        'minstrel-now-playing',
        'minstrel-open-dashboard',
        'minstrel-open-scenes',
        'minstrel-open-playlists',
        'minstrel-open-cues',
        'minstrel-open-automation',
        'minstrel-stop-scene',
        'minstrel-stop-music',
        'minstrel-stop-ambient',
        'minstrel-stop-all',
        'minstrel-restore-audio'
    ],

    async initialize() {
        this.registerWindowIntegration();
        this.registerCacheInvalidationHooks();
        if (!game.user?.isGM) {
            PlaylistManager.syncRuntimeLayers();
            this.requestUiRefresh({ refreshWindow: false, invalidateDashboard: false });
            return;
        }
        await AutomationManager.initialize();
        await this.registerMenubarIntegration();
        PlaylistManager.syncRuntimeLayers();
        await this.syncActiveSceneFromPlayback();
        this.requestUiRefresh();
    },

    async shutdown() {
        const windowRef = RuntimeManager.getState().windowRef;
        if (windowRef?.close) {
            await windowRef.close();
        }
        AutomationManager.shutdown();
        this.unregisterCacheInvalidationHooks();
        this.unregisterMenubarIntegration();
        this.unregisterWindowIntegration();
        this._dashboardCache = null;
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

    registerCacheInvalidationHooks() {
        if (this._cacheHookRefs.length) return;

        const hookNames = [
            'createPlaylist',
            'updatePlaylist',
            'deletePlaylist',
            'createPlaylistSound',
            'updatePlaylistSound',
            'deletePlaylistSound'
        ];

        this._cacheHookRefs = hookNames.map((name) => ({
            name,
            id: Hooks.on(name, () => {
                this.invalidateDerivedData();
            })
        }));
    },

    unregisterCacheInvalidationHooks() {
        for (const hookRef of this._cacheHookRefs) {
            Hooks.off(hookRef.name, hookRef.id);
        }
        this._cacheHookRefs = [];
    },

    invalidateDerivedData() {
        this._dashboardCache = null;
        PlaylistManager.invalidateCache();
        CueManager.invalidateCache?.();
        SoundSceneManager.invalidateCache?.();
    },

    async syncActiveSceneFromPlayback() {
        if (!game.user?.isGM) return null;
        const soundScenes = SoundSceneManager.getSoundScenes();
        const activeTracks = PlaylistManager.getNowPlaying()?.activeTracks ?? [];
        const sceneIds = new Set(soundScenes.map((scene) => String(scene.id)));
        const scenePlaybackCounts = new Map();

        for (const track of activeTracks) {
            const playlistId = String(track?.playlistId ?? '');
            if (!sceneIds.has(playlistId)) continue;
            scenePlaybackCounts.set(playlistId, (scenePlaybackCounts.get(playlistId) ?? 0) + 1);
        }

        const inferredSceneId = Array.from(scenePlaybackCounts.entries())
            .sort((a, b) => b[1] - a[1])
            .map(([sceneId]) => sceneId)[0] ?? null;

        if (inferredSceneId) {
            clearTimeout(this._sceneNormalizationTimeoutId);
            this._sceneNormalizationTimeoutId = window.setTimeout(async () => {
                await PlaylistManager.stopPlaylist(inferredSceneId);
                await SoundSceneManager.activateSoundScene(inferredSceneId, { savePrevious: false });
                this.requestUiRefresh();
            }, 0);
            return inferredSceneId;
        }

        const hasMinstrelSceneActivity = !!RuntimeManager.getSceneClock()
            || !!RuntimeManager.getMusicSequenceHandle()
            || RuntimeManager.getScheduledLayerHandles().length > 0;
        if (!hasMinstrelSceneActivity) {
            RuntimeManager.setActiveSoundSceneId(null);
            RuntimeManager.clearSceneClock();
        }
        return null;
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
            moduleId: MODULE.ID,
            groups: {
                session: { order: 10 },
                navigation: { order: 20 },
                transport: { order: 40 }
            }
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
            gmOnly: true,
            leaderOnly: false,
            visible: true,
            toggleable: true,
            active: false,
            iconColor: null,
            buttonNormalTint: null,
            buttonSelectedTint: 'rgba(108, 75, 41, 0.9)'
        });

        blacksmith.registerMenubarTool('minstrel-sound-tool', {
            icon: 'fa-solid fa-music',
            name: 'minstrel-sound-tool',
            title: () => this.getMenubarSoundLabel(),
            tooltip: 'Favorite environment sounds and Minstrel actions',
            onClick: (event) => this.openSoundMenu(event),
            zone: 'right',
            group: 'utility',
            groupOrder: 30,
            order: 40,
            moduleId: MODULE.ID,
            gmOnly: true,
            leaderOnly: false,
            visible: true,
            toggleable: false,
            active: false,
            iconColor: null,
            buttonNormalTint: null,
            buttonSelectedTint: 'rgba(108, 75, 41, 0.9)',
            contextMenuItems: () => this.getSoundContextMenuItems()
        });

        if (typeof blacksmith.registerSecondaryBarTool === 'function') {
            blacksmith.registerSecondaryBarTool(this.CONTROL_BAR_ID, 'minstrel-panel');
        }

        const items = [
            {
                id: 'minstrel-active-scene',
                kind: 'info',
                zone: 'left',
                group: 'session',
                order: 10,
                icon: 'fa-solid fa-clapperboard-play',
                label: 'Scene',
                value: 'None',
                title: 'Active sound scene'
            },
            {
                id: 'minstrel-now-playing',
                kind: 'info',
                zone: 'left',
                group: 'session',
                order: 20,
                icon: 'fa-solid fa-waveform-lines',
                label: 'Now Playing',
                value: 'Idle',
                title: 'Current track or scene audio'
            },
            {
                id: 'minstrel-open-dashboard',
                icon: 'fa-solid fa-wave-square',
                label: 'Dashboard',
                title: 'Open Dashboard',
                zone: 'middle',
                group: 'navigation',
                order: 10,
                onClick: () => this.openWindowToTab('dashboard')
            },
            {
                id: 'minstrel-open-scenes',
                icon: 'fa-solid fa-clapperboard-play',
                label: 'Scenes',
                title: 'Open Scenes',
                zone: 'middle',
                group: 'navigation',
                order: 20,
                onClick: () => this.openWindowToTab('soundScenes'),
                contextMenuItems: () => this.getSceneSubmenuItems()
            },
            {
                id: 'minstrel-open-playlists',
                icon: 'fa-solid fa-list-music',
                label: 'Playlists',
                title: 'Open Playlists',
                zone: 'middle',
                group: 'navigation',
                order: 30,
                onClick: () => this.openWindowToTab('playlists'),
                contextMenuItems: () => this.getEnvironmentSubmenuItems()
            },
            {
                id: 'minstrel-open-cues',
                icon: 'fa-solid fa-bolt',
                label: 'Cues',
                title: 'Open Cues',
                zone: 'middle',
                group: 'navigation',
                order: 40,
                onClick: () => this.openWindowToTab('cues'),
                contextMenuItems: () => this.getOneShotSubmenuItems()
            },
            {
                id: 'minstrel-open-automation',
                icon: 'fa-solid fa-diagram-project',
                label: 'Automation',
                title: 'Open Automation',
                zone: 'middle',
                group: 'navigation',
                order: 50,
                onClick: () => this.openWindowToTab('automation')
            },
            {
                id: 'minstrel-stop-scene',
                icon: 'fa-solid fa-octagon-xmark',
                label: 'Stop Scene',
                title: 'Stop Active Sound Scene',
                zone: 'right',
                group: 'transport',
                order: 40,
                onClick: async () => {
                    await SoundSceneManager.stopActiveSoundScene();
                    this.requestUiRefresh();
                }
            },
            {
                id: 'minstrel-stop-music',
                icon: 'fa-solid fa-circle-stop',
                label: 'Music',
                title: 'Stop Music Layer',
                zone: 'right',
                group: 'transport',
                order: 50,
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
                zone: 'right',
                group: 'transport',
                order: 60,
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
                zone: 'right',
                group: 'transport',
                order: 70,
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
                zone: 'right',
                group: 'transport',
                order: 80,
                onClick: async () => {
                    const snapshot = RuntimeManager.getPreviousSnapshot();
                    if (snapshot) await PlaylistManager.restorePlaybackSnapshot(snapshot);
                    this.requestUiRefresh();
                }
            }
        ];

        for (const item of items) {
            blacksmith.registerSecondaryBarItem?.(this.CONTROL_BAR_ID, item.id, {
                kind: item.kind ?? 'button',
                icon: item.icon,
                label: item.label,
                value: item.value,
                title: item.title,
                zone: item.zone ?? 'middle',
                group: item.group ?? 'default',
                order: item.order ?? 10,
                moduleId: MODULE.ID,
                visible: true,
                onClick: item.onClick,
                contextMenuItems: item.contextMenuItems
            });
        }

        this.refreshSecondaryBarState();
        this._menubarRegistered = true;
    },

    unregisterMenubarIntegration() {
        if (!this._menubarRegistered) return;

        const blacksmith = game.modules.get('coffee-pub-blacksmith')?.api;
        blacksmith?.closeSecondaryBar?.(this.CONTROL_BAR_ID);

        for (const itemId of this.SECONDARY_BAR_ITEM_IDS) {
            blacksmith?.unregisterSecondaryBarItem?.(this.CONTROL_BAR_ID, itemId);
        }

        for (const toolId of this.MENUBAR_TOOL_IDS) {
            blacksmith?.unregisterMenubarTool?.(toolId);
        }

        this._menubarRegistered = false;
    },

    openSoundMenu(event) {
        this.openContextMenu(event, this.getSoundContextMenuItems());
    },

    getMenubarSoundLabel() {
        const dashboard = this.getDashboardData();
        const label = String(
            dashboard.activeSoundScene?.name
            ?? dashboard.nowPlaying.music?.soundName
            ?? dashboard.nowPlaying.ambientTracks?.[0]?.soundName
            ?? dashboard.nowPlaying.activeTracks?.[0]?.trackRef?.soundName
            ?? ''
        ).trim();
        if (!label) return 'Sounds';
        return label.length > 20 ? `${label.slice(0, 17)}...` : label;
    },

    openContextMenu(event, items = []) {
        if (!items.length) return;
        const x = Number(event?.clientX ?? 0);
        const y = Number(event?.clientY ?? 0);
        const blacksmith = game.modules.get('coffee-pub-blacksmith')?.api;
        blacksmith?.showMenubarContextMenu?.(items, x, y);
    },

    getSoundContextMenuItems() {
        const favorites = StorageManager.getFavorites().filter((trackRef) => trackRef?.channel === 'ambient');
        const items = [
            {
                name: 'Stop All',
                icon: 'fa-solid fa-volume-xmark',
                description: 'Stop all Minstrel audio',
                onClick: async () => {
                    await PlaylistManager.stopAllAudio();
                    RuntimeManager.setActiveSoundSceneId(null);
                    this.requestUiRefresh();
                }
            },
            {
                name: 'Scenes',
                icon: 'fa-solid fa-clapperboard-play',
                description: 'Favorite sound scenes',
                submenu: this.getSceneSubmenuItems()
            },
            {
                name: 'Playlists',
                icon: 'fa-solid fa-list-music',
                description: 'Favorite environment tracks',
                submenu: this.getPlaylistSubmenuItems()
            },
            {
                name: 'One-Shots',
                icon: 'fa-solid fa-bolt',
                description: 'Favorite one-shots',
                submenu: this.getOneShotSubmenuItems()
            },
            {
                name: 'Environments',
                icon: 'fa-solid fa-wind',
                description: 'Favorite environment tracks',
                submenu: this.getEnvironmentSubmenuItems(favorites)
            }
        ];

        return items;
    },

    getEnvironmentSubmenuItems(favorites = StorageManager.getFavorites().filter((trackRef) => trackRef?.channel === 'ambient')) {
        const items = [];

        if (!favorites.length) {
            items.push({
                name: 'No Favorite Environment',
                icon: 'fa-solid fa-wind',
                description: 'Mark environment tracks as favorites in Minstrel to access them here.',
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

    getSceneSubmenuItems() {
        const scenes = SoundSceneManager.getSoundScenes().filter((scene) => scene.favorite);
        const items = [];

        if (!scenes.length) {
            items.push({
                name: 'No Favorite Scenes',
                icon: 'fa-solid fa-clapperboard-play',
                description: 'Mark scenes as favorites in Minstrel to access them here.',
                onClick: () => {}
            });
            return items;
        }

        scenes.slice(0, 12).forEach((scene) => {
            items.push({
                name: scene.name,
                icon: 'fa-solid fa-clapperboard-play',
                description: scene.description || `${scene.layers?.length ?? 0} tracks`,
                onClick: async () => {
                    await SoundSceneManager.activateSoundScene(scene.id);
                    this.requestUiRefresh();
                }
            });
        });

        return items;
    },

    getPlaylistSubmenuItems() {
        const playlists = StorageManager.getFavoritePlaylists();
        const items = [];

        if (!playlists.length) {
            items.push({
                name: 'No Favorite Playlists',
                icon: 'fa-solid fa-list-music',
                description: 'Favorite playlists in Minstrel to access them here.',
                onClick: () => {}
            });
            return items;
        }

        playlists.slice(0, 12).forEach((playlist) => {
            items.push({
                name: playlist.playlistName || 'Favorite Playlist',
                icon: 'fa-solid fa-list-music',
                description: 'Open in Playlists tab',
                onClick: async () => {
                    await this.openPlaylistByName(playlist.playlistName);
                }
            });
        });

        return items;
    },

    getOneShotSubmenuItems() {
        const cues = CueManager.getCues().filter((cue) => cue.favorite);
        const items = [];

        if (!cues.length) {
            items.push({
                name: 'No Favorite One-Shots',
                icon: 'fa-solid fa-bolt',
                description: 'Mark one-shots as favorites in Minstrel to access them here.',
                onClick: () => {}
            });
            return items;
        }

        cues.slice(0, 12).forEach((cue) => {
            items.push({
                name: cue.name,
                icon: cue.icon || 'fa-solid fa-bolt',
                description: cue.category || 'Cue',
                onClick: async () => {
                    await CueManager.triggerCue(cue.id);
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

    async openWindowToTab(tabId) {
        const windowRef = this.openWindow();
        if (!windowRef) return null;
        if (typeof windowRef.selectTab === 'function') {
            await windowRef.selectTab(tabId);
        }
        return windowRef;
    },

    async openPlaylistByName(playlistName) {
        const windowRef = await this.openWindowToTab('playlists');
        if (!windowRef) return null;
        if (typeof windowRef.setPlaylistFilters === 'function') {
            await windowRef.setPlaylistFilters({
                playlistSearch: String(playlistName ?? ''),
                playlistChannelFilter: 'all',
                playlistStatusFilter: 'all'
            });
        }
        return windowRef;
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

    requestUiRefresh({ refreshWindow = true, refreshMenubar = true, invalidateDashboard = true } = {}) {
        if (invalidateDashboard) {
            this._dashboardCache = null;
        }
        const windowRef = RuntimeManager.getState().windowRef;
        if (refreshWindow && windowRef?.refreshPreservingUi) {
            void windowRef.refreshPreservingUi();
        } else if (refreshWindow && windowRef) {
            windowRef.render(true);
        }
        const blacksmith = game.modules.get('coffee-pub-blacksmith')?.api;
        if (refreshMenubar) {
            this.refreshSecondaryBarState();
            blacksmith?.renderMenubar?.(true);
        }
    },

    refreshSecondaryBarState() {
        const blacksmith = game.modules.get('coffee-pub-blacksmith')?.api;
        if (!blacksmith?.updateSecondaryBarItemInfo) return;

        const dashboard = this.getDashboardData();
        const activeScene = dashboard.activeSoundScene;
        const primaryTrack = dashboard.nowPlaying.music
            ?? dashboard.nowPlaying.ambientTracks?.[0]
            ?? dashboard.nowPlaying.activeTracks?.[0]?.trackRef
            ?? null;
        const activeSceneLabel = String(activeScene?.name ?? 'None').trim() || 'None';
        const trackLabel = String(primaryTrack?.soundName ?? 'Idle').trim() || 'Idle';
        const sceneMeta = activeScene
            ? `${activeScene.layers?.length ?? 0} tracks`
            : 'No active sound scene';
        const trackMeta = primaryTrack?.playlistName
            ?? primaryTrack?.channel
            ?? 'No active audio';

        blacksmith.updateSecondaryBarItemInfo(this.CONTROL_BAR_ID, 'minstrel-active-scene', {
            label: 'Scene',
            value: activeSceneLabel,
            title: sceneMeta
        });
        blacksmith.updateSecondaryBarItemInfo(this.CONTROL_BAR_ID, 'minstrel-now-playing', {
            label: 'Now Playing',
            value: trackLabel,
            title: trackMeta
        });
    },

    getDashboardData() {
        if (!this._dashboardCache) {
            const nowPlaying = PlaylistManager.getNowPlaying();
            const cues = CueManager.getCues();
            const soundScenes = SoundSceneManager.getSoundScenes();
            const activeSoundSceneId = RuntimeManager.getState().activeSoundSceneId;
            const activeCueTracks = (nowPlaying.activeTracks ?? []).filter((track) => track?.trackRef?.channel === 'cue');

            this._dashboardCache = {
                nowPlaying,
                favoriteCues: cues
                    .filter((cue) => cue.favorite)
                    .map((cue) => ({
                        ...cue,
                        cardStyle: `--cue-tint:${cue.tintColor ?? '#b96c26'}; --cue-tint-soft:${toRgbaString(cue.tintColor ?? '#b96c26', 0.18)};`
                    })),
                favoriteScenes: soundScenes
                    .filter((scene) => scene.favorite)
                    .map((scene) => ({
                        ...scene,
                        isActive: scene.id === activeSoundSceneId
                    })),
                activeSoundScene: soundScenes.find((scene) => scene.id === activeSoundSceneId) ?? null,
                sessionStatus: {
                    music: nowPlaying.music ?? null,
                    environment: nowPlaying.ambientTracks ?? [],
                    oneShots: activeCueTracks
                }
            };
        }

        return this._dashboardCache;
    }
};
