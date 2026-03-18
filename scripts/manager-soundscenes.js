// ==================================================================
// ===== MINSTREL SOUND SCENE MANAGER ===============================
// ==================================================================

import { PlaylistManager } from './manager-playlists.js';
import { RuntimeManager } from './manager-runtime.js';
import { StorageManager } from './manager-storage.js';

function wait(delayMs) {
    return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function getSceneLayers(soundScene, type) {
    if (Array.isArray(soundScene?.layers) && soundScene.layers.length) {
        return soundScene.layers.filter((layer) => layer.type === type && layer.enabled !== false);
    }

    if (type === 'music' && soundScene?.music) {
        return [{
            id: foundry.utils.randomID(),
            type: 'music',
            trackRef: soundScene.music,
            volume: soundScene.music.volume ?? soundScene.volumes?.music ?? 0.75,
            fadeIn: soundScene.fadeIn ?? 2,
            fadeOut: soundScene.fadeOut ?? 2,
            startDelayMs: 0,
            enabled: true
        }];
    }

    if (type === 'environment') {
        return (soundScene?.ambientTracks ?? []).map((track) => ({
            id: foundry.utils.randomID(),
            type: 'environment',
            trackRef: track,
            volume: track.volume ?? soundScene.volumes?.ambient ?? 0.65,
            fadeIn: track.fadeIn ?? soundScene.fadeIn ?? 2,
            fadeOut: track.fadeOut ?? soundScene.fadeOut ?? 2,
            startDelayMs: track.delayMs ?? 0,
            enabled: true
        }));
    }

    return [];
}

function clearScheduledHandles() {
    for (const handle of RuntimeManager.getScheduledLayerHandles()) {
        if (handle.timeoutId) window.clearTimeout(handle.timeoutId);
        if (handle.intervalId) window.clearInterval(handle.intervalId);
    }
    RuntimeManager.clearScheduledLayerHandles();
}

export const SoundSceneManager = {
    getSoundScenes() {
        return StorageManager.getSoundScenes();
    },

    getSoundScene(soundSceneId) {
        return this.getSoundScenes().find((scene) => scene.id === soundSceneId) ?? null;
    },

    async saveSoundScene(soundScene) {
        const soundScenes = this.getSoundScenes();
        const next = soundScenes.some((entry) => entry.id === soundScene.id)
            ? soundScenes.map((entry) => entry.id === soundScene.id ? soundScene : entry)
            : [...soundScenes, soundScene];
        await StorageManager.saveSoundScenes(next);
        return soundScene;
    },

    async deleteSoundScene(soundSceneId) {
        const next = this.getSoundScenes().filter((scene) => scene.id !== soundSceneId);
        await StorageManager.saveSoundScenes(next);
    },

    async activateSoundScene(soundSceneId, { savePrevious = true } = {}) {
        const soundScene = this.getSoundScene(soundSceneId);
        if (!soundScene || !soundScene.enabled) return false;

        if (savePrevious) RuntimeManager.setPreviousSnapshot(PlaylistManager.createPlaybackSnapshot());

        clearScheduledHandles();
        await PlaylistManager.stopLayer('music', soundScene.fadeOut ?? 0);
        await PlaylistManager.stopLayer('ambient', soundScene.fadeOut ?? 0);

        const musicLayer = getSceneLayers(soundScene, 'music')[0] ?? null;
        if (musicLayer?.trackRef) {
            if ((musicLayer.startDelayMs ?? 0) > 0) await wait(musicLayer.startDelayMs);
            await PlaylistManager.playTrack(musicLayer.trackRef, {
                layer: 'music',
                volume: musicLayer.volume,
                fadeIn: musicLayer.fadeIn,
                exclusive: true
            });
        }

        const ambientTracks = [];
        for (const ambientLayer of getSceneLayers(soundScene, 'environment')) {
            if (!ambientLayer.trackRef) continue;
            if ((ambientLayer.startDelayMs ?? 0) > 0) await wait(ambientLayer.startDelayMs);
            await PlaylistManager.playTrack(ambientLayer.trackRef, {
                layer: 'ambient',
                volume: ambientLayer.volume,
                fadeIn: ambientLayer.fadeIn,
                exclusive: false
            });
            ambientTracks.push(ambientLayer.trackRef);
        }

        const scheduledHandles = [];
        for (const scheduledLayer of getSceneLayers(soundScene, 'scheduled-one-shot')) {
            if (!scheduledLayer.trackRef) continue;
            const frequencyMs = Math.max(1000, Math.round((Number(scheduledLayer.frequencySeconds) || 120) * 1000));
            const triggerPlayback = async () => {
                await PlaylistManager.playTrack(scheduledLayer.trackRef, {
                    layer: 'cue',
                    volume: scheduledLayer.volume,
                    fadeIn: scheduledLayer.fadeIn,
                    exclusive: false,
                    recordRecent: false
                });
            };
            const timeoutId = window.setTimeout(() => {
                void triggerPlayback();
                const intervalId = window.setInterval(() => {
                    void triggerPlayback();
                }, frequencyMs);
                const handle = scheduledHandles.find((entry) => entry.timeoutId === timeoutId);
                if (handle) handle.intervalId = intervalId;
            }, Math.max(0, Number(scheduledLayer.startDelayMs) || 0));
            scheduledHandles.push({
                layerId: scheduledLayer.id,
                timeoutId,
                intervalId: null
            });
        }
        RuntimeManager.setScheduledLayerHandles(scheduledHandles);

        RuntimeManager.setActiveSoundSceneId(soundScene.id);
        RuntimeManager.setAmbientTracks(ambientTracks);
        return true;
    },

    async stopActiveSoundScene({ restorePrevious = false } = {}) {
        const activeSoundScene = this.getSoundScene(RuntimeManager.getState().activeSoundSceneId);
        const fadeOut = activeSoundScene?.fadeOut ?? StorageManager.getDefaultFadeSeconds();

        clearScheduledHandles();
        await PlaylistManager.stopLayer('music', fadeOut);
        await PlaylistManager.stopLayer('ambient', fadeOut);
        RuntimeManager.setActiveSoundSceneId(null);

        if (restorePrevious) {
            const snapshot = RuntimeManager.getPreviousSnapshot();
            if (snapshot) await PlaylistManager.restorePlaybackSnapshot(snapshot);
        }
    }
};
