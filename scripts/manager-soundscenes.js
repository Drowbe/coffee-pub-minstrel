// ==================================================================
// ===== MINSTREL SOUND SCENE MANAGER ===============================
// ==================================================================

import { MODULE } from './const.js';
import { PlaylistManager } from './manager-playlists.js';
import { RuntimeManager } from './manager-runtime.js';
import { StorageManager } from './manager-storage.js';

const PLAYLIST_TYPE_SCENE = 'scene';
const soundSceneCache = {
    soundScenes: null
};

function getScenePlaylists() {
    return (game.playlists?.contents ?? [])
        .filter((playlist) => playlist?.getFlag?.(MODULE.ID, 'type') === PLAYLIST_TYPE_SCENE)
        .sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? ''), undefined, { sensitivity: 'base' }));
}

function normalizeLayerType(value, fallbackChannel = '') {
    const raw = String(value ?? '').trim();
    if (['music', 'environment', 'scheduled-one-shot'].includes(raw)) return raw;
    if (fallbackChannel === 'music') return 'music';
    if (fallbackChannel === 'cue') return 'scheduled-one-shot';
    return 'environment';
}

function mapLayerTypeToFoundryChannel(layerType) {
    if (layerType === 'music') return 'music';
    if (layerType === 'scheduled-one-shot') return 'interface';
    return 'environment';
}

function getSceneMeta(playlist) {
    return foundry.utils.deepClone(playlist?.getFlag?.(MODULE.ID, 'sceneMeta') ?? {});
}

function getLayerMeta(sound) {
    return foundry.utils.deepClone(sound?.getFlag?.(MODULE.ID, 'layerMeta') ?? {});
}

function buildSceneLayer(sound, sceneMeta) {
    const trackRef = PlaylistManager.createTrackRef(sound);
    if (!trackRef) return null;
    const channel = trackRef.channel;
    const layerMeta = getLayerMeta(sound);
    const type = normalizeLayerType(layerMeta.layerType, channel);
    const volume = Number.isFinite(Number(layerMeta.volume)) ? Number(layerMeta.volume) : Number(sound.volume ?? (type === 'music' ? 0.75 : type === 'scheduled-one-shot' ? 1 : 0.65));

    return {
        id: String(sound.id),
        type,
        trackRef,
        volume,
        fadeIn: Number.isFinite(Number(layerMeta.fadeIn)) ? Number(layerMeta.fadeIn) : Number(sceneMeta.fadeIn ?? 2),
        fadeOut: Number.isFinite(Number(layerMeta.fadeOut)) ? Number(layerMeta.fadeOut) : Number(sceneMeta.fadeOut ?? 2),
        startDelayMs: Number.isFinite(Number(layerMeta.startDelayMs)) ? Number(layerMeta.startDelayMs) : 0,
        frequencySeconds: Number.isFinite(Number(layerMeta.frequencySeconds)) ? Number(layerMeta.frequencySeconds) : 120,
        loopMode: String(layerMeta.loopMode ?? 'loop').trim() || 'loop',
        enabled: layerMeta.enabled !== false
    };
}

function buildSoundSceneFromPlaylist(playlist) {
    if (!playlist) return null;
    const sceneMeta = getSceneMeta(playlist);
    const layers = [...(playlist.sounds.contents ?? [])]
        .sort((left, right) => Number(left?.sort ?? 0) - Number(right?.sort ?? 0))
        .map((sound) => buildSceneLayer(sound, sceneMeta))
        .filter(Boolean);
    const musicLayer = layers.find((layer) => layer.type === 'music') ?? null;
    const environmentLayers = layers.filter((layer) => layer.type === 'environment');

    return {
        id: String(playlist.id),
        name: String(playlist.name ?? 'New Sound Scene').trim() || 'New Sound Scene',
        description: String(sceneMeta.description ?? '').trim(),
        backgroundImage: String(sceneMeta.backgroundImage ?? '').trim(),
        tags: Array.isArray(sceneMeta.tags) ? sceneMeta.tags.map((tag) => String(tag).trim()).filter(Boolean) : [],
        linkedSceneIds: [],
        music: musicLayer?.trackRef ?? null,
        ambientTracks: environmentLayers.map((layer) => ({
            ...layer.trackRef,
            volume: layer.volume,
            fadeIn: layer.fadeIn,
            fadeOut: layer.fadeOut,
            delayMs: layer.startDelayMs ?? 0
        })),
        layers,
        volumes: {
            music: musicLayer?.volume ?? 0.75,
            ambient: environmentLayers[0]?.volume ?? 0.65,
            cues: 1
        },
        fadeIn: Number.isFinite(Number(sceneMeta.fadeIn)) ? Number(sceneMeta.fadeIn) : 2,
        fadeOut: Number.isFinite(Number(sceneMeta.fadeOut)) ? Number(sceneMeta.fadeOut) : 2,
        restorePreviousOnExit: sceneMeta.restorePreviousOnExit !== false,
        enabled: sceneMeta.enabled !== false,
        favorite: !!sceneMeta.favorite
    };
}

