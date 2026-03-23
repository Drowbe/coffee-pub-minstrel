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
    const layers = playlist.sounds.contents
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
    if (windowRef?.refreshPreservingUi) {
        void windowRef.refreshPreservingUi();
    } else if (windowRef?.render) {
        void windowRef.render(true);
    }
    game.modules.get('coffee-pub-blacksmith')?.api?.renderMenubar?.(true);
}

function getNextMusicLayerIndex(musicLayers, currentIndex, loopPhase = false) {
    if (!loopPhase) {
        const nextIndex = currentIndex + 1;
        if (nextIndex < musicLayers.length) {
            return {
                nextIndex,
                loopPhase: false
            };
        }
    }

    const firstLoopIndex = musicLayers.findIndex((layer) => String(layer?.loopMode ?? 'once') === 'loop');
    if (firstLoopIndex < 0) return null;

    if (!loopPhase) {
        return {
            nextIndex: firstLoopIndex,
            loopPhase: true
        };
    }

    for (let index = currentIndex + 1; index < musicLayers.length; index += 1) {
        if (String(musicLayers[index]?.loopMode ?? 'once') === 'loop') {
            return {
                nextIndex: index,
                loopPhase: true
            };
        }
    }

    return {
        nextIndex: firstLoopIndex,
        loopPhase: true
    };
}

function computeSceneMasterDurationSeconds(soundScene) {
    const layers = Array.isArray(soundScene?.layers) ? soundScene.layers.filter((layer) => layer?.enabled !== false) : [];
    const getLayerDuration = (layer) => {
        const explicit = Number(layer?._durationSeconds);
        if (Number.isFinite(explicit) && explicit > 0) return explicit;
        const fallback = Number(layer?.trackRef?.durationSeconds);
        return Number.isFinite(fallback) && fallback > 0 ? fallback : 0;
    };

    const musicLayers = layers.filter((layer) => layer.type === 'music');
    let musicDuration = 0;
    for (const layer of musicLayers) {
        musicDuration += getLayerDuration(layer);
        if (String(layer?.loopMode ?? 'once') === 'single') break;
    }

    const environmentDuration = layers
        .filter((layer) => layer.type === 'environment')
        .reduce((max, layer) => Math.max(max, (Number(layer?.startDelayMs) || 0) / 1000 + getLayerDuration(layer)), 0);

    const oneShotDuration = layers
        .filter((layer) => layer.type === 'scheduled-one-shot')
        .reduce((max, layer) => {
            const delay = Math.max(
                0,
                Math.max(Number(layer?.startDelayMs) || 0, (Number(layer?.frequencySeconds) || 0) * 1000)
            ) / 1000;
            return Math.max(max, delay + getLayerDuration(layer));
        }, 0);

    return Math.max(1, musicDuration, environmentDuration, oneShotDuration);
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

        for (const layer of layers) {
            const soundData = buildPlaylistSoundDataFromLayer(layer, sceneMeta);
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

        this.invalidateCache();
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
        soundScene.layers = await Promise.all(
            (Array.isArray(soundScene.layers) ? soundScene.layers : []).map(async (layer) => ({
                ...layer,
                _durationSeconds: await PlaylistManager.getTrackDurationSeconds(layer.trackRef)
            }))
        );

        if (savePrevious) RuntimeManager.setPreviousSnapshot(PlaylistManager.createPlaybackSnapshot());

        clearScheduledHandles();
        clearMusicSequenceHandle();
        await PlaylistManager.stopLayer('music', soundScene.fadeOut ?? 0, null, { sync: false });
        await PlaylistManager.stopLayer('ambient', soundScene.fadeOut ?? 0, null, { sync: false });

        const musicLayers = getSceneLayers(soundScene, 'music');
        const playMusicLayerAtIndex = async (index, loopPhase = false) => {
            const layer = musicLayers[index] ?? null;
            if (!layer?.trackRef) return;

            const loopMode = String(layer.loopMode ?? 'once').trim() || 'once';
            await PlaylistManager.setTrackRepeat(layer.trackRef, loopMode === 'single');
            await PlaylistManager.playTrack(layer.trackRef, {
                layer: 'music',
                volume: layer.volume,
                fadeIn: layer.fadeIn,
                exclusive: true,
                sync: true
            });

            if (loopMode === 'single') {
                clearMusicSequenceHandle();
                return;
            }

            const durationSeconds = await PlaylistManager.getTrackDurationSeconds(layer.trackRef);
            const nextStep = getNextMusicLayerIndex(musicLayers, index, loopPhase);
            if (!durationSeconds || nextStep === null) {
                clearMusicSequenceHandle();
                return;
            }

            const handle = {
                timeoutId: null,
                cancelled: false,
                nextIndex: nextStep.nextIndex,
                loopPhase: nextStep.loopPhase
            };
            handle.timeoutId = window.setTimeout(async () => {
                if (handle.cancelled) return;
                await playMusicLayerAtIndex(nextStep.nextIndex, nextStep.loopPhase);
            }, Math.max(500, Math.ceil(durationSeconds * 1000) + 100));
            RuntimeManager.setMusicSequenceHandle(handle);
        };

        if (musicLayers.length) {
            await playMusicLayerAtIndex(0);
        }

        const ambientTracks = [];
        const scheduledHandles = [];
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
                await PlaylistManager.playTrack(scheduledLayer.trackRef, {
                    layer: 'cue',
                    volume: scheduledLayer.volume,
                    fadeIn: scheduledLayer.fadeIn,
                    exclusive: false,
                    recordRecent: false,
                    sync: true
                });
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
            durationSeconds: computeSceneMasterDurationSeconds(soundScene)
        });
        RuntimeManager.setAmbientTracks(ambientTracks);
        PlaylistManager.syncRuntimeLayers();
        PlaylistManager.invalidateCache('playlistSummary');
        return true;
    },

    async stopActiveSoundScene({ restorePrevious = false } = {}) {
        const activeSoundScene = this.getSoundScene(RuntimeManager.getState().activeSoundSceneId);
        const fadeOut = activeSoundScene?.fadeOut ?? StorageManager.getDefaultFadeSeconds();

        clearScheduledHandles();
        clearMusicSequenceHandle();
        await PlaylistManager.stopLayer('music', fadeOut, null, { sync: false });
        await PlaylistManager.stopLayer('ambient', fadeOut, null, { sync: false });
        RuntimeManager.setActiveSoundSceneId(null);
        RuntimeManager.clearSceneClock();
        PlaylistManager.syncRuntimeLayers();
        PlaylistManager.invalidateCache('playlistSummary');

        if (restorePrevious) {
            const snapshot = RuntimeManager.getPreviousSnapshot();
            if (snapshot) await PlaylistManager.restorePlaybackSnapshot(snapshot);
        }
    }
};
