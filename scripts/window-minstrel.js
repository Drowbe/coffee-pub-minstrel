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

const coreAudioSettingKeyCache = new Map();

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

function resolveCoreAudioSettingKey(channel) {
    if (coreAudioSettingKeyCache.has(channel)) {
        return coreAudioSettingKeyCache.get(channel);
    }
    const settings = Array.from(game.settings?.settings?.keys?.() ?? []).filter((key) => key.startsWith('core.'));
    const exactCandidates = {
        music: ['globalPlaylistVolume', 'globalMusicVolume', 'playlistVolume'],
        environment: ['globalAmbientVolume', 'globalEnvironmentVolume', 'ambientVolume', 'environmentVolume'],
        interface: ['globalInterfaceVolume', 'interfaceVolume']
    };

    for (const candidate of exactCandidates[channel] ?? []) {
        const fullKey = `core.${candidate}`;
        if (settings.includes(fullKey)) {
            coreAudioSettingKeyCache.set(channel, candidate);
            return candidate;
        }
    }

    const fuzzyKeywords = {
        music: ['playlist', 'music', 'volume'],
        environment: ['ambient', 'environment', 'volume'],
        interface: ['interface', 'volume']
    };

    const match = settings.find((key) => {
        const normalized = key.toLowerCase();
        return (fuzzyKeywords[channel] ?? []).every((keyword) => normalized.includes(keyword));
    });

    const resolved = match?.replace(/^core\./, '') ?? null;
    coreAudioSettingKeyCache.set(channel, resolved);
    return resolved;
}

function getCoreAudioVolume(channel, fallback = 0.8) {
    const key = resolveCoreAudioSettingKey(channel);
    if (!key) return fallback;
    const value = Number(game.settings.get('core', key));
    return Number.isFinite(value) ? value : fallback;
}

async function setCoreAudioVolume(channel, value) {
    const key = resolveCoreAudioSettingKey(channel);
    if (!key) return false;
    const clamped = Math.max(0, Math.min(1, Number(value) || 0));
    await game.settings.set('core', key, clamped);
    return true;
}