function clearScheduledHandles() {
    for (const handle of RuntimeManager.getScheduledLayerHandles()) {
        if (handle.timeoutId) window.clearTimeout(handle.timeoutId);
        handle.cancelled = true;
    }
    RuntimeManager.clearScheduledLayerHandles();
}

function clearMusicSequenceHandle() {
    const handle = RuntimeManager.getMusicSequenceHandle();
    if (handle?.timeoutId) window.clearTimeout(handle.timeoutId);
    if (handle) handle.cancelled = true;
    RuntimeManager.clearMusicSequenceHandle();
}

function getSceneLayers(soundScene, type) {
    return (Array.isArray(soundScene?.layers) ? soundScene.layers : []).filter((layer) => layer.type === type && layer.enabled !== false);
}

function buildPlaylistSoundDataFromLayer(layer, sceneDefaults) {
    const sourceSound = game.playlists?.get(layer?.trackRef?.playlistId)?.sounds?.get(layer?.trackRef?.soundId) ?? null;
    const baseData = sourceSound?.toObject?.() ?? {
        name: layer?.trackRef?.soundName ?? 'New Sound',
        path: layer?.trackRef?.path ?? '',
        volume: Number(layer?.volume ?? 0.5),
        channel: mapLayerTypeToFoundryChannel(layer?.type),
        repeat: layer?.type !== 'scheduled-one-shot'
    };

    delete baseData._id;
    delete baseData.id;
    delete baseData.playing;
    delete baseData.pausedTime;
    delete baseData.sort;

    return {
        ...baseData,
        sort: Number.isFinite(Number(layer?.sort)) ? Number(layer.sort) : Number(baseData.sort ?? 0),
        name: String(baseData.name ?? layer?.trackRef?.soundName ?? 'New Sound'),
        path: String(baseData.path ?? layer?.trackRef?.path ?? ''),
        volume: Number.isFinite(Number(layer?.volume)) ? Number(layer.volume) : Number(baseData.volume ?? 0.5),
        channel: mapLayerTypeToFoundryChannel(layer?.type),
        repeat: layer?.type === 'scheduled-one-shot'
            ? false
            : layer?.type === 'music'
                ? String(layer?.loopMode ?? 'loop') === 'single'
                : String(layer?.loopMode ?? 'loop') !== 'once',
        flags: foundry.utils.mergeObject(baseData.flags ?? {}, {
            [MODULE.ID]: {
                layerMeta: {
                    layerType: normalizeLayerType(layer?.type, layer?.trackRef?.channel),
                    volume: Number.isFinite(Number(layer?.volume)) ? Number(layer.volume) : Number(baseData.volume ?? 0.5),
                    fadeIn: Number.isFinite(Number(layer?.fadeIn)) ? Number(layer.fadeIn) : Number(sceneDefaults.fadeIn ?? 2),
                    fadeOut: Number.isFinite(Number(layer?.fadeOut)) ? Number(layer.fadeOut) : Number(sceneDefaults.fadeOut ?? 2),
                    startDelayMs: Number.isFinite(Number(layer?.startDelayMs)) ? Number(layer.startDelayMs) : 0,
                    frequencySeconds: Number.isFinite(Number(layer?.frequencySeconds)) ? Number(layer.frequencySeconds) : 120,
                    loopMode: String(layer?.loopMode ?? 'loop').trim() || 'loop',
                    enabled: layer?.enabled !== false
                }
            }
        }, { inplace: false })
    };
}

function normalizePlaylistSoundData(soundData) {
    const normalized = foundry.utils.deepClone(soundData ?? {});
    delete normalized._id;
    delete normalized.id;
    delete normalized.playing;
    delete normalized.pausedTime;
    delete normalized.sort;
    return normalized;
}

