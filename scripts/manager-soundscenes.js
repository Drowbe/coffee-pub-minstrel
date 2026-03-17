// ==================================================================
// ===== MINSTREL SOUND SCENE MANAGER ===============================
// ==================================================================

import { PlaylistManager } from './manager-playlists.js';
import { RuntimeManager } from './manager-runtime.js';
import { StorageManager } from './manager-storage.js';

function wait(delayMs) {
    return new Promise((resolve) => setTimeout(resolve, delayMs));
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

        await PlaylistManager.stopLayer('music', soundScene.fadeOut ?? 0);
        await PlaylistManager.stopLayer('ambient', soundScene.fadeOut ?? 0);

        if (soundScene.music) {
            await PlaylistManager.playTrack(soundScene.music, {
                layer: 'music',
                volume: soundScene.music.volume ?? soundScene.volumes.music,
                fadeIn: soundScene.fadeIn,
                exclusive: true
            });
        }

        const ambientTracks = [];
        for (const ambientTrack of soundScene.ambientTracks) {
            if ((ambientTrack.delayMs ?? 0) > 0) await wait(ambientTrack.delayMs);
            await PlaylistManager.playTrack(ambientTrack, {
                layer: 'ambient',
                volume: ambientTrack.volume ?? soundScene.volumes.ambient,
                fadeIn: ambientTrack.fadeIn ?? soundScene.fadeIn,
                exclusive: false
            });
            ambientTracks.push(ambientTrack);
        }

        RuntimeManager.setActiveSoundSceneId(soundScene.id);
        RuntimeManager.setAmbientTracks(ambientTracks);
        return true;
    },

    async stopActiveSoundScene({ restorePrevious = false } = {}) {
        const activeSoundScene = this.getSoundScene(RuntimeManager.getState().activeSoundSceneId);
        const fadeOut = activeSoundScene?.fadeOut ?? StorageManager.getDefaultFadeSeconds();

        await PlaylistManager.stopLayer('music', fadeOut);
        await PlaylistManager.stopLayer('ambient', fadeOut);
        RuntimeManager.setActiveSoundSceneId(null);

        if (restorePrevious) {
            const snapshot = RuntimeManager.getPreviousSnapshot();
            if (snapshot) await PlaylistManager.restorePlaybackSnapshot(snapshot);
        }
    }
};