function normalizePlayedSound(played) {
    if (Array.isArray(played)) return played.find((entry) => entry && typeof entry.stop === 'function') ?? null;
    return played && typeof played.stop === 'function' ? played : null;
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

function createInputRestoreState(input) {
    if (!input?.id) return null;
    return {
        id: input.id,
        start: Number(input.selectionStart ?? 0),
        end: Number(input.selectionEnd ?? 0)
    };
}

function captureScrollRestoreState(root) {
    if (!root) return [];
    return Array.from(root.querySelectorAll('.minstrel-column-list, .minstrel-playlist-list, .minstrel-scene-editor-scroll'))
        .map((element, index) => ({
            index,
            scrollTop: Number(element.scrollTop ?? 0),
            scrollLeft: Number(element.scrollLeft ?? 0)
        }));
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
        stopTrack: (_event, button) => MinstrelWindow._withWindow(async () => {
            const ref = PlaylistManager.parseTrackRefValue(button.dataset.value);
            if (!ref) return;
            await PlaylistManager.stopTrack(ref);
            MinstrelManager.requestUiRefresh();
        }),
        toggleFavoriteTrack: (_event, button) => MinstrelWindow._withWindow(async () => {
            const ref = PlaylistManager.parseTrackRefValue(button.dataset.value);
            if (!ref) return;
            await PlaylistManager.toggleFavorite(ref);
            MinstrelManager.requestUiRefresh();
        }),
        toggleTrackRepeat: (_event, button) => MinstrelWindow._withWindow(async () => {
            const ref = PlaylistManager.parseTrackRefValue(button.dataset.value);
            if (!ref) return;
            await PlaylistManager.toggleTrackRepeat(ref);
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
        playPlaylist: (_event, button) => MinstrelWindow._withWindow(async () => {
            if (!button.dataset.value) return;
            await PlaylistManager.playPlaylist(button.dataset.value);
            MinstrelManager.requestUiRefresh();
        }),
        stopPlaylist: (_event, button) => MinstrelWindow._withWindow(async () => {
            if (!button.dataset.value) return;
            await PlaylistManager.stopPlaylist(button.dataset.value);
            MinstrelManager.requestUiRefresh();
        }),
        selectSoundScene: (_event, button) => MinstrelWindow._withWindow((windowRef) => windowRef.setSelectedSoundSceneId(button.dataset.value ?? null)),
        newSoundScene: () => MinstrelWindow._withWindow((windowRef) => windowRef.setSelectedSoundSceneId(null)),
        saveSoundScene: () => MinstrelWindow._withWindow(async (windowRef) => {
            const soundScene = windowRef._collectSoundSceneForm();
            if (!soundScene) return;
            const wasActive = !!soundScene.id && soundScene.id === RuntimeManager.getState().activeSoundSceneId;
            const savedScene = await SoundSceneManager.saveSoundScene(soundScene);
            if (!savedScene) return;
            windowRef.setSoundSceneDraft(savedScene);
            await windowRef.setSelectedSoundSceneId(savedScene.id);
            if (wasActive) {
                await SoundSceneManager.activateSoundScene(savedScene.id, { savePrevious: false });
            }
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
            const scrollRestoreState = captureScrollRestoreState(windowRef._getRoot());
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
            void windowRef._renderWithUiRestore({ scrollRestoreState });
        }),
        previewSceneSelectorSound: (_event, button) => MinstrelWindow._withWindow(async (windowRef) => {
            const trackRef = PlaylistManager.parseTrackRefValue(button.dataset.value);
            if (!trackRef) return;
            const scrollRestoreState = captureScrollRestoreState(windowRef._getRoot());
            const currentPreviewTrack = RuntimeManager.getPreviewTrack();
            const isSamePreview = !!currentPreviewTrack
                && currentPreviewTrack.playlistId === trackRef.playlistId
                && currentPreviewTrack.soundId === trackRef.soundId;

            if (isSamePreview) {
                RuntimeManager.clearPreviewState();
                await windowRef._renderWithUiRestore({ scrollRestoreState });
                return;
            }

            RuntimeManager.clearPreviewState();
            const played = await foundry.audio.AudioHelper.play({
                src: trackRef.path,
                volume: 0.8,
                autoplay: true,
                loop: false
            }, false);
            const previewSound = normalizePlayedSound(played);
            RuntimeManager.setPreviewTrack(trackRef);
            RuntimeManager.setPreviewSound(previewSound);
            const durationSeconds = await PlaylistManager.getTrackDurationSeconds(trackRef);
            if (durationSeconds > 0) {
                const timeoutId = window.setTimeout(() => {
                    RuntimeManager.clearPreviewState();
                    MinstrelManager.requestUiRefresh();
                }, (durationSeconds * 1000) + 100);
                RuntimeManager.setPreviewTimeout(timeoutId);
            }
            await windowRef._renderWithUiRestore({ scrollRestoreState });
        }),
        removeSceneLayer: (_event, button) => MinstrelWindow._withWindow((windowRef) => {
            const scrollRestoreState = captureScrollRestoreState(windowRef._getRoot());
            const sceneDraft = windowRef._collectSoundSceneForm();
            const layerId = button.dataset.value;
            if (!sceneDraft || !layerId) return;
            sceneDraft.layers = (sceneDraft.layers ?? []).filter((layer) => layer.id !== layerId);
            windowRef.setSoundSceneDraft(sceneDraft);
            void windowRef._renderWithUiRestore({ scrollRestoreState });
        }),
        setSceneSoundFilter: (_event, button) => MinstrelWindow._withWindow(async (windowRef) => {
            await windowRef.setSceneWorkspaceState({
                sceneSoundFilter: button.dataset.value ?? 'all'
            });
        }),
        clearSceneSearch: () => MinstrelWindow._withWindow(async (windowRef) => {
            await windowRef.setSceneWorkspaceState({ sceneSearch: '' });
        }),
        clearSceneSoundSearch: () => MinstrelWindow._withWindow(async (windowRef) => {
            await windowRef.setSceneWorkspaceState({ sceneSoundSearch: '' });
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
            const savedCue = await CueManager.saveCue(cue);
            if (!savedCue) return;
            await windowRef.setSelectedCueId(savedCue.id);
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
        this._windowStateSaveTimer = null;
        this._pendingWindowState = {};
        this._boundInputHandler = this._handleRootInput.bind(this);
        this._boundChangeHandler = this._handleRootChange.bind(this);
        this._listenerRoot = null;
        this._sceneDurationSeconds = new Map();
        this._pendingSceneDurationKeys = new Set();
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
        this._queueWindowStateSave({ bounds: position }, { delayMs: 750 });
    }

    async _preClose() {
        RuntimeManager.clearPreviewState();
        this._clearSearchTimers();
        this._detachRootListeners();
        if (this._windowStateSaveTimer) {
            window.clearTimeout(this._windowStateSaveTimer);
            this._windowStateSaveTimer = null;
        }
        if (this.position) this._pendingWindowState.bounds = this.position;
        await this._flushWindowStateSave();
        this.constructor._ref = null;
        RuntimeManager.clearWindowRef(this);
        return super._preClose?.();
    }

    _clearSearchTimers() {
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
    }

    _queueWindowStateSave(updates = {}, { delayMs = 400 } = {}) {
        this._pendingWindowState = {
            ...this._pendingWindowState,
            ...foundry.utils.deepClone(updates)
        };

        if (this._windowStateSaveTimer) {
            window.clearTimeout(this._windowStateSaveTimer);
        }

        if (delayMs <= 0) {
            void this._flushWindowStateSave();
            return;
        }

        this._windowStateSaveTimer = window.setTimeout(() => {
            this._windowStateSaveTimer = null;
            void this._flushWindowStateSave();
        }, delayMs);
    }

    async _flushWindowStateSave() {
        const updates = this._pendingWindowState;
        this._pendingWindowState = {};
        if (!Object.keys(updates).length) return;
        await StorageManager.saveWindowState(updates);
    }

    _attachRootListeners(root = this._getRoot()) {
        if (!root) return;
        this.constructor._ref = this;
        if (this._listenerRoot === root) return;
        this._detachRootListeners();
        root.addEventListener('input', this._boundInputHandler);
        root.addEventListener('change', this._boundChangeHandler);
        this._listenerRoot = root;
    }

    _detachRootListeners() {
        if (!this._listenerRoot) return;
        this._listenerRoot.removeEventListener('input', this._boundInputHandler);
        this._listenerRoot.removeEventListener('change', this._boundChangeHandler);
        this._listenerRoot = null;
    }

    _handleRootInput(event) {
        const target = event.target;
        if (!target) return;

        if (target.id === 'minstrel-playlist-search') {
            const search = String(target.value ?? '').trim();
            if (this._playlistSearchTimer) {
                window.clearTimeout(this._playlistSearchTimer);
                this._playlistSearchTimer = null;
            }

            if (!search.length) {
                void this.setPlaylistFilters({ playlistSearch: '' }, createInputRestoreState(target));
                return;
            }

            if (search.length < 3) return;

            this._playlistSearchTimer = window.setTimeout(() => {
                this._playlistSearchTimer = null;
                void this.setPlaylistFilters({ playlistSearch: search }, createInputRestoreState(target));
            }, 250);
            return;
        }

        if (target.id === 'minstrel-scene-search') {
            const search = String(target.value ?? '').trim();
            if (this._sceneSearchTimer) {
                window.clearTimeout(this._sceneSearchTimer);
                this._sceneSearchTimer = null;
            }
            if (!search.length) {
                void this.setSceneWorkspaceState({ sceneSearch: '' }, createInputRestoreState(target));
                return;
            }
            if (search.length < 3) return;
            this._sceneSearchTimer = window.setTimeout(() => {
                this._sceneSearchTimer = null;
                void this.setSceneWorkspaceState({ sceneSearch: search }, createInputRestoreState(target));
            }, 250);
            return;
        }

        if (target.id === 'minstrel-scene-sound-search') {
            const search = String(target.value ?? '').trim();
            if (this._sceneSoundSearchTimer) {
                window.clearTimeout(this._sceneSoundSearchTimer);
                this._sceneSoundSearchTimer = null;
            }
            if (!search.length) {
                void this.setSceneWorkspaceState({ sceneSoundSearch: '' }, createInputRestoreState(target));
                return;
            }
            if (search.length < 3) return;
            this._sceneSoundSearchTimer = window.setTimeout(() => {
                this._sceneSoundSearchTimer = null;
                void this.setSceneWorkspaceState({ sceneSoundSearch: search }, createInputRestoreState(target));
            }, 250);
            return;
        }

        if (target.matches?.('[data-scene-layer-field="volume"], [data-track-volume]')) {
            const slider = target.closest('.minstrel-layer-slider');
            const valueLabel = slider?.querySelector('span');
            if (valueLabel) {
                valueLabel.textContent = `${Number(target.value ?? 0)}%`;
            }
            return;
        }

        if (target.matches?.('[data-scene-layer-field="loopMode"]')) {
            const row = target.closest('[data-scene-layer-row]');
            if (row?.dataset.layerType === 'scheduled-one-shot') {
                const frequencyField = row.querySelector('[data-scene-layer-frequency]');
                frequencyField?.classList.toggle('is-hidden', !target.checked);
            }
            return;
        }

        if (target.matches?.('[data-global-audio-volume]')) {
            const valueLabel = target.closest('.minstrel-metric')?.querySelector('[data-global-audio-value]');
            if (valueLabel) {
                valueLabel.textContent = `${Number(target.value ?? 0)}%`;
            }
        }
    }

    _handleRootChange(event) {
        const target = event.target;
        if (!target) return;

        if (target.matches?.('[data-track-volume]')) {
            const ref = PlaylistManager.parseTrackRefValue(target.dataset.trackVolume);
            if (!ref) return;
            const volume = Math.max(0, Math.min(1, (Number(target.value ?? 0) || 0) / 100));
            void PlaylistManager.setTrackVolume(ref, volume).then(() => {
                MinstrelManager.requestUiRefresh();
            });
            return;
        }

        if (!target.matches?.('[data-global-audio-volume]')) return;

        const channel = String(target.dataset.globalAudioVolume ?? '').trim();
        const volume = Math.max(0, Math.min(1, (Number(target.value ?? 0) || 0) / 100));
        void setCoreAudioVolume(channel, volume).then(() => {
            MinstrelManager.requestUiRefresh();
        });
    }

    async _onFirstRender(context, options) {
        await super._onFirstRender(context, options);
        this._attachRootListeners();
    }

    activateListeners(html) {
        super.activateListeners(html);
        const root = html?.[0] ?? html ?? this._getRoot();
        this._attachRootListeners(root);
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

    async _renderWithUiRestore({ inputRestoreState = null, scrollRestoreState = null } = {}) {
        await this.render(true);
        requestAnimationFrame(() => {
            const root = this._getRoot();
            if (Array.isArray(scrollRestoreState) && scrollRestoreState.length) {
                const scrollables = Array.from(root?.querySelectorAll('.minstrel-column-list, .minstrel-playlist-list, .minstrel-scene-editor-scroll') ?? []);
                for (const entry of scrollRestoreState) {
                    const element = scrollables[entry.index];
                    if (!element) continue;
                    element.scrollTop = entry.scrollTop;
                    element.scrollLeft = entry.scrollLeft;
                }
            }

            if (!inputRestoreState?.id) return;
            const input = root?.querySelector(`#${inputRestoreState.id}`);
            if (!input) return;
            input.focus?.();
            input.setSelectionRange?.(inputRestoreState.start, inputRestoreState.end);
        });
    }

    async _renderWithInputRestore(inputRestoreState = null) {
        await this._renderWithUiRestore({
            inputRestoreState,
            scrollRestoreState: captureScrollRestoreState(this._getRoot())
        });
    }

    async refreshPreservingUi() {
        await this._renderWithUiRestore({
            scrollRestoreState: captureScrollRestoreState(this._getRoot())
        });
    }

    _getTrackDurationCacheKey(trackRef) {
        if (!trackRef?.playlistId || !trackRef?.soundId) return '';
        return `${trackRef.playlistId}::${trackRef.soundId}`;
    }

    _getCachedTrackDurationSeconds(trackRef) {
        const key = this._getTrackDurationCacheKey(trackRef);
        if (!key) return 0;
        const cached = this._sceneDurationSeconds.get(key);
        if (typeof cached === 'number') return cached;
        if (this._pendingSceneDurationKeys.has(key)) return 0;

        this._pendingSceneDurationKeys.add(key);
        void PlaylistManager.getTrackDurationSeconds(trackRef)
            .then((durationSeconds) => {
                this._sceneDurationSeconds.set(key, Math.max(0, Number(durationSeconds) || 0));
            })
            .catch(() => {
                this._sceneDurationSeconds.set(key, 0);
            })
            .finally(() => {
                this._pendingSceneDurationKeys.delete(key);
                if (RuntimeManager.getState().windowRef === this) {
                    void this.refreshPreservingUi();
                }
            });

        return 0;
    }

    _buildSceneLayerPresentation(layer, longestSceneLayerDuration, isSelectedSceneActive) {
        const durationSeconds = this._getCachedTrackDurationSeconds(layer.trackRef);
        return {
            ...layer,
            trackValue: toTrackValue(layer.trackRef),
            volumePercent: Math.round((Number(layer.volume ?? (layer.type === 'music' ? 0.75 : layer.type === 'scheduled-one-shot' ? 1 : 0.65)) || 0) * 100),
            ...buildTimelinePresentation(layer, durationSeconds, longestSceneLayerDuration, isSelectedSceneActive)
        };
    }

    _getBaseBodyContext(tabId) {
        return {
            isDashboard: tabId === 'dashboard',
            isPlaylists: tabId === 'playlists',
            isSoundScenes: tabId === 'soundScenes',
            isCues: tabId === 'cues',
            isAutomation: tabId === 'automation'
        };
    }

    async getData() {
        const activeTab = this.uiState.tab;
        const dashboard = MinstrelManager.getDashboardData();
        let bodyContext = this._getBaseBodyContext(activeTab);

        if (activeTab === 'dashboard') {
            bodyContext = {
                ...bodyContext,
                dashboard
            };
        } else if (activeTab === 'playlists') {
            const playlistSummary = PlaylistManager.getPlaylistSummary();
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

            bodyContext = {
                ...bodyContext,
                playlistSummary: filteredPlaylistSummary,
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
            };
        } else if (activeTab === 'soundScenes') {
            const soundScenes = SoundSceneManager.getSoundScenes();
            const trackOptions = PlaylistManager.getTrackOptions();
            const selectedSoundScene = cloneSoundScene(this.uiState.soundSceneDraft ?? (this.uiState.selectedSoundSceneId
                ? soundScenes.find((scene) => scene.id === this.uiState.selectedSoundSceneId)
                : StorageManager.createBlankSoundScene()));
            const selectedSoundSceneTagText = Array.isArray(selectedSoundScene?.tags) ? selectedSoundScene.tags.join(', ') : '';
            const selectedSceneLayers = Array.isArray(selectedSoundScene?.layers) ? selectedSoundScene.layers : [];
            const selectedSceneMusicLayers = selectedSceneLayers.filter((layer) => layer.type === 'music');
            const selectedSceneEnvironmentLayers = selectedSceneLayers.filter((layer) => layer.type === 'environment');
            const selectedSceneScheduledLayers = selectedSceneLayers.filter((layer) => layer.type === 'scheduled-one-shot');
            const selectedSceneLayerDurations = selectedSceneLayers.map((layer) => this._getCachedTrackDurationSeconds(layer.trackRef));
            const longestSceneLayerDuration = Math.max(1, ...selectedSceneLayerDurations);
            const isSelectedSceneActive = !!selectedSoundScene?.id && selectedSoundScene.id === RuntimeManager.getState().activeSoundSceneId;
            const activeSoundSceneId = RuntimeManager.getState().activeSoundSceneId;
            const sceneSearch = this.uiState.sceneSearch.trim().toLowerCase();
            const filteredSoundScenes = soundScenes.filter((scene) => {
                if (!sceneSearch) return true;
                const haystack = [scene.name, scene.description, ...(scene.tags ?? [])].join(' ').toLowerCase();
                return haystack.includes(sceneSearch);
            }).map((scene) => ({
                ...scene,
                isActive: scene.id === activeSoundSceneId,
                cardStyle: scene.backgroundImage
                    ? `background-image: linear-gradient(rgba(14, 10, 8, 0.72), rgba(14, 10, 8, 0.78)), url('${scene.backgroundImage}');`
                    : ''
            }));
            const sceneSoundSearch = this.uiState.sceneSoundSearch.trim().toLowerCase();
            const sceneSoundFilter = this.uiState.sceneSoundFilter;
            const previewTrack = RuntimeManager.getPreviewTrack();
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
                iconClass: option.channel === 'music' ? 'fa-solid fa-music-note' : option.channel === 'cue' ? 'fa-solid fa-volume' : 'fa-solid fa-waveform',
                isPreviewPlaying: !!previewTrack
                    && previewTrack.playlistId === option.value.split('::')[0]
                    && previewTrack.soundId === option.value.split('::')[1]
            })).sort((a, b) => {
                const soundCompare = String(a.soundName ?? '').localeCompare(String(b.soundName ?? ''), undefined, { sensitivity: 'base' });
                if (soundCompare !== 0) return soundCompare;
                return String(a.playlistName ?? '').localeCompare(String(b.playlistName ?? ''), undefined, { sensitivity: 'base' });
            });

            bodyContext = {
                ...bodyContext,
                filteredSoundScenes,
                sceneSearch: this.uiState.sceneSearch,
                sceneSoundSearch: this.uiState.sceneSoundSearch,
                sceneSoundFilter: this.uiState.sceneSoundFilter,
                isSceneSoundFilterAll: this.uiState.sceneSoundFilter === 'all',
                isSceneSoundFilterMusic: this.uiState.sceneSoundFilter === 'music',
                isSceneSoundFilterEnvironment: this.uiState.sceneSoundFilter === 'environment',
                isSceneSoundFilterOneShot: this.uiState.sceneSoundFilter === 'scheduled-one-shot',
                sceneSelectorOptions,
                soundScenes,
                selectedSoundScene,
                selectedSoundSceneIsActive: isSelectedSceneActive,
                selectedSoundSceneTagText,
                selectedSceneMusicLayers: selectedSceneMusicLayers.map((layer) => this._buildSceneLayerPresentation(layer, longestSceneLayerDuration, isSelectedSceneActive)),
                selectedSceneEnvironmentLayers: selectedSceneEnvironmentLayers.map((layer) => this._buildSceneLayerPresentation(layer, longestSceneLayerDuration, isSelectedSceneActive)),
                selectedSceneScheduledLayers: selectedSceneScheduledLayers.map((layer) => this._buildSceneLayerPresentation(layer, longestSceneLayerDuration, isSelectedSceneActive)),
                activeSoundSceneId
            };
        } else if (activeTab === 'cues') {
            const cues = CueManager.getCues();
            const trackOptions = PlaylistManager.getTrackOptions();
            const cueTrackOptions = trackOptions.filter((option) => option.channel === 'cue');
            const selectedCue = this.uiState.selectedCueId
                ? cues.find((cue) => cue.id === this.uiState.selectedCueId) ?? StorageManager.createBlankCue()
                : StorageManager.createBlankCue();

            bodyContext = {
                ...bodyContext,
                cues,
                selectedCue,
                cueTrackOptions: buildTrackOptions(cueTrackOptions, toTrackValue(selectedCue?.track))
            };
        } else if (activeTab === 'automation') {
            const rules = AutomationManager.getRules();
            const soundScenes = SoundSceneManager.getSoundScenes();
            const selectedRule = this.uiState.selectedRuleId
                ? rules.find((rule) => rule.id === this.uiState.selectedRuleId) ?? StorageManager.createBlankAutomationRule()
                : StorageManager.createBlankAutomationRule();
            const ruleSoundSceneId = selectedRule?.soundSceneId ?? '';

            bodyContext = {
                ...bodyContext,
                rules,
                selectedRule,
                ruleEventOptions: [
                    { value: 'combatStart', label: 'combatStart', selected: selectedRule?.eventType === 'combatStart' },
                    { value: 'combatEnd', label: 'combatEnd', selected: selectedRule?.eventType === 'combatEnd' },
                    { value: 'manualTrigger', label: 'manualTrigger', selected: selectedRule?.eventType === 'manualTrigger' }
                ],
                ruleSoundSceneOptions: soundScenes.map((scene) => ({
                    id: scene.id,
                    name: scene.name,
                    selected: scene.id === ruleSoundSceneId
                }))
            };
        }

        const bodyContent = await foundry.applications.handlebars.renderTemplate('modules/coffee-pub-minstrel/templates/partials/window-minstrel-body.hbs', bodyContext);

        const tabs = [
            ['dashboard', 'Dashboard', 'fa-solid fa-wave-square'],
            ['playlists', 'Playlists', 'fa-solid fa-list-music'],
            ['soundScenes', 'Scenes', 'fa-solid fa-landmark-dome'],
            ['cues', 'Cues', 'fa-solid fa-bolt'],
            ['automation', 'Automation', 'fa-solid fa-diagram-project']
        ];

        const nowPlayingLabel = dashboard.activeSoundScene?.name
            ?? dashboard.nowPlaying.music?.playlistName
            ?? dashboard.nowPlaying.activeTracks[0]?.playlistName
            ?? 'None';
        const globalMusicVolume = Math.round(getCoreAudioVolume('music', 0.8) * 100);
        const globalEnvironmentVolume = Math.round(getCoreAudioVolume('environment', 0.8) * 100);
        const globalInterfaceVolume = Math.round(getCoreAudioVolume('interface', 0.8) * 100);

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
            optionBarRight: '',
            toolsContent: `
                <div class="minstrel-toolbar-metrics">
                    <div class="minstrel-metric"><span class="minstrel-metric-label">Now Playing</span><span class="minstrel-metric-value">${nowPlayingLabel}</span></div>
                    <div class="minstrel-metric minstrel-metric-volume">
                        <span class="minstrel-metric-label">Music Volume</span>
                        <label class="minstrel-toolbar-slider" title="Global Music Volume" aria-label="Global Music Volume">
                            <input type="range" min="0" max="100" step="1" value="${globalMusicVolume}" data-global-audio-volume="music" />
                            <span data-global-audio-value>${globalMusicVolume}%</span>
                        </label>
                    </div>
                    <div class="minstrel-metric minstrel-metric-volume">
                        <span class="minstrel-metric-label">Environment Volume</span>
                        <label class="minstrel-toolbar-slider" title="Global Environment Volume" aria-label="Global Environment Volume">
                            <input type="range" min="0" max="100" step="1" value="${globalEnvironmentVolume}" data-global-audio-volume="environment" />
                            <span data-global-audio-value>${globalEnvironmentVolume}%</span>
                        </label>
                    </div>
                    <div class="minstrel-metric minstrel-metric-volume">
                        <span class="minstrel-metric-label">Interface Volume</span>
                        <label class="minstrel-toolbar-slider" title="Global Interface Volume" aria-label="Global Interface Volume">
                            <input type="range" min="0" max="100" step="1" value="${globalInterfaceVolume}" data-global-audio-volume="interface" />
                            <span data-global-audio-value>${globalInterfaceVolume}%</span>
                        </label>
                    </div>
                </div>
            `,
            bodyContent,
            actionBarLeft: [
                buildActionButton('refreshWindow', 'Refresh', 'fa-solid fa-rotate-right', { variant: 'ghost' }),
                buildActionButton('restoreSnapshot', 'Restore', 'fa-solid fa-clock-rotate-left', { variant: 'ghost' })
            ].join(''),
            actionBarRight: [
                buildActionButton('stopMusicLayer', 'Stop Music', 'fa-solid fa-circle-stop', { variant: 'ghost' }),
                buildActionButton('stopAmbientLayer', 'Stop Environment', 'fa-solid fa-wind', { variant: 'ghost' }),
                buildActionButton('stopAllAudio', 'Stop All', 'fa-solid fa-volume-xmark', { variant: 'danger' })
            ].join('')
        };
    }

    async selectTab(tabId) {
        this.uiState.tab = tabId;
        this._queueWindowStateSave({ tab: tabId });
        this.render(true);
    }

    async setSelectedSoundSceneId(soundSceneId) {
        this.uiState.selectedSoundSceneId = soundSceneId ?? null;
        this.uiState.soundSceneDraft = cloneSoundScene(soundSceneId ? SoundSceneManager.getSoundScene(soundSceneId) : StorageManager.createBlankSoundScene());
        this._queueWindowStateSave({ selectedSoundSceneId: this.uiState.selectedSoundSceneId });
        this.render(true);
    }

    setSoundSceneDraft(soundScene) {
        this.uiState.soundSceneDraft = cloneSoundScene(soundScene);
    }

    async setSelectedCueId(cueId) {
        this.uiState.selectedCueId = cueId ?? null;
        this._queueWindowStateSave({ selectedCueId: this.uiState.selectedCueId });
        this.render(true);
    }

    async setSelectedRuleId(ruleId) {
        this.uiState.selectedRuleId = ruleId ?? null;
        this._queueWindowStateSave({ selectedRuleId: this.uiState.selectedRuleId });
        this.render(true);
    }

    async setPlaylistFilters(updates = {}, restoreState = null) {
        this.uiState.playlistSearch = updates.playlistSearch ?? this.uiState.playlistSearch;
        this.uiState.playlistChannelFilter = updates.playlistChannelFilter ?? this.uiState.playlistChannelFilter;
        this.uiState.playlistStatusFilter = updates.playlistStatusFilter ?? this.uiState.playlistStatusFilter;
        this._queueWindowStateSave({
            playlistSearch: this.uiState.playlistSearch,
            playlistChannelFilter: this.uiState.playlistChannelFilter,
            playlistStatusFilter: this.uiState.playlistStatusFilter
        });
        await this._renderWithInputRestore(restoreState);
    }

    async setSceneWorkspaceState(updates = {}, restoreState = null) {
        this.uiState.sceneSearch = updates.sceneSearch ?? this.uiState.sceneSearch;
        this.uiState.sceneSoundSearch = updates.sceneSoundSearch ?? this.uiState.sceneSoundSearch;
        this.uiState.sceneSoundFilter = updates.sceneSoundFilter ?? this.uiState.sceneSoundFilter;
        this._queueWindowStateSave({
            sceneSearch: this.uiState.sceneSearch,
            sceneSoundSearch: this.uiState.sceneSoundSearch,
            sceneSoundFilter: this.uiState.sceneSoundFilter
        });
        await this._renderWithInputRestore(restoreState);
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
            id: this.uiState.selectedSoundSceneId ?? null,
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
            id: this.uiState.selectedCueId ?? null,
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