function scheduleRecurringLayer(handle, triggerPlayback, frequencyMs) {
    if (!handle || handle.cancelled) return;
    handle.timeoutId = window.setTimeout(async () => {
        if (handle.cancelled || handle.running) return;
        handle.running = true;
        try {
            await triggerPlayback();
        } finally {
            handle.running = false;
            if (!handle.cancelled) {
                scheduleRecurringLayer(handle, triggerPlayback, frequencyMs);
            }
        }
    }, frequencyMs);
}

function scheduleLayerTimeout(handle, delayMs, callback) {
    if (!handle || handle.cancelled) return;
    handle.timeoutId = window.setTimeout(async () => {
        if (handle.cancelled || handle.running) return;
        handle.running = true;
        try {
            await callback();
        } finally {
            handle.running = false;
            handle.timeoutId = null;
        }
    }, Math.max(0, Number(delayMs) || 0));
}

function requestSceneUiRefresh() {
    const windowRef = RuntimeManager.getState().windowRef;
    if (windowRef?.uiState?.tab !== 'soundScenes') {
        game.modules.get('coffee-pub-blacksmith')?.api?.renderMenubar?.(true);
        return;
    }
    if (typeof windowRef?.refreshSceneTransportUi === 'function') {
        windowRef.refreshSceneTransportUi();
    }
    game.modules.get('coffee-pub-blacksmith')?.api?.renderMenubar?.(true);
}

function getLayerDurationSeconds(layer) {
    const explicit = Number(layer?._durationSeconds);
    if (Number.isFinite(explicit) && explicit > 0) return explicit;
    const fallback = Number(layer?.trackRef?.durationSeconds);
    return Number.isFinite(fallback) && fallback > 0 ? fallback : 0;
}

function getNextMusicLayerIndex(musicLayers, currentIndex) {
    if (!musicLayers.length) return 0;
    return (currentIndex + 1) % musicLayers.length;
}

function getPreviousMusicLayerIndex(musicLayers, currentIndex) {
    if (!musicLayers.length) return 0;
    return (currentIndex - 1 + musicLayers.length) % musicLayers.length;
}

function isSameTrackRef(left, right) {
    return !!left
        && !!right
        && String(left.playlistId ?? '') === String(right.playlistId ?? '')
        && String(left.soundId ?? '') === String(right.soundId ?? '');
}

function getActiveMusicLayerIndex(musicLayers) {
    if (!musicLayers.length) return 0;

    const runtimeMusicTrack = RuntimeManager.getState().musicTrack;
    const runtimeIndex = musicLayers.findIndex((layer) => isSameTrackRef(layer?.trackRef, runtimeMusicTrack));
    if (runtimeIndex >= 0) return runtimeIndex;

    const sceneClockIndex = Number(RuntimeManager.getSceneClock()?.musicIndex ?? 0);
    if (Number.isFinite(sceneClockIndex)) {
        return Math.max(0, Math.min(musicLayers.length - 1, sceneClockIndex));
    }

    return 0;
}

function computeSceneCycleDurationSeconds(soundScene, musicIndex = 0) {
    const layers = Array.isArray(soundScene?.layers) ? soundScene.layers.filter((layer) => layer?.enabled !== false) : [];
    const musicLayers = layers.filter((layer) => layer.type === 'music');
    if (musicLayers.length) {
        const currentMusicLayer = musicLayers[musicIndex] ?? musicLayers[0] ?? null;
        return Math.max(1, getLayerDurationSeconds(currentMusicLayer));
    }

    const environmentDuration = layers
        .filter((layer) => layer.type === 'environment')
        .reduce((max, layer) => Math.max(max, getLayerDurationSeconds(layer)), 0);
    if (environmentDuration > 0) return environmentDuration;

    const oneShotDuration = layers
        .filter((layer) => layer.type === 'scheduled-one-shot')
        .reduce((max, layer) => {
            const delay = Math.max(
                0,
                Math.max(Number(layer?.startDelayMs) || 0, (Number(layer?.frequencySeconds) || 0) * 1000)
            ) / 1000;
            return Math.max(max, delay + getLayerDurationSeconds(layer));
        }, 0);

    return Math.max(1, oneShotDuration);
}

function computeSceneMasterDurationSeconds(soundScene) {
    return computeSceneCycleDurationSeconds(soundScene, 0);
}

async function enrichSceneDurations(soundScene) {
    soundScene.layers = await Promise.all(
        (Array.isArray(soundScene.layers) ? soundScene.layers : []).map(async (layer) => ({
            ...layer,
            _durationSeconds: await PlaylistManager.getTrackDurationSeconds(layer.trackRef)
        }))
    );
    return soundScene;
}

