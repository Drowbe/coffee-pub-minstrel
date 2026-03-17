// ==================================================================
// ===== MINSTREL WINDOW ============================================
// ==================================================================

import { PlaylistManager } from './manager-playlists.js';
import { SoundSceneManager } from './manager-soundscenes.js';
import { CueManager } from './manager-cues.js';
import { AutomationManager } from './manager-automation.js';
import { MinstrelManager } from './manager-minstrel.js';
import { RuntimeManager } from './manager-runtime.js';
import { StorageManager } from './manager-storage.js';
import { BlacksmithWindowBaseV2 } from '/modules/coffee-pub-blacksmith/scripts/window-base-v2.js';

function buildActionButton(action, label, icon, options = {}) {
    const classes = ['minstrel-btn'];
    if (options.variant) classes.push(`minstrel-btn-${options.variant}`);
    if (options.active) classes.push('is-active');
    const attrs = [
        'type="button"',
        `class="${classes.join(' ')}"`,
        `data-action="${action}"`
    ];
    if (options.value !== undefined && options.value !== null) attrs.push(`data-value="${options.value}"`);
    return `<button ${attrs.join(' ')}>${icon ? `<i class="${icon}"></i>` : ''}<span>${label}</span></button>`;
}

function splitTags(tags) {
    return String(tags ?? '').split(',').map((entry) => entry.trim()).filter(Boolean);
}

function toTrackValue(trackRef) {
    return trackRef?.playlistId && trackRef?.soundId ? `${trackRef.playlistId}::${trackRef.soundId}` : '';
}

function buildTrackOptions(trackOptions, selectedValue = '', checkedValues = new Set()) {
    return trackOptions.map((option) => ({
        ...option,
        selected: option.value === selectedValue,
        checked: checkedValues.has(option.value)
    }));
}

function getPlaybackLayer(trackRef) {
    if (trackRef?.channel === 'ambient') return { layer: 'ambient', exclusive: false };
    if (trackRef?.channel === 'cue') return { layer: 'cue', exclusive: false };
    return { layer: 'music', exclusive: true };
}

function matchesPlaylistStatusFilter(soundSummary, statusFilter) {
    if (statusFilter === 'playing') return !!soundSummary.playing;
    if (statusFilter === 'favorites') return !!soundSummary.favorite;
    if (statusFilter === 'recents') return !!soundSummary.recent;
    return true;
}

export class MinstrelWindow extends BlacksmithWindowBaseV2 {
    static ROOT_CLASS = 'minstrel-window-root';

    static DEFAULT_OPTIONS = foundry.utils.mergeObject(foundry.utils.mergeObject({}, super.DEFAULT_OPTIONS ?? {}), {
        id: 'coffee-pub-minstrel-window',
        classes: ['minstrel-window'],
        position: { width: 1200, height: 820 },
        window: {
            title: 'Coffee Pub Minstrel',
            icon: 'fa-solid fa-music',
            resizable: true,
            minimizable: true
        },
        windowSizeConstraints: {
            minWidth: 960,
            minHeight: 640
        }
    });

    static PARTS = {
        content: {
            template: 'modules/coffee-pub-minstrel/templates/window-minstrel.hbs'
        }
    };

