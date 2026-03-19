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
    if (options.variant === 'primary') {
        classes.push('blacksmith-window-template-btn-primary');
    } else {
        classes.push('blacksmith-window-template-btn-secondary');
    }
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

function formatDurationLabel(seconds) {
    const totalSeconds = Math.max(0, Math.round(Number(seconds) || 0));
    const minutes = Math.floor(totalSeconds / 60);
    const remainingSeconds = totalSeconds % 60;
    return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
}

function getLayerTypeLabel(layerType) {
    if (layerType === 'music') return 'Music';
    if (layerType === 'environment') return 'Environment';
    if (layerType === 'scheduled-one-shot') return 'One-Shot';
    return 'Layer';
}

function buildTimelineRepeatMarkers(layer, longestDuration) {
    if (layer?.type !== 'scheduled-one-shot') return [];
    if (String(layer?.loopMode ?? 'loop') !== 'loop') return [];
    const frequencySeconds = Math.max(1, Number(layer?.frequencySeconds) || 0);
    if (!frequencySeconds || longestDuration <= 0) return [];

    const markers = [];
    for (let offset = frequencySeconds; offset < longestDuration && markers.length < 24; offset += frequencySeconds) {
        markers.push(Math.max(0, Math.min(100, (offset / longestDuration) * 100)));
    }
    return markers;
}

function buildTimelineRepeatSegments(layer, durationSeconds, longestDuration) {
    if (layer?.type !== 'scheduled-one-shot') return [];
    if (String(layer?.loopMode ?? 'loop') !== 'loop') return [];
    const frequencySeconds = Math.max(1, Number(layer?.frequencySeconds) || 0);
    if (!frequencySeconds || longestDuration <= 0 || durationSeconds <= 0) return [];

    const segmentWidthPercent = Math.max(4, Math.min(100, (durationSeconds / longestDuration) * 100));
    const segments = [];

    for (let offset = frequencySeconds; offset < longestDuration && segments.length < 24; offset += frequencySeconds) {
        const leftPercent = Math.max(0, Math.min(100, (offset / longestDuration) * 100));
        if (leftPercent >= 100) break;
        const availableWidth = Math.max(0, 100 - leftPercent);
        if (availableWidth <= 0) break;
        segments.push({
            leftPercent,
            widthPercent: Math.min(segmentWidthPercent, availableWidth)
        });
    }

    return segments;
}

