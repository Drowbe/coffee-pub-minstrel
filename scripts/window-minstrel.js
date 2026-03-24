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

function getTimelineWidthPercent(durationSeconds, longestDuration, minimumPercent = 0.6) {
    if (longestDuration <= 0 || durationSeconds <= 0) return 0;
    return Math.max(minimumPercent, Math.min(100, (durationSeconds / longestDuration) * 100));
}

function getSceneClockProgress(clock) {
    const durationSeconds = Math.max(1, Number(clock?.durationSeconds) || 1);
    const startedAt = Number(clock?.startedAt) || 0;
    const elapsedOffsetMs = Number(clock?.elapsedOffsetMs) || 0;
    const elapsedSeconds = Math.max(0, ((Date.now() - startedAt) + elapsedOffsetMs) / 1000);
    const cycleSeconds = elapsedSeconds % durationSeconds;
    const progressPercent = Math.max(0, Math.min(100, (cycleSeconds / durationSeconds) * 100));
    return {
        elapsedSeconds,
        cycleSeconds,
        durationSeconds,
        progressPercent
    };
}

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function escapeCssUrl(value) {
    return String(value ?? '').replaceAll('\\', '\\\\').replaceAll('"', '\\"');
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
    const startDelaySeconds = Math.max(
        0,
        Math.max(Number(layer?.startDelayMs) || 0, frequencySeconds * 1000)
    ) / 1000;

    const markers = [];
    for (let offset = startDelaySeconds || frequencySeconds; offset < longestDuration && markers.length < 24; offset += frequencySeconds) {
        markers.push(Math.max(0, Math.min(100, (offset / longestDuration) * 100)));
    }
    return markers;
}