    static ACTION_HANDLERS = {
        selectTab: (_event, button) => MinstrelWindow._withWindow((windowRef) => windowRef.selectTab(button.dataset.value)),
        refreshWindow: () => MinstrelWindow._withWindow((windowRef) => windowRef.render(true)),
        stopAllAudio: () => MinstrelWindow._withWindow(async () => {
            await PlaylistManager.stopAllAudio();
            RuntimeManager.setActiveSoundSceneId(null);
            MinstrelManager.requestUiRefresh();
        }),
        stopMusicLayer: () => MinstrelWindow._withWindow(async () => {
            await PlaylistManager.stopLayer('music');
            MinstrelManager.requestUiRefresh();
        }),
        stopAmbientLayer: () => MinstrelWindow._withWindow(async () => {
            await PlaylistManager.stopLayer('ambient');
            MinstrelManager.requestUiRefresh();
        }),
        restoreSnapshot: () => MinstrelWindow._withWindow(async () => {
            const snapshot = RuntimeManager.getPreviousSnapshot();
            if (snapshot) await PlaylistManager.restorePlaybackSnapshot(snapshot);
            MinstrelManager.requestUiRefresh();
        }),
        playTrack: (_event, button) => MinstrelWindow._withWindow(async () => {
            const ref = PlaylistManager.parseTrackRefValue(button.dataset.value);
            if (!ref) return;
            const playback = getPlaybackLayer(ref);
            await PlaylistManager.playTrack(ref, playback);
            MinstrelManager.requestUiRefresh();
        }),
        pauseTrack: (_event, button) => MinstrelWindow._withWindow(async () => {
            const ref = PlaylistManager.parseTrackRefValue(button.dataset.value);
            if (!ref) return;
            await PlaylistManager.pauseTrack(ref);
            MinstrelManager.requestUiRefresh();
        }),
        resumeTrack: (_event, button) => MinstrelWindow._withWindow(async () => {
            const ref = PlaylistManager.parseTrackRefValue(button.dataset.value);
            if (!ref) return;
            await PlaylistManager.resumeTrack(ref);
            MinstrelManager.requestUiRefresh();
        }),
        stopTrack: (_event, button) => MinstrelWindow._withWindow(async () => {
            const ref = PlaylistManager.parseTrackRefValue(button.dataset.value);
            if (!ref) return;
            await PlaylistManager.stopTrack(ref);
            MinstrelManager.requestUiRefresh();
        }),
        skipPlaylist: (_event, button) => MinstrelWindow._withWindow(async () => {
            if (!button.dataset.value) return;
            await PlaylistManager.skipPlaylist(button.dataset.value);
            MinstrelManager.requestUiRefresh();
        }),
        toggleFavoriteTrack: (_event, button) => MinstrelWindow._withWindow(async () => {
            const ref = PlaylistManager.parseTrackRefValue(button.dataset.value);
            if (!ref) return;
            await PlaylistManager.toggleFavorite(ref);
            MinstrelManager.requestUiRefresh();
        }),
        applyTrackVolume: (_event, button) => MinstrelWindow._withWindow(async (windowRef) => {
            const ref = PlaylistManager.parseTrackRefValue(button.dataset.value);
            if (!ref) return;
            const input = windowRef._getRoot()?.querySelector(`[data-track-volume="${button.dataset.value}"]`);
            const volume = Number(input?.value ?? 0.5);
            await PlaylistManager.setTrackVolume(ref, volume);
            MinstrelManager.requestUiRefresh();
        }),
        applyPlaylistFilters: () => MinstrelWindow._withWindow(async (windowRef) => {
            const root = windowRef._getRoot();
            const search = String(root?.querySelector('#minstrel-playlist-search')?.value ?? '').trim();
            await windowRef.setPlaylistFilters({
                playlistSearch: search
            });
        }),
        clearPlaylistFilters: () => MinstrelWindow._withWindow(async (windowRef) => {
            await windowRef.setPlaylistFilters({
                playlistSearch: '',
                playlistChannelFilter: 'all',
                playlistStatusFilter: 'all'
            });
        }),
        setPlaylistChannelFilter: (_event, button) => MinstrelWindow._withWindow(async (windowRef) => {
            await windowRef.setPlaylistFilters({
                playlistChannelFilter: button.dataset.value ?? 'all'
            });
        }),
        setPlaylistStatusFilter: (_event, button) => MinstrelWindow._withWindow(async (windowRef) => {
            await windowRef.setPlaylistFilters({
                playlistStatusFilter: button.dataset.value ?? 'all'
            });
        }),
        openPanel: () => MinstrelWindow._withWindow(() => MinstrelManager.openWindow()),
        selectSoundScene: (_event, button) => MinstrelWindow._withWindow((windowRef) => windowRef.setSelectedSoundSceneId(button.dataset.value ?? null)),
        newSoundScene: () => MinstrelWindow._withWindow((windowRef) => windowRef.setSelectedSoundSceneId(null)),
        saveSoundScene: () => MinstrelWindow._withWindow(async (windowRef) => {
            const soundScene = windowRef._collectSoundSceneForm();
            if (!soundScene) return;
            await SoundSceneManager.saveSoundScene(soundScene);
            windowRef.setSelectedSoundSceneId(soundScene.id);
            MinstrelManager.requestUiRefresh();
        }),
        deleteSoundScene: () => MinstrelWindow._withWindow(async (windowRef) => {
            const soundSceneId = windowRef.uiState.selectedSoundSceneId;
            if (!soundSceneId) return;
            await SoundSceneManager.deleteSoundScene(soundSceneId);
            windowRef.setSelectedSoundSceneId(null);
            MinstrelManager.requestUiRefresh();
        }),
        playSoundScene: (_event, button) => MinstrelWindow._withWindow(async (windowRef) => {
            const soundSceneId = button.dataset.value ?? windowRef.uiState.selectedSoundSceneId;
            if (!soundSceneId) return;
            await SoundSceneManager.activateSoundScene(soundSceneId);
            MinstrelManager.requestUiRefresh();
        }),
        stopSoundScene: () => MinstrelWindow._withWindow(async () => {
            await SoundSceneManager.stopActiveSoundScene();
            MinstrelManager.requestUiRefresh();
        }),
        selectCue: (_event, button) => MinstrelWindow._withWindow((windowRef) => windowRef.setSelectedCueId(button.dataset.value ?? null)),
        newCue: () => MinstrelWindow._withWindow((windowRef) => windowRef.setSelectedCueId(null)),
        saveCue: () => MinstrelWindow._withWindow(async (windowRef) => {
            const cue = windowRef._collectCueForm();
            if (!cue) return;
            await CueManager.saveCue(cue);
            windowRef.setSelectedCueId(cue.id);
            MinstrelManager.requestUiRefresh();
        }),
        deleteCue: () => MinstrelWindow._withWindow(async (windowRef) => {
            const cueId = windowRef.uiState.selectedCueId;
            if (!cueId) return;
            await CueManager.deleteCue(cueId);
            windowRef.setSelectedCueId(null);
            MinstrelManager.requestUiRefresh();
        }),
        triggerCue: (_event, button) => MinstrelWindow._withWindow(async (windowRef) => {
            const cueId = button.dataset.value ?? windowRef.uiState.selectedCueId;
            if (!cueId) return;
            await CueManager.triggerCue(cueId);
            MinstrelManager.requestUiRefresh();
        }),
        selectRule: (_event, button) => MinstrelWindow._withWindow((windowRef) => windowRef.setSelectedRuleId(button.dataset.value ?? null)),
        newRule: () => MinstrelWindow._withWindow((windowRef) => windowRef.setSelectedRuleId(null)),
        saveRule: () => MinstrelWindow._withWindow(async (windowRef) => {
            const rule = windowRef._collectRuleForm();
            if (!rule) return;
            await AutomationManager.saveRule(rule);
            windowRef.setSelectedRuleId(rule.id);
            MinstrelManager.requestUiRefresh();
        }),
        deleteRule: () => MinstrelWindow._withWindow(async (windowRef) => {
            const ruleId = windowRef.uiState.selectedRuleId;
            if (!ruleId) return;
            await AutomationManager.deleteRule(ruleId);
            windowRef.setSelectedRuleId(null);
            MinstrelManager.requestUiRefresh();
        }),
        runRule: (_event, button) => MinstrelWindow._withWindow(async (windowRef) => {
            const ruleId = button.dataset.value ?? windowRef.uiState.selectedRuleId;
            if (!ruleId) return;
            await AutomationManager.triggerRule(ruleId);
            MinstrelManager.requestUiRefresh();
        })
    };

