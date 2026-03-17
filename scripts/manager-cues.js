// ==================================================================
// ===== MINSTREL CUE MANAGER =======================================
// ==================================================================

import { PlaylistManager } from './manager-playlists.js';
import { RuntimeManager } from './manager-runtime.js';
import { StorageManager } from './manager-storage.js';

async function duckTracks(trackStates, multiplier) {
    for (const trackState of trackStates) {
        await PlaylistManager.setTrackVolume(
            trackState.trackRef,
            Math.max(0, Math.min(1, Number(trackState.volume ?? 0.5) * multiplier))
        );
    }
}

export const CueManager = {
    getCues() {
        return StorageManager.getCues();
    },

    getCue(cueId) {
        return this.getCues().find((cue) => cue.id === cueId) ?? null;
    },

    async saveCue(cue) {
        const cues = this.getCues();
        const next = cues.some((entry) => entry.id === cue.id)
            ? cues.map((entry) => entry.id === cue.id ? cue : entry)
            : [...cues, cue];
        await StorageManager.saveCues(next);
        return cue;
    },

    async deleteCue(cueId) {
        const next = this.getCues().filter((cue) => cue.id !== cueId);
        await StorageManager.saveCues(next);
    },

    async triggerCue(cueId) {
        const cue = this.getCue(cueId);
        if (!cue || !cue.enabled || !cue.track) return false;
        if (RuntimeManager.isCueOnCooldown(cue.id)) return false;

        const activeMusic = RuntimeManager.getState().musicTrack
            ? [{
                trackRef: RuntimeManager.getState().musicTrack,
                volume: Number(RuntimeManager.getState().musicTrack?.volume ?? 0.75)
            }]
            : [];
        const activeAmbient = RuntimeManager.getState().ambientTracks.map((track) => ({
            trackRef: { ...track },
            volume: Number(track.volume ?? 0.65)
        }));
        const duckTargets = cue.duckOthers ? [...activeMusic, ...activeAmbient] : [];

        if (duckTargets.length) await duckTracks(duckTargets, 0.45);

        await PlaylistManager.playTrack(cue.track, {
            layer: 'cue',
            volume: cue.volume,
            fadeIn: 0,
            exclusive: false
        });

        if (duckTargets.length) {
            window.setTimeout(async () => {
                for (const trackState of activeMusic) await PlaylistManager.setTrackVolume(trackState.trackRef, trackState.volume);
                for (const trackState of activeAmbient) await PlaylistManager.setTrackVolume(trackState.trackRef, trackState.volume);
            }, 2500);
        }

        RuntimeManager.addRecentCue(cue.id);
        RuntimeManager.setCueCooldown(cue.id, Math.max(0, Number(cue.cooldown) || 0) * 1000);
        if (cue.stopOnSceneChange) RuntimeManager.addActiveCueRef(cue.track);
        return true;
    },

    async stopSceneChangeCues() {
        const cueRefs = RuntimeManager.getActiveCueRefs();
        for (const trackRef of cueRefs) {
            await PlaylistManager.stopTrack(trackRef, 0);
        }
        RuntimeManager.clearActiveCueRefs();
    }
};