function buildTimelineRepeatSegments(layer, durationSeconds, longestDuration) {
    const startDelaySeconds = Math.max(0, Number(layer?.startDelayMs) || 0) / 1000;
    const loopMode = String(layer?.loopMode ?? 'loop').trim() || 'loop';
    const loopEnabled = loopMode !== 'once';

    if (layer?.type === 'environment') {
        if (longestDuration <= 0 || durationSeconds <= 0) return [];
        const segmentWidthPercent = getTimelineWidthPercent(durationSeconds, longestDuration);
        if (!loopEnabled) {
            const leftPercent = Math.max(0, Math.min(100, (startDelaySeconds / longestDuration) * 100));
            const availableWidth = Math.max(0, 100 - leftPercent);
            return [{
                leftPercent,
                widthPercent: Math.min(availableWidth, segmentWidthPercent)
            }];
        }

        const segments = [];
        const repeatEverySeconds = Math.max(durationSeconds, durationSeconds + startDelaySeconds);
        for (let offset = startDelaySeconds; offset < longestDuration && segments.length < 24; offset += repeatEverySeconds) {
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

    if (layer?.type !== 'scheduled-one-shot') return [];
    if (String(layer?.loopMode ?? 'loop') !== 'loop') return [];
    const frequencySeconds = Math.max(1, Number(layer?.frequencySeconds) || 0);
    if (!frequencySeconds || longestDuration <= 0 || durationSeconds <= 0) return [];
    const scheduledStartDelaySeconds = Math.max(
        0,
        Math.max(Number(layer?.startDelayMs) || 0, frequencySeconds * 1000)
    ) / 1000;

    const segmentWidthPercent = getTimelineWidthPercent(durationSeconds, longestDuration);
    const segments = [];

    for (let offset = scheduledStartDelaySeconds; offset < longestDuration && segments.length < 24; offset += frequencySeconds) {
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
    const loopMode = String(layer?.loopMode ?? 'loop').trim() || 'loop';
    const loopEnabled = loopMode !== 'once';
    const eventOnly = layer?.type === 'scheduled-one-shot' && !loopEnabled;
    const delayedEnvironment = layer?.type === 'environment' && (Math.max(0, Number(layer?.startDelayMs) || 0) / 1000) > 0;
    const scheduledTimingSeconds = layer?.type === 'scheduled-one-shot'
        ? Math.max(
            1,
            Math.max(
                Number(layer?.startDelayMs) || 0,
                (Number(layer?.frequencySeconds) || 0) * 1000
            ) / 1000
        )
        : 0;
    const startDelaySeconds = layer?.type === 'scheduled-one-shot'
        ? scheduledTimingSeconds
        : Math.max(0, Number(layer?.startDelayMs) || 0) / 1000;
    const timelineWidthPercent = getTimelineWidthPercent(durationSeconds, longestDuration);
    const behaviorText = layer?.type === 'scheduled-one-shot'
        ? (loopEnabled ? `${Math.max(1, Number(layer?.frequencySeconds) || 120)}s repeat` : 'Single event')
        : layer?.type === 'music'
            ? (loopMode === 'single' ? 'Repeat single' : loopMode === 'loop' ? 'Repeat all' : 'Single pass')
            : (loopEnabled ? 'Looping' : 'Single pass');
    const delayText = startDelaySeconds > 0 ? `${Math.round(startDelaySeconds)}s delay` : 'Immediate';
    const timelineRepeatSegments = buildTimelineRepeatSegments(layer, durationSeconds, longestDuration);
    const timelineEventLeftPercent = eventOnly && longestDuration > 0
        ? Math.max(0, Math.min(100, (scheduledTimingSeconds / longestDuration) * 100))
        : 0;
    const timelineUseDot = durationSeconds > 0 && durationSeconds <= 4;
    const timelineDotMarkers = timelineUseDot
        ? (timelineRepeatSegments.length
            ? timelineRepeatSegments.map((segment) => segment.leftPercent)
            : [layer?.type === 'scheduled-one-shot'
                ? timelineEventLeftPercent
                : Math.max(0, Math.min(100, (startDelaySeconds / Math.max(1, longestDuration)) * 100))])
        : [];

    return {
        durationSeconds,
        durationLabel: formatDurationLabel(durationSeconds),
        loopMode,
        loopEnabled,
        timelineShowBar: layer?.type === 'scheduled-one-shot'
            ? false
            : layer?.type === 'environment'
                ? !loopEnabled && durationSeconds > 0 && !timelineUseDot
                : !eventOnly && !delayedEnvironment && durationSeconds > 0,
        timelineSingleEvent: eventOnly,
        timelineShowStartMarker: layer?.type !== 'scheduled-one-shot' && !delayedEnvironment,
        timelineWidthPercent,
        timelineRepeatMarkers: timelineUseDot ? [] : buildTimelineRepeatMarkers(layer, longestDuration),
        timelineRepeatSegments: timelineUseDot ? [] : timelineRepeatSegments,
        timelineEventLeftPercent,
        timelineUseDot,
        timelineDotMarkers,
        timelineIsActive: !!isActive,
        timelineTooltip: [
            `${getLayerTypeLabel(layer?.type)}: ${layer?.trackRef?.soundName ?? 'Unknown'}`,
            `Duration: ${formatDurationLabel(durationSeconds)}`,
            `Behavior: ${behaviorText}`,
            `Start: ${delayText}`,
            `Source: ${layer?.trackRef?.playlistName ?? 'Unknown Playlist'}`
        ].join('\n')
    };
}

function getMusicLoopPresentation(loopMode) {
    const normalized = String(loopMode ?? 'once').trim() || 'once';
    if (normalized === 'single') {
        return {
            loopMode: 'single',
            loopIconClass: 'fa-solid fa-repeat-1',
            loopTitle: 'Repeat Single',
            loopIsActive: true
        };
    }
    if (normalized === 'loop') {
        return {
            loopMode: 'loop',
            loopIconClass: 'fa-solid fa-repeat',
            loopTitle: 'Repeat All',
            loopIsActive: true
        };
    }
    return {
        loopMode: 'once',
        loopIconClass: 'fa-solid fa-repeat',
        loopTitle: 'Repeat Off',
        loopIsActive: false
    };
}

function getNextMusicLoopMode(loopMode) {
    const normalized = String(loopMode ?? 'once').trim() || 'once';
    if (normalized === 'once') return 'loop';
    if (normalized === 'loop') return 'single';
    return 'once';
}

function toTrackValue(trackRef) {
    return trackRef?.playlistId && trackRef?.soundId ? `${trackRef.playlistId}::${trackRef.soundId}` : '';
}

function isSameTrackRef(left, right) {
    return !!left && !!right && String(left.playlistId ?? '') === String(right.playlistId ?? '') && String(left.soundId ?? '') === String(right.soundId ?? '') ;
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

function cloneAutomationRule(rule) {
    return foundry.utils.deepClone(rule ?? StorageManager.createBlankAutomationRule());
}

function formatAutomationMinutes(minutes) {
    const totalMinutes = Math.max(0, Math.min(1439, Number(minutes) || 0));
    let hour = Math.floor(totalMinutes / 60);
    const minute = totalMinutes % 60;
    const period = hour >= 12 ? 'PM' : 'AM';
    hour = hour % 12;
    if (hour === 0) hour = 12;
    return `${hour}:${String(minute).padStart(2, '0')} ${period}`;
}

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

function setElementVisible(element, visible) {
    if (!element) return;
    element.style.display = visible ? '' : 'none';
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
        toggleSceneDetailsEditMode: () => MinstrelWindow._withWindow(async (windowRef) => {
            await windowRef.setSceneDetailsEditMode(!windowRef.uiState.sceneDetailsEditMode);
        }),
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
        duplicateSoundScene: () => MinstrelWindow._withWindow(async (windowRef) => {
            const soundScene = windowRef._collectSoundSceneForm();
            if (!soundScene) return;
            const savedScene = await SoundSceneManager.saveSoundScene({
                ...foundry.utils.deepClone(soundScene),
                id: null,
                name: `${String(soundScene.name ?? 'Untitled Scene').trim() || 'Untitled Scene'} COPY`
            });
            if (!savedScene) return;
            windowRef.setSoundSceneDraft(savedScene);
            await windowRef.setSelectedSoundSceneId(savedScene.id);
            windowRef.setSceneDetailsEditMode(false);
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
            await windowRef.setSelectedSoundSceneId(soundSceneId);
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
            sceneDraft.layers = [...(sceneDraft.layers ?? []), nextLayer];
            windowRef.setSoundSceneDraft(sceneDraft);
            void windowRef._renderWithUiRestore({ scrollRestoreState });
        }),
        cycleMusicSceneLayerLoopMode: (_event, button) => MinstrelWindow._withWindow((windowRef) => {
            const scrollRestoreState = captureScrollRestoreState(windowRef._getRoot());
            const sceneDraft = windowRef._collectSoundSceneForm();
            const layerId = button.dataset.value;
            if (!sceneDraft || !layerId) return;
            sceneDraft.layers = (sceneDraft.layers ?? []).map((layer) => {
                if (layer.id !== layerId) return layer;
                return {
                    ...layer,
                    loopMode: getNextMusicLoopMode(layer.loopMode)
                };
            });
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
        selectCue: (_event, button) => MinstrelWindow._withWindow((windowRef) => {
            windowRef.setCueEditMode(true);
            return windowRef.setSelectedCueId(button.dataset.value ?? null);
        }),
        newCue: () => MinstrelWindow._withWindow((windowRef) => {
            windowRef.setCueEditMode(true);
            return windowRef.setSelectedCueId(null);
        }),
        toggleFavoriteCue: (_event, button) => MinstrelWindow._withWindow(async () => {
            const cueId = button.dataset.value;
            if (!cueId) return;
            await CueManager.toggleFavorite(cueId);
            MinstrelManager.requestUiRefresh();
        }),
        saveCue: () => MinstrelWindow._withWindow(async (windowRef) => {
            const cue = windowRef._collectCueForm();
            if (!cue) return;
            if (!cue.category) {
                ui.notifications?.warn?.('Cue Category is required.');
                return;
            }
            if (!cue.track) {
                ui.notifications?.warn?.('Cue Track is required.');
                return;
            }
            const savedCue = await CueManager.saveCue(cue);
            if (!savedCue) return;
            windowRef.setCueDraft(savedCue);
            windowRef.setCueEditMode(false);
            await windowRef.setSelectedCueId(savedCue.id);
            MinstrelManager.requestUiRefresh();
        }),
        deleteCue: () => MinstrelWindow._withWindow(async (windowRef) => {
            const cueId = windowRef.uiState.selectedCueId;
            if (!cueId) return;
            await CueManager.deleteCue(cueId);
            windowRef.setCueEditMode(false);
            windowRef.setSelectedCueId(null);
            MinstrelManager.requestUiRefresh();
        }),
        triggerCue: (_event, button) => MinstrelWindow._withWindow(async (windowRef) => {
            if (!button.dataset.value) {
                const cueDraft = windowRef._collectCueForm();
                if (!cueDraft?.track) {
                    ui.notifications?.warn?.('Cue Track is required.');
                    return;
                }
            }
            const cueId = button.dataset.value ?? windowRef.uiState.selectedCueId;
            if (!cueId) return;
            await CueManager.triggerCue(cueId);
            MinstrelManager.requestUiRefresh();
        }),
        selectRule: (_event, button) => MinstrelWindow._withWindow((windowRef) => windowRef.setSelectedRuleId(button.dataset.value ?? null)),
        newRule: () => MinstrelWindow._withWindow((windowRef) => windowRef.setSelectedRuleId(null)),
        addAutomationClause: () => MinstrelWindow._withWindow((windowRef) => {
            const draft = windowRef._collectRuleForm();
            const ruleType = String(windowRef._getRoot()?.querySelector('#automation-rule-type')?.value ?? '');
            if (!ruleType) return;
            draft.rules = [...(draft.rules ?? []), AutomationManager.createRuleClause(ruleType, draft.rules?.length ? 'and' : 'and')];
            windowRef.setAutomationRuleDraft(draft);
            windowRef.render(true);
        }),
        moveAutomationClauseUp: (_event, button) => MinstrelWindow._withWindow((windowRef) => {
            const draft = windowRef._collectRuleForm();
            const clauseId = String(button.dataset.value ?? '');
            const clauses = [...(draft.rules ?? [])];
            const index = clauses.findIndex((clause) => clause.id === clauseId);
            if (index <= 0) return;
            [clauses[index - 1], clauses[index]] = [clauses[index], clauses[index - 1]];
            draft.rules = clauses;
            windowRef.setAutomationRuleDraft(draft);
            windowRef.render(true);
        }),
        moveAutomationClauseDown: (_event, button) => MinstrelWindow._withWindow((windowRef) => {
            const draft = windowRef._collectRuleForm();
            const clauseId = String(button.dataset.value ?? '');
            const clauses = [...(draft.rules ?? [])];
            const index = clauses.findIndex((clause) => clause.id === clauseId);
            if (index < 0 || index >= clauses.length - 1) return;
            [clauses[index], clauses[index + 1]] = [clauses[index + 1], clauses[index]];
            draft.rules = clauses;
            windowRef.setAutomationRuleDraft(draft);
            windowRef.render(true);
        }),
        removeAutomationClause: (_event, button) => MinstrelWindow._withWindow((windowRef) => {
            const draft = windowRef._collectRuleForm();
            const clauseId = String(button.dataset.value ?? '');
            draft.rules = (draft.rules ?? []).filter((clause) => clause.id !== clauseId);
            windowRef.setAutomationRuleDraft(draft);
            windowRef.render(true);
        }),
        saveRule: () => MinstrelWindow._withWindow(async (windowRef) => {
            const rule = windowRef._collectRuleForm();
            if (!rule) return;
            await AutomationManager.saveRule(rule);
            await windowRef.setSelectedRuleId(rule.id);
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
            cueDraft: foundry.utils.deepClone(state.selectedCueId ? CueManager.getCue(state.selectedCueId) : StorageManager.createBlankCue()),
            cueEditMode: false,
            selectedRuleId: state.selectedRuleId,
            automationRuleDraft: cloneAutomationRule(state.selectedRuleId ? AutomationManager.getRule(state.selectedRuleId) : StorageManager.createBlankAutomationRule()),
            playlistSearch: state.playlistSearch ?? '',
            playlistChannelFilter: state.playlistChannelFilter ?? 'all',
            playlistStatusFilter: state.playlistStatusFilter ?? 'all',
            sceneDetailsEditMode: !state.selectedSoundSceneId
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
        this._startSceneClockTicker();
    }

    _detachRootListeners() {
        if (!this._listenerRoot) return;
        this._listenerRoot.removeEventListener('input', this._boundInputHandler);
        this._listenerRoot.removeEventListener('change', this._boundChangeHandler);
        this._listenerRoot = null;
        this._stopSceneClockTicker();
    }

    _startSceneClockTicker() {
        if (this._sceneClockTicker) return;
        this._updateSceneClockDisplay();
        this._sceneClockTicker = window.setInterval(() => {
            this._updateSceneClockDisplay();
        }, 250);
    }

    _stopSceneClockTicker() {
        if (!this._sceneClockTicker) return;
        window.clearInterval(this._sceneClockTicker);
        this._sceneClockTicker = null;
    }

    _updateSceneClockDisplay() {
        const root = this._getRoot();
        if (!root || this.uiState.tab !== 'soundScenes') return;
        const clock = RuntimeManager.getSceneClock();
        const selectedSceneId = this.uiState.selectedSoundSceneId;
        if (!clock || !selectedSceneId || String(clock.soundSceneId ?? '') !== String(selectedSceneId)) return;

        const progress = getSceneClockProgress(clock);
        const left = `${progress.progressPercent}%`;
        const elapsedLabel = root.querySelector('[data-scene-master-elapsed]');
        const durationLabel = root.querySelector('[data-scene-master-duration]');
        const masterLine = root.querySelector('[data-scene-master-line]');
        if (elapsedLabel) {
            elapsedLabel.textContent = `${formatDurationLabel(progress.cycleSeconds)} / ${formatDurationLabel(progress.durationSeconds)}`;
        }
        if (durationLabel) {
            durationLabel.textContent = formatDurationLabel(progress.durationSeconds);
        }
        if (masterLine) {
            masterLine.style.left = left;
        }
        for (const line of root.querySelectorAll('[data-scene-playhead-line]')) {
            line.style.left = left;
        }

        const activeMusicIndex = Number(clock?.musicIndex ?? -1);
        for (const row of root.querySelectorAll('[data-scene-music-row]')) {
            const rowIndex = Number(row.dataset.sceneMusicIndex ?? -1);
            const isActiveMusic = rowIndex === activeMusicIndex;
            row.querySelector('[data-scene-music-slot]')?.classList.toggle('is-secondary', !isActiveMusic);
            row.querySelector('[data-scene-music-speaker]')?.classList.toggle('is-playing', isActiveMusic);
            row.querySelector('[data-scene-playhead-line]')?.classList.toggle('is-hidden', !isActiveMusic);
        }
    }

    refreshSceneTransportUi() {
        if (this.uiState.tab !== 'soundScenes') return false;
        this._updateSceneClockDisplay();
        return true;
    }

    _applyPlaylistSearchFilter(search = '') {
        const root = this._getRoot();
        if (!root) return;
        const normalized = String(search ?? '').trim().toLowerCase();
        const enableSearch = normalized.length >= 3;
        for (const group of root.querySelectorAll('.minstrel-playlist-group')) {
            const rows = Array.from(group.querySelectorAll('.minstrel-track-row'));
            let visibleRows = 0;
            for (const row of rows) {
                const haystack = String(row.textContent ?? '').toLowerCase();
                const visible = !enableSearch || haystack.includes(normalized);
                setElementVisible(row, visible);
                if (visible) visibleRows += 1;
            }
            setElementVisible(group, visibleRows > 0 || !enableSearch);
        }
    }

    _applySceneSearchFilter(search = '') {
        const root = this._getRoot();
        if (!root) return;
        const normalized = String(search ?? '').trim().toLowerCase();
        const enableSearch = normalized.length >= 3;
        for (const card of root.querySelectorAll('.minstrel-scenes-workspace .minstrel-scene-browser-card')) {
            const haystack = String(card.textContent ?? '').toLowerCase();
            setElementVisible(card, !enableSearch || haystack.includes(normalized));
        }
    }

    _applySceneSoundSearchFilter(search = '') {
        const root = this._getRoot();
        if (!root) return;
        const normalized = String(search ?? '').trim().toLowerCase();
        const enableSearch = normalized.length >= 3;
        for (const row of root.querySelectorAll('.minstrel-scenes-workspace .minstrel-selector-row')) {
            const haystack = String(row.textContent ?? '').toLowerCase();
            setElementVisible(row, !enableSearch || haystack.includes(normalized));
        }
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
            this.uiState.playlistSearch = search;
            this._applyPlaylistSearchFilter(search);
            this._playlistSearchTimer = window.setTimeout(() => {
                this._playlistSearchTimer = null;
                this._queueWindowStateSave({
                    playlistSearch: this.uiState.playlistSearch
                });
            }, 250);
            return;
        }

        if (target.id === 'minstrel-scene-search') {
            const search = String(target.value ?? '').trim();
            if (this._sceneSearchTimer) {
                window.clearTimeout(this._sceneSearchTimer);
                this._sceneSearchTimer = null;
            }
            this.uiState.sceneSearch = search;
            this._applySceneSearchFilter(search);
            this._sceneSearchTimer = window.setTimeout(() => {
                this._sceneSearchTimer = null;
                this._queueWindowStateSave({
                    sceneSearch: this.uiState.sceneSearch
                });
            }, 250);
            return;
        }

        if (target.id === 'minstrel-scene-sound-search') {
            const search = String(target.value ?? '').trim();
            if (this._sceneSoundSearchTimer) {
                window.clearTimeout(this._sceneSoundSearchTimer);
                this._sceneSoundSearchTimer = null;
            }
            this.uiState.sceneSoundSearch = search;
            this._applySceneSoundSearchFilter(search);
            this._sceneSoundSearchTimer = window.setTimeout(() => {
                this._sceneSoundSearchTimer = null;
                this._queueWindowStateSave({
                    sceneSoundSearch: this.uiState.sceneSoundSearch
                });
            }, 250);
            return;
        }

        if (target.matches?.('[data-scene-layer-field="volume"], [data-track-volume], #cue-volume')) {
            const slider = target.closest('.minstrel-layer-slider');
            const valueLabel = slider?.querySelector('span');
            if (valueLabel) {
                valueLabel.textContent = `${Number(target.value ?? 0)}%`;
            }
            return;
        }

        if (target.matches?.('[data-global-audio-volume]')) {
            const valueLabel = target.closest('.minstrel-metric')?.querySelector('[data-global-audio-value]');
            if (valueLabel) {
                valueLabel.textContent = `${Number(target.value ?? 0)}%`;
            }
            return;
        }

        if (target.matches?.('[data-automation-field="timeStartMinutes"], [data-automation-field="timeEndMinutes"]')) {
            const slider = target.closest('.minstrel-automation-time-range');
            const startInput = slider?.querySelector('[data-automation-field="timeStartMinutes"]');
            const endInput = slider?.querySelector('[data-automation-field="timeEndMinutes"]');
            const valueLabel = slider?.querySelector('[data-automation-time-value]');
            const startValue = Math.max(0, Math.min(1439, Number(startInput?.value ?? 480)));
            const endValue = Math.max(0, Math.min(1439, Number(endInput?.value ?? 1020)));
            const leftValue = Math.min(startValue, endValue);
            const rightValue = Math.max(startValue, endValue);
            if (slider) {
                slider.style.setProperty('--automation-time-start', `${(leftValue / 1439) * 100}%`);
                slider.style.setProperty('--automation-time-width', `${Math.max(0.8, ((rightValue - leftValue) / 1439) * 100)}%`);
            }
            if (valueLabel) {
                valueLabel.textContent = `${formatAutomationMinutes(startValue)} - ${formatAutomationMinutes(endValue)}`;
            }
        }
    }

    _handleRootChange(event) {
        const target = event.target;
        if (!target) return;

        if (target.matches?.('#rule-action')) {
            const draft = this._collectRuleForm();
            this.setAutomationRuleDraft(draft);
            void this._renderWithUiRestore({
                scrollRestoreState: captureScrollRestoreState(this._getRoot())
            });
            return;
        }

        if (target.matches?.('#cue-category')) {
            const draft = this._collectCueForm();
            this.setCueDraft(draft);
            void this._renderWithUiRestore({
                scrollRestoreState: captureScrollRestoreState(this._getRoot())
            });
            return;
        }

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

    _hasExternalFocus() {
        const root = this._getRoot();
        const activeElement = document.activeElement;
        if (!root || !activeElement || activeElement === document.body) return false;
        return !root.contains(activeElement);
    }

    _hasEditableFocus() {
        const root = this._getRoot();
        const activeElement = document.activeElement;
        if (!root || !activeElement || !root.contains(activeElement)) return false;
        return !!activeElement.closest?.('input, textarea, select, [contenteditable="true"]');
    }

    async refreshPreservingUi({ respectExternalFocus = true, respectEditableFocus = true } = {}) {
        if ((respectExternalFocus && this._hasExternalFocus()) || (respectEditableFocus && this._hasEditableFocus())) {
            this._updateSceneClockDisplay();
            return false;
        }
        await this._renderWithUiRestore({
            scrollRestoreState: captureScrollRestoreState(this._getRoot())
        });
        return true;
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
                if (RuntimeManager.getState().windowRef === this && this.uiState.tab === 'soundScenes') {
                    void this.refreshPreservingUi();
                }
            });

        return 0;
    }

    _buildSceneLayerPresentation(layer, longestSceneLayerDuration, isSelectedSceneActive, activeTrackRefs = [], activeMusicLayerId = null) {
        const durationSeconds = this._getCachedTrackDurationSeconds(layer.trackRef);
        const musicLoop = layer?.type === 'music' ? getMusicLoopPresentation(layer?.loopMode) : {};
        const isPlaying = layer?.type === 'music'
            ? (!!activeMusicLayerId && String(layer?.id ?? '') === String(activeMusicLayerId))
            : false;
        return {
            ...layer,
            trackValue: toTrackValue(layer.trackRef),
            ...musicLoop,
            isPlaying,
            volumePercent: Math.round((Number(layer.volume ?? (layer.type === 'music' ? 0.75 : layer.type === 'scheduled-one-shot' ? 1 : 0.65)) || 0) * 100),
            startDelaySeconds: Math.max(0, Math.round((Number(layer.startDelayMs) || 0) / 1000)),
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
            const isSelectedSceneActive = !!selectedSoundScene?.id && selectedSoundScene.id === RuntimeManager.getState().activeSoundSceneId;
            const activeSoundSceneId = RuntimeManager.getState().activeSoundSceneId;
            const activeSceneClock = RuntimeManager.getSceneClock();
            const selectedSceneClock = isSelectedSceneActive && activeSceneClock && String(activeSceneClock.soundSceneId ?? '') === String(selectedSoundScene?.id ?? '')
                ? getSceneClockProgress(activeSceneClock)
                : null;
            const nowPlaying = PlaylistManager.getNowPlaying();
            const activeTrackRefs = [
                ...(nowPlaying.music ? [nowPlaying.music] : []),
                ...(nowPlaying.ambientTracks ?? []),
                ...((nowPlaying.activeTracks ?? []).map((entry) => entry?.trackRef).filter(Boolean))
            ];
            const activeMusicLayerId = selectedSceneClock
                ? String(selectedSceneMusicLayers[Number(selectedSceneClock.musicIndex ?? 0)]?.id ?? '')
                : '';
            const sceneMasterDurationSeconds = selectedSceneClock?.durationSeconds
                ?? (selectedSceneMusicLayers.length
                    ? Math.max(1, this._getCachedTrackDurationSeconds(selectedSceneMusicLayers[0]?.trackRef))
                    : Math.max(
                        1,
                        ...selectedSceneEnvironmentLayers.map((layer) => this._getCachedTrackDurationSeconds(layer.trackRef)),
                        ...selectedSceneScheduledLayers.map((layer) => Math.max(0, Math.max(Number(layer?.startDelayMs) || 0, (Number(layer?.frequencySeconds) || 0) * 1000) / 1000) + this._getCachedTrackDurationSeconds(layer.trackRef))
                    ));
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
                sceneDetailsEditMode: this.uiState.sceneDetailsEditMode,
                sceneDetailsReadStyle: !this.uiState.sceneDetailsEditMode && selectedSoundScene.backgroundImage
                    ? `background: linear-gradient(rgba(14, 10, 8, 0.44), rgba(14, 10, 8, 0.6)), url('${selectedSoundScene.backgroundImage}') center / cover no-repeat;`
                    : '',
                selectedSoundSceneTagText,
                sceneMasterDurationLabel: formatDurationLabel(sceneMasterDurationSeconds),
                sceneMasterElapsedLabel: selectedSceneClock
                    ? `${formatDurationLabel(selectedSceneClock.cycleSeconds)} / ${formatDurationLabel(selectedSceneClock.durationSeconds)}`
                    : `0:00 / ${formatDurationLabel(sceneMasterDurationSeconds)}`,
                sceneMasterProgressPercent: selectedSceneClock?.progressPercent ?? 0,
                selectedSceneMusicLayers: selectedSceneMusicLayers.map((layer) => this._buildSceneLayerPresentation(layer, sceneMasterDurationSeconds, isSelectedSceneActive, activeTrackRefs, activeMusicLayerId)),
                selectedSceneEnvironmentLayers: selectedSceneEnvironmentLayers.map((layer) => this._buildSceneLayerPresentation(layer, sceneMasterDurationSeconds, isSelectedSceneActive, activeTrackRefs, activeMusicLayerId)),
                selectedSceneScheduledLayers: selectedSceneScheduledLayers.map((layer) => this._buildSceneLayerPresentation(layer, sceneMasterDurationSeconds, isSelectedSceneActive, activeTrackRefs, activeMusicLayerId)),
                activeSoundSceneId
            };
        } else if (activeTab === 'cues') {
            const cues = CueManager.getCues();
            const trackOptions = PlaylistManager.getTrackOptions();
            const cueTrackOptions = trackOptions.filter((option) => option.channel === 'cue');
            const selectedCue = foundry.utils.deepClone(this.uiState.cueDraft ?? (
                this.uiState.selectedCueId
                    ? CueManager.getCue(this.uiState.selectedCueId) ?? StorageManager.createBlankCue()
                    : StorageManager.createBlankCue()
            ));
            const cueSheets = Array.from(new Set([
                ...cues.map((cue) => String(cue.category ?? '').trim()).filter(Boolean),
                String(selectedCue?.category ?? '').trim()
            ]))
                .filter(Boolean)
                .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
            const cueGroups = cueSheets.map((sheetName) => ({
                name: sheetName,
                cues: cues
                    .filter((cue) => String(cue.category ?? '').trim() === sheetName)
                    .map((cue) => ({
                        ...cue,
                        cardStyle: `--cue-tint:${cue.tintColor ?? '#b96c26'}; --cue-tint-soft:${toRgbaString(cue.tintColor ?? '#b96c26', 0.18)};`,
                        isSelected: cue.id === selectedCue?.id,
                        isEditing: !!this.uiState.cueEditMode && cue.id === selectedCue?.id
                    }))
            }));

            bodyContext = {
                ...bodyContext,
                cues,
                cueGroups,
                cueSheets,
                cueSheetOptions: [
                    { value: '', label: 'Select Category', selected: !selectedCue?.category && selectedCue?.categoryMode !== 'create', disabled: true },
                    { value: '__create_new__', label: 'Create New', selected: selectedCue?.categoryMode === 'create', disabled: false },
                    ...cueSheets.map((sheetName) => ({
                        value: sheetName,
                        label: sheetName,
                        selected: sheetName === String(selectedCue?.category ?? '').trim() && selectedCue?.categoryMode !== 'create',
                        disabled: false
                    }))
                ],
                selectedCueCategoryIsCreateNew: selectedCue?.categoryMode === 'create',
                selectedCue,
                cueEditMode: !!this.uiState.cueEditMode,
                selectedCueTrackValue: toTrackValue(selectedCue?.track),
                selectedCueVolumePercent: Math.round((Number(selectedCue?.volume ?? 1) || 0) * 100),
                cueTrackOptions: buildTrackOptions(cueTrackOptions, toTrackValue(selectedCue?.track))
            };
        } else if (activeTab === 'automation') {
            const rules = AutomationManager.getRules();
            const soundScenes = SoundSceneManager.getSoundScenes();
            const selectedRule = cloneAutomationRule(this.uiState.automationRuleDraft ?? (this.uiState.selectedRuleId
                ? rules.find((rule) => rule.id === this.uiState.selectedRuleId)
                : StorageManager.createBlankAutomationRule()));
            const ruleAction = selectedRule?.action ?? 'start';
            const ruleSoundSceneId = selectedRule?.soundSceneId ?? '';
            const artificerAvailable = AutomationManager.isArtificerAvailable();
            const artificerTagOptions = AutomationManager.getArtificerTagOptions();
            const calendar = game.time?.calendar;
            const calendarComponents = calendar?.timeToComponents
                ? calendar.timeToComponents(game.time.worldTime)
                : null;
            const calendarMonthOptions = calendar?.months?.values?.length
                ? calendar.months.values.map((month, index) => ({
                    value: Number(month.ordinal ?? (index + 1)),
                    label: game.i18n.localize(month.name ?? String(month.ordinal ?? (index + 1)))
                }))
                : Array.from({ length: 12 }, (_unused, index) => ({
                    value: index + 1,
                    label: String(index + 1)
                }));
            const automationRuleTypeOptions = [
                { value: '', label: 'Choose a Rule', selected: true, disabled: true },
                ...AutomationManager.getRuleTypes().map((entry) => ({
                    value: entry.type,
                    label: entry.label,
                    selected: false,
                    disabled: false
                }))
            ];
            const automationClauses = (selectedRule.rules ?? []).map((clause, index, clauses) => {
                const typeDefinition = AutomationManager.getRuleTypes().find((entry) => entry.type === clause.type);
                const toneClass = clause.type.includes('combat') || clause.type.includes('round')
                    ? 'minstrel-automation-card-combat'
                    : clause.type === 'habitat'
                        ? 'minstrel-automation-card-habitat'
                        : clause.type === 'scene'
                            ? 'minstrel-automation-card-scene'
                            : 'minstrel-automation-card-time';
                const foundryScenes = Array.from(game.scenes?.contents ?? [])
                    .map((scene) => ({
                        id: String(scene.id),
                        name: String(scene.name ?? 'Unnamed Scene')
                    }))
                    .sort((left, right) => left.name.localeCompare(right.name));
                return {
                    ...clause,
                    index,
                    isFirst: index === 0,
                    isLast: index === clauses.length - 1,
                    cardToneClass: toneClass,
                    typeLabel: typeDefinition?.label ?? clause.type,
                    phaseOptions: [
                        { value: 'start', label: 'Start', selected: (clause.phase ?? 'start') === 'start' },
                        { value: 'end', label: 'End', selected: clause.phase === 'end' }
                    ],
                    joinOptions: [
                        { value: 'and', label: 'AND', selected: (clause.join ?? 'and') === 'and' },
                        { value: 'or', label: 'OR', selected: clause.join === 'or' },
                        { value: 'not', label: 'NOT', selected: clause.join === 'not' }
                    ],
                    sceneOptions: foundryScenes.map((scene) => ({
                        id: scene.id,
                        name: scene.name,
                        selected: scene.id === String(clause.sceneId ?? '')
                    })),
                    habitatOptions: artificerTagOptions.map((tag) => ({
                        value: tag,
                        label: tag,
                        selected: tag === String(clause.habitat ?? '').trim().toLowerCase()
                    })),
                    timeStartMinutes: Math.max(0, Math.min(1439, Number(clause.timeStartMinutes ?? 480))),
                    timeEndMinutes: Math.max(0, Math.min(1439, Number(clause.timeEndMinutes ?? 1020))),
                    timeRangeStyle: (() => {
                        const start = Math.max(0, Math.min(1439, Number(clause.timeStartMinutes ?? 480)));
                        const end = Math.max(0, Math.min(1439, Number(clause.timeEndMinutes ?? 1020)));
                        const left = Math.min(start, end);
                        const right = Math.max(start, end);
                        const leftPercent = (left / 1439) * 100;
                        const widthPercent = Math.max(0.8, ((right - left) / 1439) * 100);
                        return `--automation-time-start:${leftPercent}%; --automation-time-width:${widthPercent}%;`;
                    })(),
                    timeLabel: `${formatAutomationMinutes(clause.timeStartMinutes ?? 480)} - ${formatAutomationMinutes(clause.timeEndMinutes ?? 1020)}`,
                    dateYear: clause.dateYear ?? (calendarComponents ? Number(calendarComponents.year ?? 0) + Number(calendar?.years?.yearZero ?? 0) : ''),
                    dateDay: clause.dateDay ?? (calendarComponents ? Number(calendarComponents.dayOfMonth ?? 0) + 1 : 1),
                    dateMonthOptions: calendarMonthOptions.map((option) => ({
                        ...option,
                        selected: option.value === Number(clause.dateMonth ?? (calendarComponents ? Number(calendarComponents.month ?? 0) + 1 : 1))
                    })),
                    showPhase: ['combat', 'round', 'scene'].includes(clause.type),
                    showScene: clause.type === 'scene',
                    showHabitat: clause.type === 'habitat',
                    showTimeOfDay: clause.type === 'timeOfDay',
                    showDate: clause.type === 'date'
                };
            });

            bodyContext = {
                ...bodyContext,
                rules: rules.map((rule) => ({
                    ...rule,
                    isSelected: rule.id === selectedRule?.id,
                    eventLabel: `${(rule.rules ?? []).length} rule${(rule.rules ?? []).length === 1 ? '' : 's'}`
                })),
                selectedRule,
                artificerAvailable,
                automationRuleTypeOptions,
                automationClauses,
                ruleActionOptions: [
                    { value: 'start', label: 'Start', selected: ruleAction === 'start' },
                    { value: 'stop', label: 'Stop', selected: ruleAction === 'stop' }
                ],
                ruleSoundSceneOptions: [
                    ...(ruleAction === 'stop'
                        ? [{ id: '', name: 'Any Active Scene', selected: !ruleSoundSceneId, disabled: false }]
                        : [{ id: '', name: 'Choose a Scene', selected: !ruleSoundSceneId, disabled: true }]),
                    ...soundScenes.map((scene) => ({
                        id: scene.id,
                        name: scene.name,
                        selected: scene.id === ruleSoundSceneId,
                        disabled: false
                    }))
                ]
            };
        }

        const bodyContent = await foundry.applications.handlebars.renderTemplate('modules/coffee-pub-minstrel/templates/partials/window-minstrel-body.hbs', bodyContext);

        const tabs = [
            ['dashboard', 'Dashboard', 'fa-solid fa-wave-square'],
            ['soundScenes', 'Scenes', 'fa-solid fa-clapperboard-play'],
            ['cues', 'Cues', 'fa-solid fa-bolt'],
            ['playlists', 'Playlists', 'fa-solid fa-list-music'],
            ['automation', 'Automation', 'fa-solid fa-diagram-project']
        ];

        const activeScene = SoundSceneManager.getSoundScene(RuntimeManager.getState().activeSoundSceneId) ?? dashboard.activeSoundScene ?? null;
        const fallbackTrack = dashboard.nowPlaying.music
            ?? dashboard.nowPlaying.ambientTracks?.[0]
            ?? dashboard.nowPlaying.activeTracks?.[0]?.trackRef
            ?? null;
        const nowPlayingMarkup = activeScene
            ? `
                <div class="minstrel-metric minstrel-metric-now-playing minstrel-metric-now-playing-scene"${activeScene.backgroundImage ? ` style="background-image: linear-gradient(rgba(16, 12, 10, 0.58), rgba(16, 12, 10, 0.78)), url(&quot;${escapeCssUrl(activeScene.backgroundImage)}&quot;);"` : ''}>
                    <span class="minstrel-metric-label">Now Playing</span>
                    <span class="minstrel-metric-value">${escapeHtml(activeScene.name)}</span>
                    <span class="minstrel-list-meta">${escapeHtml(activeScene.description || `${activeScene.layers?.length ?? 0} tracks`)}</span>
                </div>
            `
            : fallbackTrack
                ? `
                    <div class="minstrel-metric minstrel-metric-now-playing">
                        <span class="minstrel-metric-label">Now Playing</span>
                        <span class="minstrel-metric-value">${escapeHtml(fallbackTrack.soundName ?? fallbackTrack.playlistName ?? 'Nothing is Playing')}</span>
                        <span class="minstrel-list-meta">${escapeHtml(fallbackTrack.playlistName ?? 'Standalone Track')}</span>
                    </div>
                `
                : `
                    <div class="minstrel-metric minstrel-metric-now-playing">
                        <span class="minstrel-metric-label">Now Playing</span>
                        <span class="minstrel-metric-value">Nothing is Playing</span>
                        <span class="minstrel-list-meta">No active scene, track, or cue</span>
                    </div>
                `;
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
                    ${nowPlayingMarkup}
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
        this.uiState.sceneDetailsEditMode = !soundSceneId;
        this._queueWindowStateSave({ selectedSoundSceneId: this.uiState.selectedSoundSceneId });
        this.render(true);
    }

    setSoundSceneDraft(soundScene) {
        this.uiState.soundSceneDraft = cloneSoundScene(soundScene);
    }

    async setSceneDetailsEditMode(editMode) {
        if (!editMode) {
            this.setSoundSceneDraft(this._collectSoundSceneForm());
        }
        this.uiState.sceneDetailsEditMode = !!editMode;
        this.render(true);
    }

    async setSelectedCueId(cueId) {
        this.uiState.selectedCueId = cueId ?? null;
        this.uiState.cueDraft = foundry.utils.deepClone(cueId ? CueManager.getCue(cueId) : StorageManager.createBlankCue());
        this._queueWindowStateSave({ selectedCueId: this.uiState.selectedCueId });
        this.render(true);
    }

    setCueDraft(cue) {
        this.uiState.cueDraft = foundry.utils.deepClone(cue ?? StorageManager.createBlankCue());
    }

    setCueEditMode(editMode) {
        this.uiState.cueEditMode = !!editMode;
    }

    async setSelectedRuleId(ruleId) {
        this.uiState.selectedRuleId = ruleId ?? null;
        this.uiState.automationRuleDraft = cloneAutomationRule(ruleId ? AutomationManager.getRule(ruleId) : StorageManager.createBlankAutomationRule());
        this._queueWindowStateSave({ selectedRuleId: this.uiState.selectedRuleId });
        this.render(true);
    }

    setAutomationRuleDraft(rule) {
        this.uiState.automationRuleDraft = cloneAutomationRule(rule);
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
        const draft = cloneSoundScene(this.uiState.soundSceneDraft ?? StorageManager.createBlankSoundScene());
        const defaultFadeIn = Number(root?.querySelector('#sound-scene-default-fade-in')?.value ?? draft.fadeIn ?? 2);
        const defaultFadeOut = Number(root?.querySelector('#sound-scene-default-fade-out')?.value ?? draft.fadeOut ?? 2);
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
                    startDelayMs: layerType === 'scheduled-one-shot'
                        ? Math.max(1, Number(row.querySelector('[data-scene-layer-field="frequencySeconds"]')?.value ?? 120) || 120) * 1000
                        : Math.max(0, Number(row.querySelector('[data-scene-layer-field="startDelaySeconds"]')?.value ?? 0) || 0) * 1000,
                    frequencySeconds: Number(row.querySelector('[data-scene-layer-field="frequencySeconds"]')?.value ?? 120),
                    loopMode: (() => {
                        if (layerType === 'music') {
                            return String(row.querySelector('[data-scene-layer-loop-mode]')?.dataset.loopMode ?? 'once').trim() || 'once';
                        }
                        return row.querySelector('[data-scene-layer-field="loopMode"]')?.checked ? 'loop' : 'once';
                    })(),
                    enabled: !!row.querySelector('[data-scene-layer-field="enabled"]')?.checked
                };
            })
            .filter(Boolean);
        const resolvedLayers = layers.length ? layers : Array.isArray(draft.layers) ? draft.layers : [];
        return {
            id: this.uiState.selectedSoundSceneId ?? draft.id ?? null,
            name: root?.querySelector('#sound-scene-name')?.value ?? draft.name ?? '',
            description: root?.querySelector('#sound-scene-description')?.value ?? draft.description ?? '',
            backgroundImage: root?.querySelector('#sound-scene-background-image')?.value ?? draft.backgroundImage ?? '',
            tags: root?.querySelector('#sound-scene-tags')
                ? splitTags(root.querySelector('#sound-scene-tags')?.value ?? '')
                : Array.isArray(draft.tags) ? [...draft.tags] : [],
            music: resolvedLayers.find((layer) => layer.type === 'music')?.trackRef ?? draft.music ?? null,
            ambientTracks: resolvedLayers.filter((layer) => layer.type === 'environment').map((layer) => ({
                ...layer.trackRef,
                volume: layer.volume,
                fadeIn: layer.fadeIn,
                fadeOut: layer.fadeOut,
                delayMs: layer.startDelayMs
            })),
            layers: resolvedLayers,
            volumes: {
                music: resolvedLayers.find((layer) => layer.type === 'music')?.volume ?? draft.volumes?.music ?? 0.75,
                ambient: resolvedLayers.find((layer) => layer.type === 'environment')?.volume ?? draft.volumes?.ambient ?? 0.65,
                cues: 1
            },
            fadeIn: Number(root?.querySelector('#sound-scene-default-fade-in')?.value ?? draft.fadeIn ?? 2),
            fadeOut: Number(root?.querySelector('#sound-scene-default-fade-out')?.value ?? draft.fadeOut ?? 2),
            restorePreviousOnExit: root?.querySelector('#sound-scene-restore')
                ? !!root.querySelector('#sound-scene-restore')?.checked
                : !!draft.restorePreviousOnExit,
            enabled: root?.querySelector('#sound-scene-enabled')
                ? !!root.querySelector('#sound-scene-enabled')?.checked
                : !!draft.enabled,
            favorite: root?.querySelector('#sound-scene-favorite')
                ? !!root.querySelector('#sound-scene-favorite')?.checked
                : !!draft.favorite
        };
    }

    _collectCueForm() {
        const root = this._getRoot();
        const draft = foundry.utils.deepClone(this.uiState.cueDraft ?? StorageManager.createBlankCue());
        return {
            id: this.uiState.selectedCueId ?? draft.id ?? null,
            name: root?.querySelector('#cue-name')?.value ?? draft.name ?? '',
            icon: root?.querySelector('#cue-icon')?.value ?? draft.icon ?? 'fa-solid fa-bell',
            category: (() => {
                const categoryValue = String(root?.querySelector('#cue-category')?.value ?? draft.category ?? '').trim();
                if (categoryValue === '__create_new__') return String(root?.querySelector('#cue-category-new')?.value ?? '').trim();
                return categoryValue;
            })(),
            categoryMode: String(root?.querySelector('#cue-category')?.value ?? draft.categoryMode ?? 'existing').trim() === '__create_new__' ? 'create' : 'existing',
            tintColor: root?.querySelector('#cue-tint-color')?.value ?? draft.tintColor ?? '#b96c26',
            track: PlaylistManager.parseTrackRefValue(root?.querySelector('#cue-track')?.value),
            volume: Math.max(0, Math.min(1, Number(root?.querySelector('#cue-volume')?.value ?? Math.round((Number(draft.volume ?? 1) || 0) * 100)) / 100)),
            cooldown: Number(root?.querySelector('#cue-cooldown')?.value ?? draft.cooldown ?? 0),
            duckOthers: root?.querySelector('#cue-duck-others') ? !!root?.querySelector('#cue-duck-others')?.checked : !!draft.duckOthers,
            stopOnSceneChange: root?.querySelector('#cue-stop-on-scene-change') ? !!root?.querySelector('#cue-stop-on-scene-change')?.checked : !!draft.stopOnSceneChange,
            favorite: root?.querySelector('#cue-favorite') ? !!root?.querySelector('#cue-favorite')?.checked : !!draft.favorite,
            enabled: root?.querySelector('#cue-enabled') ? !!root?.querySelector('#cue-enabled')?.checked : !!draft.enabled
        };
    }

    _collectRuleForm() {
        const root = this._getRoot();
        const draft = cloneAutomationRule(this.uiState.automationRuleDraft ?? StorageManager.createBlankAutomationRule());
        const clauses = Array.from(root?.querySelectorAll?.('[data-automation-clause-row]') ?? [])
            .map((row) => ({
                id: String(row.dataset.clauseId ?? foundry.utils.randomID()),
                type: String(row.dataset.clauseType ?? 'combat'),
                join: String(row.querySelector('[data-automation-field="join"]')?.value ?? 'and'),
                phase: String(row.querySelector('[data-automation-field="phase"]')?.value ?? 'start'),
                sceneId: String(row.querySelector('[data-automation-field="sceneId"]')?.value ?? ''),
                habitat: String(row.querySelector('[data-automation-field="habitat"]')?.value ?? ''),
                timeStartMinutes: Math.max(0, Math.min(1439, Number(row.querySelector('[data-automation-field="timeStartMinutes"]')?.value ?? 480))),
                timeEndMinutes: Math.max(0, Math.min(1439, Number(row.querySelector('[data-automation-field="timeEndMinutes"]')?.value ?? 1020))),
                dateYear: row.querySelector('[data-automation-field="dateYear"]')?.value ?? '',
                dateMonth: Number(row.querySelector('[data-automation-field="dateMonth"]')?.value ?? 1),
                dateDay: Number(row.querySelector('[data-automation-field="dateDay"]')?.value ?? 1)
            }));
        return {
            id: this.uiState.selectedRuleId ?? draft.id ?? foundry.utils.randomID(),
            name: root?.querySelector('#rule-name')?.value ?? draft.name ?? '',
            rules: clauses.length ? clauses : Array.isArray(draft.rules) ? draft.rules : [],
            action: root?.querySelector('#rule-action')?.value || draft.action || 'start',
            soundSceneId: root?.querySelector('#rule-sound-scene')?.value || draft.soundSceneId || null,
            priority: Number(root?.querySelector('#rule-priority')?.value ?? draft.priority ?? 0),
            delayMs: Number(root?.querySelector('#rule-delay-ms')?.value ?? draft.delayMs ?? 0),
            restorePreviousOnExit: root?.querySelector('#rule-restore')
                ? !!root?.querySelector('#rule-restore')?.checked
                : !!draft.restorePreviousOnExit,
            enabled: root?.querySelector('#rule-enabled')
                ? !!root?.querySelector('#rule-enabled')?.checked
                : !!draft.enabled
        };
    }
}