    static _withWindow(callback) {
        const windowRef = RuntimeManager.getState().windowRef;
        if (!windowRef) return;
        return callback(windowRef);
    }

    constructor(options = {}) {
        const state = StorageManager.getWindowState();
        super(options);
        this.uiState = {
            tab: state.tab ?? 'dashboard',
            selectedSoundSceneId: state.selectedSoundSceneId,
            selectedCueId: state.selectedCueId,
            selectedRuleId: state.selectedRuleId,
            playlistSearch: state.playlistSearch ?? '',
            playlistChannelFilter: state.playlistChannelFilter ?? 'all',
            playlistStatusFilter: state.playlistStatusFilter ?? 'all'
        };
    }

    _onPosition(position) {
        super._onPosition?.(position);
        StorageManager.saveWindowState({ bounds: position });
    }

    async _preClose() {
        RuntimeManager.clearWindowRef(this);
        return super._preClose?.();
    }

    async getData() {
        const soundScenes = SoundSceneManager.getSoundScenes();
        const cues = CueManager.getCues();
        const rules = AutomationManager.getRules();
        const dashboard = MinstrelManager.getDashboardData();
        const playlistSummary = PlaylistManager.getPlaylistSummary();
        const trackOptions = PlaylistManager.getTrackOptions();

        const playlistSearch = this.uiState.playlistSearch.trim().toLowerCase();
        const filteredPlaylistSummary = playlistSummary
            .map((playlist) => ({
                ...playlist,
                sounds: playlist.sounds.filter((soundSummary) => {
                    const channelMatch = this.uiState.playlistChannelFilter === 'all'
                        ? true
                        : soundSummary.channel === this.uiState.playlistChannelFilter;
                    const statusMatch = matchesPlaylistStatusFilter(soundSummary, this.uiState.playlistStatusFilter);
                    const searchHaystack = [
                        soundSummary.name,
                        soundSummary.path,
                        soundSummary.channel,
                        playlist.name
                    ].join(' ').toLowerCase();
                    const searchMatch = !playlistSearch || searchHaystack.includes(playlistSearch);
                    return channelMatch && statusMatch && searchMatch;
                })
            }))
            .filter((playlist) => playlist.sounds.length > 0 || !playlistSearch);

        const selectedSoundScene = this.uiState.selectedSoundSceneId
            ? soundScenes.find((scene) => scene.id === this.uiState.selectedSoundSceneId) ?? StorageManager.createBlankSoundScene()
            : StorageManager.createBlankSoundScene();
        const selectedCue = this.uiState.selectedCueId
            ? cues.find((cue) => cue.id === this.uiState.selectedCueId) ?? StorageManager.createBlankCue()
            : StorageManager.createBlankCue();
        const selectedRule = this.uiState.selectedRuleId
            ? rules.find((rule) => rule.id === this.uiState.selectedRuleId) ?? StorageManager.createBlankAutomationRule()
            : StorageManager.createBlankAutomationRule();

        const selectedSoundSceneTagText = Array.isArray(selectedSoundScene?.tags) ? selectedSoundScene.tags.join(', ') : '';
        const selectedMusicTrackValue = toTrackValue(selectedSoundScene?.music);
        const selectedAmbientTrackValues = new Set((selectedSoundScene?.ambientTracks ?? []).map((track) => toTrackValue(track)));
        const selectedCueTrackValue = toTrackValue(selectedCue?.track);
        const ruleSoundSceneId = selectedRule?.soundSceneId ?? '';

        const musicTrackOptions = trackOptions.filter((option) => option.channel === 'music');
        const ambientTrackOptions = trackOptions.filter((option) => option.channel === 'ambient');
        const cueTrackOptions = trackOptions.filter((option) => option.channel === 'cue');

        const bodyContent = await renderTemplate('modules/coffee-pub-minstrel/templates/partials/window-minstrel-body.hbs', {
            isDashboard: this.uiState.tab === 'dashboard',
            isPlaylists: this.uiState.tab === 'playlists',
            isSoundScenes: this.uiState.tab === 'soundScenes',
            isCues: this.uiState.tab === 'cues',
            isAutomation: this.uiState.tab === 'automation',
            dashboard,
            playlistSummary: filteredPlaylistSummary,
            trackOptions,
            soundSceneMusicOptions: buildTrackOptions(musicTrackOptions, selectedMusicTrackValue),
            soundSceneAmbientOptions: buildTrackOptions(ambientTrackOptions, '', selectedAmbientTrackValues),
            cueTrackOptions: buildTrackOptions(cueTrackOptions, selectedCueTrackValue),
            soundScenes,
            selectedSoundScene,
            selectedSoundSceneTagText,
            cues,
            selectedCue,
            rules,
            selectedRule,
            activeSoundSceneId: RuntimeManager.getState().activeSoundSceneId,
            recentLimit: StorageManager.getRecentLimit(),
            ruleEventOptions: [
                { value: 'combatStart', label: 'combatStart', selected: selectedRule?.eventType === 'combatStart' },
                { value: 'combatEnd', label: 'combatEnd', selected: selectedRule?.eventType === 'combatEnd' },
                { value: 'manualTrigger', label: 'manualTrigger', selected: selectedRule?.eventType === 'manualTrigger' }
            ],
            ruleSoundSceneOptions: soundScenes.map((scene) => ({
                id: scene.id,
                name: scene.name,
                selected: scene.id === ruleSoundSceneId
            })),
            playlistSearch: this.uiState.playlistSearch,
            playlistChannelFilter: this.uiState.playlistChannelFilter,
            playlistStatusFilter: this.uiState.playlistStatusFilter,
            isPlaylistChannelAll: this.uiState.playlistChannelFilter === 'all',
            isPlaylistChannelMusic: this.uiState.playlistChannelFilter === 'music',
            isPlaylistChannelAmbient: this.uiState.playlistChannelFilter === 'ambient',
            isPlaylistChannelCue: this.uiState.playlistChannelFilter === 'cue',
            isPlaylistStatusAll: this.uiState.playlistStatusFilter === 'all',
            isPlaylistStatusPlaying: this.uiState.playlistStatusFilter === 'playing',
            isPlaylistStatusFavorites: this.uiState.playlistStatusFilter === 'favorites',
            isPlaylistStatusRecents: this.uiState.playlistStatusFilter === 'recents'
        });

        const tabs = [
            ['dashboard', 'Dashboard', 'fa-solid fa-wave-square'],
            ['playlists', 'Playlists', 'fa-solid fa-list-music'],
            ['soundScenes', 'Scenes', 'fa-solid fa-landmark-dome'],
            ['cues', 'Cues', 'fa-solid fa-bolt'],
            ['automation', 'Automation', 'fa-solid fa-diagram-project']
        ];

        return {
            appId: this.id,
            showOptionBar: true,
            showHeader: true,
            showTools: true,
            showActionBar: true,
            headerIcon: 'fa-solid fa-music',
            windowTitle: 'Coffee Pub Minstrel',
            subtitle: 'Real-time music and ambience control for live sessions',
            optionBarLeft: tabs.map(([id, label, icon]) => buildActionButton('selectTab', label, icon, {
                value: id,
                active: this.uiState.tab === id,
                variant: 'ghost'
            })).join(''),
            optionBarRight: [
                buildActionButton('refreshWindow', 'Refresh', 'fa-solid fa-rotate-right', { variant: 'ghost' }),
                buildActionButton('restoreSnapshot', 'Restore', 'fa-solid fa-clock-rotate-left', { variant: 'ghost' }),
                buildActionButton('stopAllAudio', 'Stop All', 'fa-solid fa-volume-xmark', { variant: 'danger' })
            ].join(''),
            toolsContent: `
                <div class="minstrel-toolbar-metrics">
                    <div class="minstrel-metric"><span class="minstrel-metric-label">Music</span><span class="minstrel-metric-value">${dashboard.nowPlaying.music?.soundName ?? 'None'}</span></div>
                    <div class="minstrel-metric"><span class="minstrel-metric-label">Ambient</span><span class="minstrel-metric-value">${dashboard.nowPlaying.ambientTracks.length}</span></div>
                    <div class="minstrel-metric"><span class="minstrel-metric-label">Favorites</span><span class="minstrel-metric-value">${dashboard.favorites.length}</span></div>
                    <div class="minstrel-metric"><span class="minstrel-metric-label">Recents</span><span class="minstrel-metric-value">${dashboard.recents.length}</span></div>
                </div>
            `,
            bodyContent,
            actionBarLeft: [
                buildActionButton('openPanel', 'Focus Panel', 'fa-solid fa-window-maximize', { variant: 'ghost' }),
                buildActionButton('stopMusicLayer', 'Stop Music', 'fa-solid fa-circle-stop', { variant: 'ghost' }),
                buildActionButton('stopAmbientLayer', 'Stop Ambient', 'fa-solid fa-wind', { variant: 'ghost' })
            ].join(''),
            actionBarRight: [
                buildActionButton('newSoundScene', 'New Scene', 'fa-solid fa-plus', { variant: this.uiState.tab === 'soundScenes' ? 'primary' : 'ghost' }),
                buildActionButton('newCue', 'New Cue', 'fa-solid fa-plus', { variant: this.uiState.tab === 'cues' ? 'primary' : 'ghost' }),
                buildActionButton('newRule', 'New Rule', 'fa-solid fa-plus', { variant: this.uiState.tab === 'automation' ? 'primary' : 'ghost' })
            ].join('')
        };
    }