function buildTimelinePresentation(layer, durationSeconds, longestDuration, isActive) {
    const loopEnabled = String(layer?.loopMode ?? 'loop') !== 'once';
    const eventOnly = layer?.type === 'scheduled-one-shot' && !loopEnabled;
    const timelineWidthPercent = durationSeconds > 0
        ? Math.max(4, Math.min(100, (durationSeconds / longestDuration) * 100))
        : 0;
    const frequencyText = layer?.type === 'scheduled-one-shot'
        ? (loopEnabled ? `${Math.max(1, Number(layer?.frequencySeconds) || 120)}s repeat` : 'Single event')
        : (loopEnabled ? 'Looping' : 'Single pass');

    return {
        durationSeconds,
        durationLabel: formatDurationLabel(durationSeconds),
        loopEnabled,
        timelineShowBar: !eventOnly && durationSeconds > 0,
        timelineSingleEvent: eventOnly,
        timelineWidthPercent,
        timelineRepeatMarkers: buildTimelineRepeatMarkers(layer, longestDuration),
        timelineRepeatSegments: buildTimelineRepeatSegments(layer, durationSeconds, longestDuration),
        timelineIsActive: !!isActive,
        timelineTooltip: [
            `${getLayerTypeLabel(layer?.type)}: ${layer?.trackRef?.soundName ?? 'Unknown'}`,
            `Duration: ${formatDurationLabel(durationSeconds)}`,
            `Behavior: ${frequencyText}`,
            `Source: ${layer?.trackRef?.playlistName ?? 'Unknown Playlist'}`
        ].join('\n')
    };
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

function cloneSoundScene(soundScene) {
    return foundry.utils.deepClone(soundScene ?? StorageManager.createBlankSoundScene());
}

export class MinstrelWindow extends BlacksmithWindowBaseV2 {
    static ROOT_CLASS = 'minstrel-window-root';
    static _searchDelegationAttached = false;

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
        toggleFavoritePlaylist: (_event, button) => MinstrelWindow._withWindow(async () => {
            if (!button.dataset.value) return;
            await PlaylistManager.toggleFavoritePlaylist(button.dataset.value);
            MinstrelManager.requestUiRefresh();
        }),
        openPanel: () => MinstrelWindow._withWindow(() => MinstrelManager.openWindow()),
        selectSoundScene: (_event, button) => MinstrelWindow._withWindow((windowRef) => windowRef.setSelectedSoundSceneId(button.dataset.value ?? null)),
        newSoundScene: () => MinstrelWindow._withWindow((windowRef) => windowRef.setSelectedSoundSceneId(null)),
        saveSoundScene: () => MinstrelWindow._withWindow(async (windowRef) => {
            const soundScene = windowRef._collectSoundSceneForm();
            if (!soundScene) return;
            await SoundSceneManager.saveSoundScene(soundScene);
            windowRef.setSoundSceneDraft(soundScene);
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
        browseSoundSceneBackground: () => MinstrelWindow._withWindow((windowRef) => windowRef._browseSoundSceneBackground()),
        addSceneLayer: (_event, button) => MinstrelWindow._withWindow((windowRef) => {
            const sceneDraft = windowRef._collectSoundSceneForm();
            const trackRef = PlaylistManager.parseTrackRefValue(button.dataset.value);
            const layerType = button.dataset.layerType;
            if (!sceneDraft || !trackRef || !layerType) return;
            const nextLayer = {
                id: foundry.utils.randomID(),
                type: layerType,
                trackRef,
                volume: layerType === 'music' ? 0.75 : layerType === 'scheduled-one-shot' ? 1 : 0.65,
                fadeIn: 2,
                fadeOut: 2,
                startDelayMs: 0,
                frequencySeconds: 120,
                loopMode: 'loop',
                enabled: true
            };
            if (layerType === 'music') {
                sceneDraft.layers = (sceneDraft.layers ?? []).filter((layer) => layer.type !== 'music');
            }
            sceneDraft.layers = [...(sceneDraft.layers ?? []), nextLayer];
            windowRef.setSoundSceneDraft(sceneDraft);
            windowRef.render(true);
        }),
        removeSceneLayer: (_event, button) => MinstrelWindow._withWindow((windowRef) => {
            const sceneDraft = windowRef._collectSoundSceneForm();
            const layerId = button.dataset.value;
            if (!sceneDraft || !layerId) return;
            sceneDraft.layers = (sceneDraft.layers ?? []).filter((layer) => layer.id !== layerId);
            windowRef.setSoundSceneDraft(sceneDraft);
            windowRef.render(true);
        }),
        setSceneSoundFilter: (_event, button) => MinstrelWindow._withWindow(async (windowRef) => {
            await windowRef.setSceneWorkspaceState({
                sceneSoundFilter: button.dataset.value ?? 'all'
            });
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
        this._playlistSearchTimer = null;
        this._sceneSearchTimer = null;
        this._sceneSoundSearchTimer = null;
        this.uiState = {
            tab: state.tab ?? 'dashboard',
            selectedSoundSceneId: state.selectedSoundSceneId,
            soundSceneDraft: cloneSoundScene(state.selectedSoundSceneId ? SoundSceneManager.getSoundScene(state.selectedSoundSceneId) : StorageManager.createBlankSoundScene()),
            sceneSearch: state.sceneSearch ?? '',
            sceneSoundSearch: state.sceneSoundSearch ?? '',
            sceneSoundFilter: state.sceneSoundFilter ?? 'all',
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
        if (this.position) {
            await StorageManager.saveWindowState({ bounds: this.position });
        }
        if (this._playlistSearchTimer) {
            window.clearTimeout(this._playlistSearchTimer);
            this._playlistSearchTimer = null;
        }
        if (this._sceneSearchTimer) {
            window.clearTimeout(this._sceneSearchTimer);
            this._sceneSearchTimer = null;
        }
        if (this._sceneSoundSearchTimer) {
            window.clearTimeout(this._sceneSoundSearchTimer);
            this._sceneSoundSearchTimer = null;
        }
        RuntimeManager.clearWindowRef(this);
        return super._preClose?.();
    }

    _attachPlaylistSearchDelegationOnce() {
        const Ctor = this.constructor;
        Ctor._ref = this;
        if (Ctor._searchDelegationAttached) return;
        Ctor._searchDelegationAttached = true;

        document.addEventListener('input', (event) => {
            const windowRef = Ctor._ref;
            if (!windowRef) return;
            const root = windowRef._getRoot();
            const target = event.target;
            const inRoot = root?.contains?.(target);
            const inApp = windowRef.element?.contains?.(target);
            if (!inRoot && !inApp) return;
            if (target?.id === 'minstrel-playlist-search') {
                const search = String(target.value ?? '').trim();
                if (windowRef._playlistSearchTimer) {
                    window.clearTimeout(windowRef._playlistSearchTimer);
                    windowRef._playlistSearchTimer = null;
                }

                if (!search.length) {
                    void windowRef.setPlaylistFilters({ playlistSearch: '' });
                    return;
                }

                if (search.length < 3) return;

                windowRef._playlistSearchTimer = window.setTimeout(() => {
                    windowRef._playlistSearchTimer = null;
                    void windowRef.setPlaylistFilters({ playlistSearch: search });
                }, 250);
                return;
            }

            if (target?.id === 'minstrel-scene-search') {
                const search = String(target.value ?? '').trim();
                if (windowRef._sceneSearchTimer) {
                    window.clearTimeout(windowRef._sceneSearchTimer);
                    windowRef._sceneSearchTimer = null;
                }
                if (!search.length) {
                    void windowRef.setSceneWorkspaceState({ sceneSearch: '' });
                    return;
                }
                if (search.length < 3) return;
                windowRef._sceneSearchTimer = window.setTimeout(() => {
                    windowRef._sceneSearchTimer = null;
                    void windowRef.setSceneWorkspaceState({ sceneSearch: search });
                }, 250);
                return;
            }

            if (target?.id === 'minstrel-scene-sound-search') {
                const search = String(target.value ?? '').trim();
                if (windowRef._sceneSoundSearchTimer) {
                    window.clearTimeout(windowRef._sceneSoundSearchTimer);
                    windowRef._sceneSoundSearchTimer = null;
                }
                if (!search.length) {
                    void windowRef.setSceneWorkspaceState({ sceneSoundSearch: '' });
                    return;
                }
                if (search.length < 3) return;
                windowRef._sceneSoundSearchTimer = window.setTimeout(() => {
                    windowRef._sceneSoundSearchTimer = null;
                    void windowRef.setSceneWorkspaceState({ sceneSoundSearch: search });
                }, 250);
                return;
            }

            if (target?.matches?.('[data-scene-layer-field="volume"]')) {
                const slider = target.closest('.minstrel-layer-slider');
                const valueLabel = slider?.querySelector('span');
                if (valueLabel) {
                    valueLabel.textContent = `${Number(target.value ?? 0)}%`;
                }
                return;
            }

            if (target?.matches?.('[data-scene-layer-field="loopMode"]')) {
                const row = target.closest('[data-scene-layer-row]');
                if (row?.dataset.layerType === 'scheduled-one-shot') {
                    const frequencyField = row.querySelector('[data-scene-layer-frequency]');
                    frequencyField?.classList.toggle('is-hidden', !target.checked);
                }
            }
        }, true);
    }

    async _onFirstRender(context, options) {
        await super._onFirstRender(context, options);
        this._attachPlaylistSearchDelegationOnce();
    }

    activateListeners(html) {
        super.activateListeners(html);
        this._attachPlaylistSearchDelegationOnce();
    }

    _browseSoundSceneBackground() {
        const input = this._getRoot()?.querySelector('#sound-scene-background-image');
        const picker = new FilePicker({
            type: 'image',
            callback: (path) => {
                if (!input) return;
                input.value = path;
            }
        });
        picker.browse();
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

        const selectedSoundScene = cloneSoundScene(this.uiState.soundSceneDraft ?? (this.uiState.selectedSoundSceneId
            ? soundScenes.find((scene) => scene.id === this.uiState.selectedSoundSceneId)
            : StorageManager.createBlankSoundScene()));
        const selectedCue = this.uiState.selectedCueId
            ? cues.find((cue) => cue.id === this.uiState.selectedCueId) ?? StorageManager.createBlankCue()
            : StorageManager.createBlankCue();
        const selectedRule = this.uiState.selectedRuleId
            ? rules.find((rule) => rule.id === this.uiState.selectedRuleId) ?? StorageManager.createBlankAutomationRule()
            : StorageManager.createBlankAutomationRule();

        const selectedSoundSceneTagText = Array.isArray(selectedSoundScene?.tags) ? selectedSoundScene.tags.join(', ') : '';
        const selectedSceneLayers = Array.isArray(selectedSoundScene?.layers) ? selectedSoundScene.layers : [];
        const selectedSceneMusicLayers = selectedSceneLayers.filter((layer) => layer.type === 'music');
        const selectedSceneEnvironmentLayers = selectedSceneLayers.filter((layer) => layer.type === 'environment');
        const selectedSceneScheduledLayers = selectedSceneLayers.filter((layer) => layer.type === 'scheduled-one-shot');
        const selectedSceneLayerDurations = await Promise.all(selectedSceneLayers.map(async (layer) => ({
            layerId: layer.id,
            durationSeconds: await PlaylistManager.getTrackDurationSeconds(layer.trackRef)
        })));
        const selectedSceneLayerDurationMap = new Map(selectedSceneLayerDurations.map((entry) => [entry.layerId, entry.durationSeconds]));
        const longestSceneLayerDuration = Math.max(1, ...selectedSceneLayerDurations.map((entry) => entry.durationSeconds || 0));
        const isSelectedSceneActive = !!selectedSoundScene?.id && selectedSoundScene.id === RuntimeManager.getState().activeSoundSceneId;
        const selectedCueTrackValue = toTrackValue(selectedCue?.track);
        const ruleSoundSceneId = selectedRule?.soundSceneId ?? '';

        const musicTrackOptions = trackOptions.filter((option) => option.channel === 'music');
        const ambientTrackOptions = trackOptions.filter((option) => option.channel === 'ambient');
        const cueTrackOptions = trackOptions.filter((option) => option.channel === 'cue');
        const sceneSearch = this.uiState.sceneSearch.trim().toLowerCase();
        const filteredSoundScenes = soundScenes.filter((scene) => {
            if (!sceneSearch) return true;
            const haystack = [scene.name, scene.description, ...(scene.tags ?? [])].join(' ').toLowerCase();
            return haystack.includes(sceneSearch);
        }).map((scene) => ({
            ...scene,
            cardStyle: scene.backgroundImage
                ? `background-image: linear-gradient(rgba(14, 10, 8, 0.72), rgba(14, 10, 8, 0.78)), url('${scene.backgroundImage}');`
                : ''
        }));
        const sceneSoundSearch = this.uiState.sceneSoundSearch.trim().toLowerCase();
        const sceneSoundFilter = this.uiState.sceneSoundFilter;
        const sceneSelectorOptions = trackOptions.filter((option) => {
            const filterMatch = sceneSoundFilter === 'all'
                ? true
                : sceneSoundFilter === 'scheduled-one-shot'
                    ? option.channel === 'cue'
                    : sceneSoundFilter === 'environment'
                        ? option.channel === 'ambient'
                        : option.channel === sceneSoundFilter;
            const searchMatch = !sceneSoundSearch || option.label.toLowerCase().includes(sceneSoundSearch);
            return filterMatch && searchMatch;
        }).map((option) => ({
            ...option,
            layerType: option.channel === 'music' ? 'music' : option.channel === 'cue' ? 'scheduled-one-shot' : 'environment',
            typeLabel: option.channel === 'music' ? 'Music' : option.channel === 'cue' ? 'Scheduled One-Shot' : 'Environment',
            cardClass: option.channel === 'music' ? 'minstrel-card-music' : option.channel === 'cue' ? 'minstrel-card-oneshot' : 'minstrel-card-environment',
            iconClass: option.channel === 'music' ? 'fa-solid fa-music' : option.channel === 'cue' ? 'fa-solid fa-bolt' : 'fa-solid fa-wind'
        }));

        const bodyContent = await renderTemplate('modules/coffee-pub-minstrel/templates/partials/window-minstrel-body.hbs', {
            isDashboard: this.uiState.tab === 'dashboard',
            isPlaylists: this.uiState.tab === 'playlists',
            isSoundScenes: this.uiState.tab === 'soundScenes',
            isCues: this.uiState.tab === 'cues',
            isAutomation: this.uiState.tab === 'automation',
            dashboard,
            playlistSummary: filteredPlaylistSummary,
            trackOptions,
            filteredSoundScenes,
            sceneSearch: this.uiState.sceneSearch,
            sceneSoundSearch: this.uiState.sceneSoundSearch,
            sceneSoundFilter: this.uiState.sceneSoundFilter,
            isSceneSoundFilterAll: this.uiState.sceneSoundFilter === 'all',
            isSceneSoundFilterMusic: this.uiState.sceneSoundFilter === 'music',
            isSceneSoundFilterEnvironment: this.uiState.sceneSoundFilter === 'environment',
            isSceneSoundFilterOneShot: this.uiState.sceneSoundFilter === 'scheduled-one-shot',
            sceneSelectorOptions,
            cueTrackOptions: buildTrackOptions(cueTrackOptions, selectedCueTrackValue),
            soundScenes,
            selectedSoundScene,
            selectedSoundSceneTagText,
            selectedSceneMusicLayers: selectedSceneMusicLayers.map((layer) => ({
                ...layer,
                trackValue: toTrackValue(layer.trackRef),
                volumePercent: Math.round((Number(layer.volume ?? 0.75) || 0) * 100),
                ...buildTimelinePresentation(layer, selectedSceneLayerDurationMap.get(layer.id) ?? 0, longestSceneLayerDuration, isSelectedSceneActive)
            })),
            selectedSceneEnvironmentLayers: selectedSceneEnvironmentLayers.map((layer) => ({
                ...layer,
                trackValue: toTrackValue(layer.trackRef),
                volumePercent: Math.round((Number(layer.volume ?? 0.65) || 0) * 100),
                ...buildTimelinePresentation(layer, selectedSceneLayerDurationMap.get(layer.id) ?? 0, longestSceneLayerDuration, isSelectedSceneActive)
            })),
            selectedSceneScheduledLayers: selectedSceneScheduledLayers.map((layer) => ({
                ...layer,
                trackValue: toTrackValue(layer.trackRef),
                volumePercent: Math.round((Number(layer.volume ?? 1) || 0) * 100),
                ...buildTimelinePresentation(layer, selectedSceneLayerDurationMap.get(layer.id) ?? 0, longestSceneLayerDuration, isSelectedSceneActive)
            })),
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
                buildActionButton('newSoundScene', 'New Scene', 'fa-solid fa-plus', { variant: 'ghost', active: this.uiState.tab === 'soundScenes' }),
                buildActionButton('newCue', 'New Cue', 'fa-solid fa-plus', { variant: 'ghost', active: this.uiState.tab === 'cues' }),
                buildActionButton('newRule', 'New Rule', 'fa-solid fa-plus', { variant: 'ghost', active: this.uiState.tab === 'automation' })
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
        this.uiState.soundSceneDraft = cloneSoundScene(soundSceneId ? SoundSceneManager.getSoundScene(soundSceneId) : StorageManager.createBlankSoundScene());
        await StorageManager.saveWindowState({ selectedSoundSceneId: this.uiState.selectedSoundSceneId });
        this.render(true);
    }

    setSoundSceneDraft(soundScene) {
        this.uiState.soundSceneDraft = cloneSoundScene(soundScene);
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

    async setSceneWorkspaceState(updates = {}) {
        this.uiState.sceneSearch = updates.sceneSearch ?? this.uiState.sceneSearch;
        this.uiState.sceneSoundSearch = updates.sceneSoundSearch ?? this.uiState.sceneSoundSearch;
        this.uiState.sceneSoundFilter = updates.sceneSoundFilter ?? this.uiState.sceneSoundFilter;
        await StorageManager.saveWindowState({
            sceneSearch: this.uiState.sceneSearch,
            sceneSoundSearch: this.uiState.sceneSoundSearch,
            sceneSoundFilter: this.uiState.sceneSoundFilter
        });
        this.render(true);
    }

    _collectSoundSceneForm() {
        const root = this._getRoot();
        const defaultFadeIn = Number(root?.querySelector('#sound-scene-default-fade-in')?.value ?? 2);
        const defaultFadeOut = Number(root?.querySelector('#sound-scene-default-fade-out')?.value ?? 2);
        const layers = Array.from(root?.querySelectorAll?.('[data-scene-layer-row]') ?? [])
            .map((row) => {
                const trackRef = PlaylistManager.parseTrackRefValue(row.dataset.trackValue);
                if (!trackRef) return null;
                const layerType = row.dataset.layerType;
                return {
                    id: row.dataset.layerId ?? foundry.utils.randomID(),
                    type: layerType,
                    trackRef,
                    volume: Number(row.querySelector('[data-scene-layer-field="volume"]')?.value ?? (layerType === 'music' ? 75 : layerType === 'scheduled-one-shot' ? 100 : 65)) / 100,
                    fadeIn: defaultFadeIn,
                    fadeOut: defaultFadeOut,
                    frequencySeconds: Number(row.querySelector('[data-scene-layer-field="frequencySeconds"]')?.value ?? 120),
                    loopMode: row.querySelector('[data-scene-layer-field="loopMode"]')?.checked ? 'loop' : 'once',
                    enabled: !!row.querySelector('[data-scene-layer-field="enabled"]')?.checked
                };
            })
            .filter(Boolean);
        return {
            id: this.uiState.selectedSoundSceneId ?? foundry.utils.randomID(),
            name: root?.querySelector('#sound-scene-name')?.value ?? '',
            description: root?.querySelector('#sound-scene-description')?.value ?? '',
            backgroundImage: root?.querySelector('#sound-scene-background-image')?.value ?? '',
            tags: splitTags(root?.querySelector('#sound-scene-tags')?.value ?? ''),
            music: layers.find((layer) => layer.type === 'music')?.trackRef ?? null,
            ambientTracks: layers.filter((layer) => layer.type === 'environment').map((layer) => ({
                ...layer.trackRef,
                volume: layer.volume,
                fadeIn: layer.fadeIn,
                fadeOut: layer.fadeOut,
                delayMs: layer.startDelayMs
            })),
            layers,
            volumes: {
                music: layers.find((layer) => layer.type === 'music')?.volume ?? 0.75,
                ambient: layers.find((layer) => layer.type === 'environment')?.volume ?? 0.65,
                cues: 1
            },
            fadeIn: Number(root?.querySelector('#sound-scene-default-fade-in')?.value ?? 2),
            fadeOut: Number(root?.querySelector('#sound-scene-default-fade-out')?.value ?? 2),
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