async function startSoundSceneCycle(soundScene, musicIndex = 0) {
    const musicLayers = getSceneLayers(soundScene, 'music');
    clearScheduledHandles();
    clearMusicSequenceHandle();
    RuntimeManager.clearSceneLayerActivity();
    await PlaylistManager.stopPlaylist(soundScene.id);

    const ambientTracks = [];
    const scheduledHandles = [];
    const currentMusicLayer = musicLayers[musicIndex] ?? null;
    const cycleDurationSeconds = computeSceneCycleDurationSeconds(soundScene, musicIndex);

    if (currentMusicLayer?.trackRef) {
        await PlaylistManager.setTrackRepeat(currentMusicLayer.trackRef, false);
        await PlaylistManager.playTrack(currentMusicLayer.trackRef, {
            layer: 'music',
            volume: currentMusicLayer.volume,
            fadeIn: currentMusicLayer.fadeIn,
            exclusive: true,
            sync: true
        });
        RuntimeManager.markSceneLayerActive(currentMusicLayer.id);
    }

    for (const ambientLayer of getSceneLayers(soundScene, 'environment')) {
        if (!ambientLayer.trackRef) continue;
        const startDelayMs = Math.max(0, Number(ambientLayer.startDelayMs) || 0);
        const triggerPlayback = async () => {
            await PlaylistManager.playTrack(ambientLayer.trackRef, {
                layer: 'ambient',
                volume: ambientLayer.volume,
                fadeIn: ambientLayer.fadeIn,
                exclusive: false,
                sync: startDelayMs <= 0 ? false : true
            });
            RuntimeManager.markSceneLayerActive(ambientLayer.id);
            requestSceneUiRefresh();
        };

        if (startDelayMs > 0) {
            const handle = {
                layerId: ambientLayer.id,
                timeoutId: null,
                running: false,
                cancelled: false
            };
            scheduledHandles.push(handle);
            scheduleLayerTimeout(handle, startDelayMs, triggerPlayback);
        } else {
            await triggerPlayback();
        }
        ambientTracks.push({
            ...ambientLayer.trackRef,
            volume: ambientLayer.volume,
            delayMs: startDelayMs
        });
    }

    for (const scheduledLayer of getSceneLayers(soundScene, 'scheduled-one-shot')) {
        if (!scheduledLayer.trackRef) continue;
        const frequencyMs = Math.max(1000, Math.round((Number(scheduledLayer.frequencySeconds) || 120) * 1000));
        const initialDelayMs = Math.max(
            1000,
            Math.round(Math.max(Number(scheduledLayer.startDelayMs) || 0, frequencyMs))
        );
        const triggerPlayback = async () => {
            RuntimeManager.markSceneLayerActive(scheduledLayer.id);
            await PlaylistManager.playTrack(scheduledLayer.trackRef, {
                layer: 'cue',
                volume: scheduledLayer.volume,
                fadeIn: scheduledLayer.fadeIn,
                exclusive: false,
                recordRecent: false,
                sync: true
            });
            const durationSeconds = await PlaylistManager.getTrackDurationSeconds(scheduledLayer.trackRef);
            window.setTimeout(() => {
                RuntimeManager.markSceneLayerInactive(scheduledLayer.id);
                requestSceneUiRefresh();
            }, Math.max(250, Math.ceil(Math.max(0, Number(durationSeconds) || 0) * 1000) + 150));
            requestSceneUiRefresh();
        };

        if (scheduledLayer.loopMode !== 'loop') {
            const handle = {
                layerId: scheduledLayer.id,
                timeoutId: null,
                running: false,
                cancelled: false
            };
            scheduledHandles.push(handle);
            scheduleLayerTimeout(handle, initialDelayMs, triggerPlayback);
            continue;
        }

        const handle = {
            layerId: scheduledLayer.id,
            timeoutId: null,
            running: false,
            cancelled: false
        };
        scheduledHandles.push(handle);
        scheduleLayerTimeout(handle, initialDelayMs, async () => {
            await triggerPlayback();
            if (!handle.cancelled) {
                scheduleRecurringLayer(handle, triggerPlayback, frequencyMs);
            }
        });
    }

    RuntimeManager.setScheduledLayerHandles(scheduledHandles);
    RuntimeManager.setActiveSoundSceneId(soundScene.id);
    RuntimeManager.setSceneClock({
        soundSceneId: soundScene.id,
        startedAt: Date.now(),
        elapsedOffsetMs: 0,
        durationSeconds: cycleDurationSeconds,
        musicIndex
    });
    RuntimeManager.setAmbientTracks(ambientTracks);
    PlaylistManager.syncRuntimeLayers();
    PlaylistManager.invalidateCache('playlistSummary');
    requestSceneUiRefresh();

    const nextMusicIndex = musicLayers.length ? getNextMusicLayerIndex(musicLayers, musicIndex) : 0;
    const handle = {
        timeoutId: null,
        cancelled: false,
        nextIndex: nextMusicIndex
    };
    handle.timeoutId = window.setTimeout(async () => {
        if (handle.cancelled) return;
        await startSoundSceneCycle(soundScene, nextMusicIndex);
    }, Math.max(500, Math.ceil(cycleDurationSeconds * 1000) + 100));
    RuntimeManager.setMusicSequenceHandle(handle);
}