    async selectTab(tabId) {
        this.uiState.tab = tabId;
        await StorageManager.saveWindowState({ tab: tabId });
        this.render(true);
    }

    async setSelectedSoundSceneId(soundSceneId) {
        this.uiState.selectedSoundSceneId = soundSceneId ?? null;
        await StorageManager.saveWindowState({ selectedSoundSceneId: this.uiState.selectedSoundSceneId });
        this.render(true);
    }

    async setSelectedCueId(cueId) {
        this.uiState.selectedCueId = cueId ?? null;
        await StorageManager.saveWindowState({ selectedCueId: this.uiState.selectedCueId });
        this.render(true);
    }

    async setSelectedRuleId(ruleId) {
        this.uiState.selectedRuleId = ruleId ?? null;
        await StorageManager.saveWindowState({ selectedRuleId: this.uiState.selectedRuleId });
        this.render(true);
    }

    async setPlaylistFilters(updates = {}) {
        this.uiState.playlistSearch = updates.playlistSearch ?? this.uiState.playlistSearch;
        this.uiState.playlistChannelFilter = updates.playlistChannelFilter ?? this.uiState.playlistChannelFilter;
        this.uiState.playlistStatusFilter = updates.playlistStatusFilter ?? this.uiState.playlistStatusFilter;
        await StorageManager.saveWindowState({
            playlistSearch: this.uiState.playlistSearch,
            playlistChannelFilter: this.uiState.playlistChannelFilter,
            playlistStatusFilter: this.uiState.playlistStatusFilter
        });
        this.render(true);
    }

