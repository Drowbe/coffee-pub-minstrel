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

/**
 * Trailing debounce for the document-hook cache invalidation. Foundry emits a burst of
 * `updatePlaylistSound` events during playback/fades; collapsing the burst into a single
 * cache flush avoids repeatedly nuking (and then rebuilding) the derived-data caches.
 * The max-wait ceiling guarantees invalidation still lands during a continuous stream.
 */
const DERIVED_INVALIDATION_DEBOUNCE_MS = 120;
const DERIVED_INVALIDATION_MAX_WAIT_MS = 480;

export const MinstrelManager = {
    _menubarRegistered: false,
    _toolbarRegistered: false,
    _windowRegistered: false,
    _cacheHookRefs: [],
    _dashboardCache: null,
    _pendingUiRefresh: null,
    _uiRefreshScheduled: false,
    _uiRefreshCancel: null,
    _derivedInvalidationTimer: null,
    _derivedInvalidationFirstQueuedAt: null,
    /** Render accounting for manual verification; exposed on the module object as `minstrelDebug`. */
    _playbackRefreshStats: { bodyRenders: 0, bodyRendersSkipped: 0, fullRenders: 0 },
    WINDOW_ID: `${MODULE.ID}-window`,
    CONTROL_BAR_ID: 'minstrel-controls',
    TOOLBAR_TOOL_ID: 'minstrel-toolbar',
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
        'minstrel-stop-oneshots',
        'minstrel-stop-all',
        'minstrel-restart-last-scene'
    ],

    /** Removed menubar items still unregistered on shutdown so upgrades do not leave stale controls. */
    _legacySecondaryBarItemIds: ['minstrel-restore-audio'],

    async initialize() {
        if (!game.user?.isGM) {
            return;
        }
        this.registerWindowIntegration();
        this.registerCacheInvalidationHooks();
        StorageManager.registerSettingsMemoInvalidation();
        this.exposeDebugHandle();

        /**
         * Register ALL UI integrations before automation. Automation's scene-start catch-up can
         * activate a sound scene, and playback awaits `game.audio.unlock` — which only resolves
         * on the first user gesture. With automation first, the whole init chain (including the
         * menubar registration) sat parked until the user clicked, so Minstrel's menubar items
         * did not appear until the first interaction with the client.
         */
        await this.registerMenubarIntegration();
        await this.registerToolbarIntegration();
        SoundSceneManager.registerPlaybackChromeRefreshHandler(() => {
            this.requestUiRefresh({ windowRefreshDepth: 'playback', invalidateDashboard: false });
        });
        PlaylistManager.syncRuntimeLayers();
        this.requestUiRefresh();

        await AutomationManager.initialize();
        await this.syncActiveSceneFromPlayback();
        this.requestUiRefresh();
    },

    async shutdown() {
        if (this._sceneNormalizationTimeoutId != null) {
            window.clearTimeout(this._sceneNormalizationTimeoutId);
            this._sceneNormalizationTimeoutId = null;
        }
        RuntimeManager.clearModuleDeferredTimeouts();
        RuntimeManager.clearScheduledLayerFollowupTimeouts();
        RuntimeManager.clearMenubarRenderDebounce();
        PlaylistManager.clearDurationCache();

        if (this._uiRefreshCancel) {
            this._uiRefreshCancel();
            this._uiRefreshCancel = null;
        }
        this._uiRefreshScheduled = false;
        this._pendingUiRefresh = null;
        this._clearDerivedDataInvalidationTimer();
        await StorageManager.flushPendingSettingWrites();
        StorageManager.unregisterSettingsMemoInvalidation();

        const windowRef = RuntimeManager.getState().windowRef;
        if (windowRef?.close) {
            await windowRef.close();
        }
        AutomationManager.shutdown();
        SoundSceneManager.registerPlaybackChromeRefreshHandler(null);
        this.unregisterCacheInvalidationHooks();
        this.unregisterMenubarIntegration();
        this.unregisterToolbarIntegration();
        this.unregisterWindowIntegration();
        this.removeDebugHandle();
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

    /**
     * GM-only diagnostics on `game.modules.get('coffee-pub-minstrel').minstrelDebug`. ES modules are
     * not reachable from the console, and the render counters are only useful if they can be read
     * there while a scene plays. Read-only accessors — nothing here drives module behaviour.
     */
    exposeDebugHandle() {
        const moduleRef = game.modules.get(MODULE.ID);
        if (!moduleRef) return;
        moduleRef.minstrelDebug = {
            renderStats: this._playbackRefreshStats,
            playbackSignature: () => this.getPlaybackBodySignature(),
            renderedPlaybackSignature: () => RuntimeManager.getState().windowRef?.getRenderedPlaybackSignature?.() ?? null,
            resetRenderStats: () => {
                this._playbackRefreshStats.bodyRenders = 0;
                this._playbackRefreshStats.bodyRendersSkipped = 0;
                this._playbackRefreshStats.fullRenders = 0;
                return this._playbackRefreshStats;
            }
        };
    },

    removeDebugHandle() {
        const moduleRef = game.modules.get(MODULE.ID);
        if (moduleRef?.minstrelDebug) delete moduleRef.minstrelDebug;
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
                this._scheduleDerivedDataInvalidation();
            })
        }));
    },

    unregisterCacheInvalidationHooks() {
        for (const hookRef of this._cacheHookRefs) {
            Hooks.off(hookRef.name, hookRef.id);
        }
        this._cacheHookRefs = [];
        this._clearDerivedDataInvalidationTimer();
    },

    /**
     * Debounced entry point for the document-mutation hooks. Every internal write path already
     * invalidates its own caches synchronously, so these hooks are a redundant net for our own
     * actions and the primary path only for external/socket-driven document changes — neither of
     * which needs the immediate, per-event flush the raw hook produced. Collapsing bursts keeps a
     * fade (which fires many `updatePlaylistSound` events) from repeatedly clearing and rebuilding
     * the derived-data caches.
     */
    _scheduleDerivedDataInvalidation() {
        const now = Date.now();
        if (this._derivedInvalidationFirstQueuedAt == null) {
            this._derivedInvalidationFirstQueuedAt = now;
        }
        if (this._derivedInvalidationTimer != null) {
            window.clearTimeout(this._derivedInvalidationTimer);
        }
        const elapsed = now - this._derivedInvalidationFirstQueuedAt;
        const remainingMaxWait = Math.max(0, DERIVED_INVALIDATION_MAX_WAIT_MS - elapsed);
        const delay = Math.min(DERIVED_INVALIDATION_DEBOUNCE_MS, remainingMaxWait);
        this._derivedInvalidationTimer = window.setTimeout(() => {
            this._derivedInvalidationTimer = null;
            this._derivedInvalidationFirstQueuedAt = null;
            this.invalidateDerivedData();
        }, delay);
    },

    _clearDerivedDataInvalidationTimer() {
        if (this._derivedInvalidationTimer != null) {
            window.clearTimeout(this._derivedInvalidationTimer);
            this._derivedInvalidationTimer = null;
        }
        this._derivedInvalidationFirstQueuedAt = null;
    },

    invalidateDerivedData() {
        this._dashboardCache = null;
        PlaylistManager.invalidateCache();
        CueManager.invalidateCache?.();
        SoundSceneManager.invalidateCache?.();
    },

    // ---- Shared stop actions (window action bar, menubar, and context menu) ----
    // Each performs the stop, gives toast feedback, and refreshes the UI. Automation and other
    // programmatic callers use the SoundSceneManager methods directly (no toast).

    async stopAllAudioFromUi() {
        // Tear down the active scene first (cancels one-shot timers and the music-sequence
        // restart timer), then sweep any remaining audio (cues, manually played tracks).
        await SoundSceneManager.stopActiveSoundScene();
        await PlaylistManager.stopAllAudio();
        ui.notifications?.info?.('Minstrel: Stopped all audio.');
        this.requestUiRefresh();
    },

    async stopSceneFromUi() {
        const activeScene = SoundSceneManager.getSoundScene(RuntimeManager.getState().activeSoundSceneId);
        await SoundSceneManager.stopActiveSoundScene();
        ui.notifications?.info?.(activeScene
            ? `Minstrel: Stopped sound scene "${activeScene.name}".`
            : 'Minstrel: No active sound scene to stop.');
        this.requestUiRefresh();
    },

    async stopMusicFromUi() {
        await SoundSceneManager.stopMusicPlayback();
        ui.notifications?.info?.('Minstrel: Stopped music.');
        this.requestUiRefresh({ windowRefreshDepth: 'playback', invalidateDashboard: false });
    },

    async stopEnvironmentFromUi() {
        await SoundSceneManager.stopEnvironmentPlayback();
        ui.notifications?.info?.('Minstrel: Stopped environment audio.');
        this.requestUiRefresh({ windowRefreshDepth: 'playback', invalidateDashboard: false });
    },

    async stopOneShotsFromUi() {
        await SoundSceneManager.stopOneShotPlayback();
        ui.notifications?.info?.('Minstrel: Stopped one-shot audio.');
        this.requestUiRefresh({ windowRefreshDepth: 'playback', invalidateDashboard: false });
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
            window.clearTimeout(this._sceneNormalizationTimeoutId);
            this._sceneNormalizationTimeoutId = window.setTimeout(async () => {
                this._sceneNormalizationTimeoutId = null;
                try {
                    // stopPlaylist updates PlaylistSound docs, which core rejects while audio
                    // is locked (this timeout fires during init, before the first gesture).
                    await PlaylistManager.waitForAudioUnlock();
                    await PlaylistManager.stopPlaylist(inferredSceneId);
                    await SoundSceneManager.activateSoundScene(inferredSceneId, { savePrevious: false });
                } catch (error) {
                    console.error(`${MODULE.TITLE ?? 'Minstrel'}: scene playback normalization failed`, error);
                }
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

        for (const itemId of this._legacySecondaryBarItemIds) {
            blacksmith.unregisterSecondaryBarItem?.(this.CONTROL_BAR_ID, itemId);
        }

        blacksmith.registerSecondaryBarType?.(this.CONTROL_BAR_ID, {
            name: 'Minstrel',
            title: 'Minstrel Controls',
            icon: 'fa-solid fa-clapperboard-play',
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
            icon: 'fa-solid fa-clapperboard-play',
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
            icon: 'fa-solid fa-clapperboard-play',
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
                label: 'Sound Scene:',
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
                label: 'Now Playing:',
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
                label: 'Sound Scenes',
                title: 'Open Sound Scenes',
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
                onClick: () => this.openWindowToTab('automation'),
                contextMenuItems: () => this.getAutomationSubmenuItems()
            },
            {
                id: 'minstrel-stop-scene',
                icon: 'fa-solid fa-octagon-xmark',
                label: 'Stop Scene',
                title: 'Stop Active Sound Scene',
                zone: 'right',
                group: 'transport',
                order: 40,
                onClick: () => this.stopSceneFromUi()
            },
            {
                id: 'minstrel-stop-music',
                icon: 'fa-solid fa-circle-stop',
                label: 'Stop Music',
                title: 'Stop the music layer only',
                zone: 'right',
                group: 'transport',
                order: 50,
                onClick: () => this.stopMusicFromUi()
            },
            {
                id: 'minstrel-stop-ambient',
                icon: 'fa-solid fa-wind',
                label: 'Stop Environment',
                title: 'Stop environment (ambient) audio only',
                zone: 'right',
                group: 'transport',
                order: 60,
                onClick: () => this.stopEnvironmentFromUi()
            },
            {
                id: 'minstrel-stop-oneshots',
                icon: 'fa-solid fa-bolt-slash',
                label: 'Stop One-Shots',
                title: 'Stop one-shot / interface audio and cancel scheduled one-shot timers',
                zone: 'right',
                group: 'transport',
                order: 65,
                onClick: () => this.stopOneShotsFromUi()
            },
            {
                id: 'minstrel-stop-all',
                icon: 'fa-solid fa-volume-xmark',
                label: 'Stop All',
                title: 'Stop all playlist audio and clear the active sound scene',
                zone: 'right',
                group: 'transport',
                order: 70,
                onClick: () => this.stopAllAudioFromUi()
            },
            {
                id: 'minstrel-restart-last-scene',
                icon: 'fa-solid fa-arrow-rotate-right',
                label: 'Restart Last Scene',
                title: 'Start the most recently activated sound scene again from the beginning (useful after Stop)',
                zone: 'right',
                group: 'transport',
                order: 80,
                onClick: async () => {
                    await SoundSceneManager.restartLastSoundScene();
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

    async registerToolbarIntegration() {
        if (this._toolbarRegistered) return;

        const blacksmith = game.modules.get('coffee-pub-blacksmith')?.api;
        if (!blacksmith?.registerToolbarTool) return;

        const registered = blacksmith.registerToolbarTool(this.TOOLBAR_TOOL_ID, {
            icon: 'fa-solid fa-wave-square',
            name: this.TOOLBAR_TOOL_ID,
            title: 'Minstrel Audio Workbench',
            button: true,
            visible: true,
            zone: 'general',
            order: 40,
            moduleId: MODULE.ID,
            gmOnly: true,
            leaderOnly: false,
            onCoffeePub: true,
            onFoundry: true,
            onClick: () => this.openWindowToTab('dashboard')
        });

        this._toolbarRegistered = !!registered;
    },

    unregisterMenubarIntegration() {
        if (!this._menubarRegistered) return;

        const blacksmith = game.modules.get('coffee-pub-blacksmith')?.api;
        blacksmith?.closeSecondaryBar?.(this.CONTROL_BAR_ID);

        for (const itemId of [...this.SECONDARY_BAR_ITEM_IDS, ...this._legacySecondaryBarItemIds]) {
            blacksmith?.unregisterSecondaryBarItem?.(this.CONTROL_BAR_ID, itemId);
        }

        for (const toolId of this.MENUBAR_TOOL_IDS) {
            blacksmith?.unregisterMenubarTool?.(toolId);
        }

        this._menubarRegistered = false;
    },

    unregisterToolbarIntegration() {
        if (!this._toolbarRegistered) return;

        const blacksmith = game.modules.get('coffee-pub-blacksmith')?.api;
        blacksmith?.unregisterToolbarTool?.(this.TOOLBAR_TOOL_ID);
        this._toolbarRegistered = false;
    },

    openSoundMenu(event) {
        this.openContextMenu(event, this.getSoundContextMenuItems());
    },

    getMenubarSoundLabel() {
        const { nowPlaying, activeSoundScene } = this.getHeaderPlaybackContext();
        const label = String(
            activeSoundScene?.name
            ?? nowPlaying.music?.soundName
            ?? nowPlaying.ambientTracks?.[0]?.soundName
            ?? nowPlaying.activeTracks?.[0]?.trackRef?.soundName
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
        const favorites = PlaylistManager.getFavoriteTracks({ channel: 'ambient' }).map((track) => track.trackRef);
        const items = [
            {
                name: 'Stop All',
                icon: 'fa-solid fa-volume-xmark',
                description: 'Stop all playlist audio and clear the active sound scene',
                onClick: () => this.stopAllAudioFromUi()
            },
            {
                name: 'Stop Scene',
                icon: 'fa-solid fa-octagon-xmark',
                description: 'Stop the active sound scene',
                onClick: () => this.stopSceneFromUi()
            },
            {
                name: 'Stop Music',
                icon: 'fa-solid fa-circle-stop',
                description: 'Stop the music layer only',
                onClick: () => this.stopMusicFromUi()
            },
            {
                name: 'Stop Environment',
                icon: 'fa-solid fa-wind',
                description: 'Stop environment (ambient) audio only',
                onClick: () => this.stopEnvironmentFromUi()
            },
            {
                name: 'Stop One-Shots',
                icon: 'fa-solid fa-bolt-slash',
                description: 'Stop one-shot / interface audio only',
                onClick: () => this.stopOneShotsFromUi()
            },
            {
                name: 'Restart Last Scene',
                icon: 'fa-solid fa-arrow-rotate-right',
                description: 'Start the most recently activated sound scene again from the beginning',
                onClick: async () => {
                    await SoundSceneManager.restartLastSoundScene();
                    this.requestUiRefresh();
                }
            },
            {
                name: 'Sound Scenes',
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
            },
            {
                name: 'Automations',
                icon: 'fa-solid fa-diagram-project',
                description: 'Run favorite automation rules (conditions must pass)',
                submenu: this.getAutomationSubmenuItems()
            }
        ];

        return items;
    },

    getAutomationSubmenuItems() {
        const rules = AutomationManager.getRules().filter((rule) => rule.favorite);
        const items = [];

        if (!rules.length) {
            items.push({
                name: 'No Favorite Automations',
                icon: 'fa-solid fa-diagram-project',
                description: 'Favorite automation rules in Minstrel to run them from here.',
                onClick: () => {}
            });
            return items;
        }

        rules.slice(0, 12).forEach((rule) => {
            const icon = String(rule.icon ?? '').trim().startsWith('fa-') ? rule.icon : 'fa-solid fa-diagram-project';
            items.push({
                name: rule.name || 'Automation Rule',
                icon,
                description: rule.category || 'Run if conditions pass',
                onClick: async () => {
                    await AutomationManager.runRuleFromQuickMenu(rule.id);
                    this.requestUiRefresh();
                }
            });
        });

        return items;
    },

    getEnvironmentSubmenuItems(favorites = PlaylistManager.getFavoriteTracks({ channel: 'ambient' }).map((track) => track.trackRef)) {
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
                    this.requestUiRefresh({ windowRefreshDepth: 'playback', invalidateDashboard: false });
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
                name: 'No Favorite Sound Scenes',
                icon: 'fa-solid fa-clapperboard-play',
                description: 'Mark sound scenes as favorites in Minstrel to access them here.',
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
        const playlists = PlaylistManager.getFavoritePlaylists();
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
                name: playlist.name || 'Favorite Playlist',
                icon: 'fa-solid fa-list-music',
                description: 'Open in Playlists tab',
                onClick: async () => {
                    await this.openPlaylistByName(playlist.name);
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
                    this.requestUiRefresh({ windowRefreshDepth: 'playback', invalidateDashboard: false });
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
        if (!game.user?.isGM) {
            ui.notifications.warn(game.i18n.localize(`${MODULE.ID}.gmOnlyNotification`));
            return null;
        }
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
        if (!game.user?.isGM) {
            return null;
        }
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

    /**
     * Request a UI refresh. A single user action frequently calls this several times (directly and
     * through helpers); rather than re-rendering the whole window on each call, requests are
     * accumulated and flushed once on the next animation frame. This turns a burst of N full
     * re-renders into one. The dashboard-cache invalidation is applied synchronously so the coalesced
     * flush always rebuilds from fresh data. Across requests, `full` depth dominates `playback`, and
     * the window/menubar flags are OR-ed together.
     */
    requestUiRefresh({
        refreshWindow = true,
        refreshMenubar = true,
        invalidateDashboard = true,
        windowRefreshDepth = 'full'
    } = {}) {
        if (!game.user?.isGM) {
            return;
        }
        if (invalidateDashboard) {
            this._dashboardCache = null;
        }

        const pending = this._pendingUiRefresh ?? (this._pendingUiRefresh = {
            refreshWindow: false,
            refreshMenubar: false,
            windowRefreshDepth: 'playback'
        });
        pending.refreshWindow = pending.refreshWindow || refreshWindow;
        pending.refreshMenubar = pending.refreshMenubar || refreshMenubar;
        if (windowRefreshDepth === 'full') {
            pending.windowRefreshDepth = 'full';
        }

        this._scheduleUiRefreshFlush();
    },

    _scheduleUiRefreshFlush() {
        if (this._uiRefreshScheduled) {
            return;
        }
        this._uiRefreshScheduled = true;
        let rafId = null;
        let timeoutId = null;
        const cancelPending = () => {
            if (rafId != null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(rafId);
            if (timeoutId != null) window.clearTimeout(timeoutId);
            rafId = null;
            timeoutId = null;
        };
        const flush = () => {
            cancelPending();
            this._uiRefreshScheduled = false;
            this._uiRefreshCancel = null;
            this._flushUiRefresh();
        };
        // rAF aligns the render to the next paint and coalesces same-frame bursts — but browsers
        // pause rAF while the window is hidden/unfocused (e.g. a world loading in a background
        // tab), which left the menubar unpopulated until the first click. The timeout backstop
        // guarantees the flush runs regardless of focus; whichever fires first cancels the other.
        if (typeof requestAnimationFrame === 'function') {
            rafId = requestAnimationFrame(flush);
        }
        timeoutId = window.setTimeout(flush, 250);
        this._uiRefreshCancel = cancelPending;
    },

    _flushUiRefresh() {
        const pending = this._pendingUiRefresh;
        this._pendingUiRefresh = null;
        if (!pending) {
            return;
        }

        const windowRef = RuntimeManager.getState().windowRef;
        const tab = windowRef?.uiState?.tab;

        if (pending.refreshWindow && pending.windowRefreshDepth === 'playback') {
            // The Dashboard and Playlists bodies still encode playing state in their markup, so a
            // real playback change needs a body render there. Most scene-driven events do not touch
            // what those tabs show — one-shot triggers, their duration follow-up timers, environment
            // starts and music advances all play sounds inside the hidden scene playlist — and
            // rebuilding the full track list for them was the module's main steady-state GC source.
            // The signature check downgrades those to the cheap targeted-DOM path.
            const bodyEncodesPlayback = tab === 'dashboard' || tab === 'playlists';
            const playbackChanged = bodyEncodesPlayback
                && windowRef?.getRenderedPlaybackSignature?.() !== this.getPlaybackBodySignature();
            if (bodyEncodesPlayback && playbackChanged && windowRef?.refreshPreservingUi) {
                this._playbackRefreshStats.bodyRenders += 1;
                void windowRef.refreshPreservingUi();
            } else {
                if (bodyEncodesPlayback) this._playbackRefreshStats.bodyRendersSkipped += 1;
                windowRef?.refreshPlaybackChrome?.();
                windowRef?.refreshSceneTransportUi?.();
            }
        } else if (pending.refreshWindow && windowRef?.refreshPreservingUi) {
            this._playbackRefreshStats.fullRenders += 1;
            void windowRef.refreshPreservingUi();
        } else if (pending.refreshWindow && windowRef) {
            this._playbackRefreshStats.fullRenders += 1;
            windowRef.render(true);
        } else if (!pending.refreshWindow && windowRef?.refreshPlaybackChrome) {
            windowRef.refreshPlaybackChrome();
            windowRef.refreshSceneTransportUi?.();
        }

        if (pending.refreshMenubar) {
            this.refreshSecondaryBarState();
            RuntimeManager.queueMenubarRender();
        }
    },

    refreshSecondaryBarState() {
        const blacksmith = game.modules.get('coffee-pub-blacksmith')?.api;
        if (!blacksmith?.updateSecondaryBarItemInfo) return;

        const { nowPlaying, activeSoundScene: activeScene } = this.getHeaderPlaybackContext();
        const primaryTrack = nowPlaying.music
            ?? nowPlaying.ambientTracks?.[0]
            ?? nowPlaying.activeTracks?.[0]?.trackRef
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
            label: 'Sound Scene:',
            value: activeSceneLabel,
            title: sceneMeta
        });
        blacksmith.updateSecondaryBarItemInfo(this.CONTROL_BAR_ID, 'minstrel-now-playing', {
            label: 'Now Playing:',
            value: trackLabel,
            title: trackMeta
        });
    },

    getDashboardData() {
        if (!this._dashboardCache) {
            const nowPlaying = PlaylistManager.getNowPlaying();
            const cues = CueManager.getCues();
            const soundScenes = SoundSceneManager.getSoundScenes();
            const playlistSummary = PlaylistManager.getPlaylistSummary();
            const activeSoundSceneId = RuntimeManager.getState().activeSoundSceneId;

            // Single pass over scenes: pick favorites and the active scene together.
            const favoriteScenes = [];
            let activeSoundScene = null;
            for (const scene of soundScenes) {
                const isActive = scene.id === activeSoundSceneId;
                if (isActive) activeSoundScene = scene;
                if (scene.favorite) favoriteScenes.push({ ...scene, isActive });
            }

            // Single pass over sounds: only spread the (few) favorites, not every track.
            const favoriteTracks = [];
            for (const playlist of playlistSummary) {
                for (const sound of playlist.sounds ?? []) {
                    if (!sound.favorite) continue;
                    favoriteTracks.push({
                        ...sound,
                        playlistId: playlist.id,
                        playlistName: playlist.name
                    });
                }
            }

            this._dashboardCache = {
                nowPlaying,
                favoriteCues: cues
                    .filter((cue) => cue.favorite)
                    .map((cue) => ({
                        ...cue,
                        cardStyle: `--cue-tint:${cue.tintColor ?? '#b96c26'}; --cue-tint-soft:${toRgbaString(cue.tintColor ?? '#b96c26', 0.18)};`
                    })),
                favoriteScenes,
                favoritePlaylists: playlistSummary
                    .filter((playlist) => playlist.favorite)
                    .map((playlist) => ({
                        ...playlist,
                        isActive: !!playlist.isActive
                    })),
                favoriteTracks,
                activeSoundScene,
            };
        }

        return this._dashboardCache;
    },

    /**
     * Playback fingerprint for the tabs whose body markup encodes playing state (Dashboard,
     * Playlists). The active scene id is folded in because the Dashboard's favorite-scene cards
     * render an `isActive` flag; everything else comes from `PlaylistManager.getPlaybackSignature`.
     */
    getPlaybackBodySignature() {
        const activeSoundSceneId = RuntimeManager.getState().activeSoundSceneId ?? '';
        return `${activeSoundSceneId}|${PlaylistManager.getPlaybackSignature()}`;
    },

    getHeaderPlaybackContext() {
        const nowPlaying = PlaylistManager.getNowPlaying();
        const activeSoundSceneId = RuntimeManager.getState().activeSoundSceneId;
        const activeSoundScene = activeSoundSceneId
            ? SoundSceneManager.getSoundScene(activeSoundSceneId) ?? null
            : null;
        return { nowPlaying, activeSoundScene };
    }
};