export const SoundSceneManager = {
    invalidateCache() {
        soundSceneCache.soundScenes = null;
    },

    getSoundScenes() {
        if (!soundSceneCache.soundScenes) {
            soundSceneCache.soundScenes = getScenePlaylists().map((playlist) => buildSoundSceneFromPlaylist(playlist)).filter(Boolean);
        }
        return soundSceneCache.soundScenes;
    },

    getSoundScene(soundSceneId) {
        return this.getSoundScenes().find((scene) => scene.id === String(soundSceneId ?? '')) ?? null;
    },

    computeSceneMasterDurationSeconds(soundScene) {
        return computeSceneMasterDurationSeconds(soundScene);
    },

    async saveSoundScene(soundScene) {
        const sceneMeta = {
            type: PLAYLIST_TYPE_SCENE,
            description: String(soundScene?.description ?? '').trim(),
            backgroundImage: String(soundScene?.backgroundImage ?? '').trim(),
            tags: Array.isArray(soundScene?.tags) ? soundScene.tags.map((tag) => String(tag).trim()).filter(Boolean) : [],
            restorePreviousOnExit: soundScene?.restorePreviousOnExit !== false,
            enabled: soundScene?.enabled !== false,
            favorite: !!soundScene?.favorite,
            fadeIn: Number.isFinite(Number(soundScene?.fadeIn)) ? Number(soundScene.fadeIn) : 2,
            fadeOut: Number.isFinite(Number(soundScene?.fadeOut)) ? Number(soundScene.fadeOut) : 2
        };

        let playlist = soundScene?.id ? game.playlists?.get(soundScene.id) ?? null : null;
        if (!playlist || playlist.getFlag?.(MODULE.ID, 'type') !== PLAYLIST_TYPE_SCENE) {
            playlist = await Playlist.create({
                name: String(soundScene?.name ?? 'New Sound Scene').trim() || 'New Sound Scene',
                mode: CONST.PLAYLIST_MODES?.DISABLED ?? 0,
                sorting: 'm',
                flags: {
                    [MODULE.ID]: {
                        type: PLAYLIST_TYPE_SCENE,
                        sceneMeta
                    }
                }
            });
        } else {
            await playlist.update({
                name: String(soundScene?.name ?? 'New Sound Scene').trim() || 'New Sound Scene',
                flags: {
                    [MODULE.ID]: {
                        type: PLAYLIST_TYPE_SCENE,
                        sceneMeta
                    }
                }
            });
        }

        const layers = Array.isArray(soundScene?.layers) ? soundScene.layers : [];
        const existingSoundsById = new Map(playlist.sounds.contents.map((sound) => [String(sound.id), sound]));
        const retainedSoundIds = new Set();
        const updateOperations = [];
        const createOperations = [];

        for (let index = 0; index < layers.length; index += 1) {
            const layer = layers[index];
            const soundData = buildPlaylistSoundDataFromLayer({
                ...layer,
                sort: index
            }, sceneMeta);
            if (!soundData) continue;

            const existingSound = existingSoundsById.get(String(layer?.id ?? ''));
            if (existingSound) {
                retainedSoundIds.add(String(existingSound.id));
                const currentData = normalizePlaylistSoundData(existingSound.toObject());
                const nextData = normalizePlaylistSoundData(soundData);
                const diff = foundry.utils.diffObject(currentData, nextData);
                if (Object.keys(diff).length) {
                    updateOperations.push(existingSound.update(nextData));
                }
                continue;
            }

            createOperations.push(soundData);
        }

        if (updateOperations.length) {
            await Promise.all(updateOperations);
        }

        if (createOperations.length) {
            await playlist.createEmbeddedDocuments('PlaylistSound', createOperations);
        }

        const deleteIds = playlist.sounds.contents
            .map((sound) => String(sound.id))
            .filter((soundId) => !retainedSoundIds.has(soundId) && existingSoundsById.has(soundId));
        if (deleteIds.length) {
            await playlist.deleteEmbeddedDocuments('PlaylistSound', deleteIds);
        }

        playlist = game.playlists?.get(playlist.id) ?? playlist;
        const soundIdsByPath = new Map();
        for (const sound of playlist.sounds.contents) {
            const pathKey = String(sound.path ?? '').trim();
            if (!pathKey) continue;
            const ids = soundIdsByPath.get(pathKey) ?? [];
            ids.push(String(sound.id));
            soundIdsByPath.set(pathKey, ids);
        }

        const sortUpdates = [];
        for (let index = 0; index < layers.length; index += 1) {
            const layer = layers[index];
            let soundId = String(layer?.id ?? '').trim();
            if (!soundId) {
                const pathKey = String(layer?.trackRef?.path ?? '').trim();
                const ids = soundIdsByPath.get(pathKey) ?? [];
                soundId = ids.shift() ?? '';
                soundIdsByPath.set(pathKey, ids);
            }
            if (!soundId) continue;
            sortUpdates.push({ _id: soundId, sort: index });
        }

        if (sortUpdates.length) {
            await playlist.updateEmbeddedDocuments('PlaylistSound', sortUpdates);
        }

        this.invalidateCache();
        PlaylistManager.invalidateCache('playlistSummary');
        return this.getSoundScene(playlist.id);
    },

    async deleteSoundScene(soundSceneId) {
        const playlist = game.playlists?.get(soundSceneId) ?? null;
        if (!playlist || playlist.getFlag?.(MODULE.ID, 'type') !== PLAYLIST_TYPE_SCENE) return;
        await playlist.delete();
        this.invalidateCache();
    },

    async activateSoundScene(soundSceneId, { savePrevious = true } = {}) {
        const soundScene = this.getSoundScene(soundSceneId);
        if (!soundScene || !soundScene.enabled) return false;
        await enrichSceneDurations(soundScene);

        if (savePrevious) RuntimeManager.setPreviousSnapshot(PlaylistManager.createPlaybackSnapshot());

        clearScheduledHandles();
        clearMusicSequenceHandle();
        await PlaylistManager.stopLayer('music', soundScene.fadeOut ?? 0, null, { sync: false });
        await PlaylistManager.stopLayer('ambient', soundScene.fadeOut ?? 0, null, { sync: false });

        await startSoundSceneCycle(soundScene, 0);
        return true;
    },

    async skipActiveMusicTrack(direction = 1) {
        const activeSoundSceneId = RuntimeManager.getState().activeSoundSceneId;
        if (!activeSoundSceneId) return false;
        const soundScene = this.getSoundScene(activeSoundSceneId);
        if (!soundScene || !soundScene.enabled) return false;
        await enrichSceneDurations(soundScene);
        const musicLayers = getSceneLayers(soundScene, 'music');
        if (!musicLayers.length) return false;
        const currentIndex = getActiveMusicLayerIndex(musicLayers);
        const nextIndex = direction < 0
            ? getPreviousMusicLayerIndex(musicLayers, currentIndex)
            : getNextMusicLayerIndex(musicLayers, currentIndex);
        await startSoundSceneCycle(soundScene, nextIndex);
        return true;
    },

    async stopActiveSoundScene({ restorePrevious = false } = {}) {
        const activeSoundScene = this.getSoundScene(RuntimeManager.getState().activeSoundSceneId);
        const fadeOut = activeSoundScene?.fadeOut ?? StorageManager.getDefaultFadeSeconds();

        clearScheduledHandles();
        clearMusicSequenceHandle();
        await PlaylistManager.stopLayer('music', fadeOut, null, { sync: false });
        await PlaylistManager.stopLayer('ambient', fadeOut, null, { sync: false });
        await PlaylistManager.stopPlaylist(RuntimeManager.getState().activeSoundSceneId);
        RuntimeManager.setActiveSoundSceneId(null);
        RuntimeManager.clearSceneClock();
        RuntimeManager.clearSceneLayerActivity();
        PlaylistManager.syncRuntimeLayers();
        PlaylistManager.invalidateCache('playlistSummary');

        if (restorePrevious) {
            const snapshot = RuntimeManager.getPreviousSnapshot();
            if (snapshot) await PlaylistManager.restorePlaybackSnapshot(snapshot);
        }
    }
};