    _collectSoundSceneForm() {
        const root = this._getRoot();
        const selectedAmbient = Array.from(root?.querySelectorAll?.('input[name="sound-scene-ambient"]:checked') ?? [])
            .map((input) => PlaylistManager.parseTrackRefValue(input.value))
            .filter(Boolean)
            .map((trackRef) => ({
                ...trackRef,
                volume: Number(root?.querySelector('#sound-scene-ambient-volume')?.value ?? 0.65),
                fadeIn: Number(root?.querySelector('#sound-scene-fade-in')?.value ?? 2),
                fadeOut: Number(root?.querySelector('#sound-scene-fade-out')?.value ?? 2),
                delayMs: 0
            }));

        const musicTrack = PlaylistManager.parseTrackRefValue(root?.querySelector('#sound-scene-music-track')?.value);
        return {
            id: this.uiState.selectedSoundSceneId ?? foundry.utils.randomID(),
            name: root?.querySelector('#sound-scene-name')?.value ?? '',
            description: root?.querySelector('#sound-scene-description')?.value ?? '',
            tags: splitTags(root?.querySelector('#sound-scene-tags')?.value ?? ''),
            music: musicTrack ? {
                ...musicTrack,
                volume: Number(root?.querySelector('#sound-scene-music-volume')?.value ?? 0.75)
            } : null,
            ambientTracks: selectedAmbient,
            volumes: {
                music: Number(root?.querySelector('#sound-scene-music-volume')?.value ?? 0.75),
                ambient: Number(root?.querySelector('#sound-scene-ambient-volume')?.value ?? 0.65),
                cues: 1
            },
            fadeIn: Number(root?.querySelector('#sound-scene-fade-in')?.value ?? 2),
            fadeOut: Number(root?.querySelector('#sound-scene-fade-out')?.value ?? 2),
            restorePreviousOnExit: !!root?.querySelector('#sound-scene-restore')?.checked,
            enabled: !!root?.querySelector('#sound-scene-enabled')?.checked,
            favorite: !!root?.querySelector('#sound-scene-favorite')?.checked
        };
    }

    _collectCueForm() {
        const root = this._getRoot();
        return {
            id: this.uiState.selectedCueId ?? foundry.utils.randomID(),
            name: root?.querySelector('#cue-name')?.value ?? '',
            icon: root?.querySelector('#cue-icon')?.value ?? 'fa-solid fa-bell',
            category: root?.querySelector('#cue-category')?.value ?? 'general',
            track: PlaylistManager.parseTrackRefValue(root?.querySelector('#cue-track')?.value),
            volume: Number(root?.querySelector('#cue-volume')?.value ?? 1),
            cooldown: Number(root?.querySelector('#cue-cooldown')?.value ?? 0),
            duckOthers: !!root?.querySelector('#cue-duck-others')?.checked,
            stopOnSceneChange: !!root?.querySelector('#cue-stop-on-scene-change')?.checked,
            favorite: !!root?.querySelector('#cue-favorite')?.checked,
            enabled: !!root?.querySelector('#cue-enabled')?.checked
        };
    }

    _collectRuleForm() {
        const root = this._getRoot();
        return {
            id: this.uiState.selectedRuleId ?? foundry.utils.randomID(),
            name: root?.querySelector('#rule-name')?.value ?? '',
            eventType: root?.querySelector('#rule-event-type')?.value ?? 'manualTrigger',
            soundSceneId: root?.querySelector('#rule-sound-scene')?.value || null,
            priority: Number(root?.querySelector('#rule-priority')?.value ?? 0),
            delayMs: Number(root?.querySelector('#rule-delay-ms')?.value ?? 0),
            restorePreviousOnExit: !!root?.querySelector('#rule-restore')?.checked,
            enabled: !!root?.querySelector('#rule-enabled')?.checked
        };
    }
}
