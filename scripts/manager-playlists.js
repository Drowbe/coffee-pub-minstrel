// ==================================================================
// ===== MINSTREL PLAYLIST MANAGER ==================================
// ==================================================================

import { RuntimeManager } from './manager-runtime.js';
import { StorageManager } from './manager-storage.js';

function getFadeMilliseconds(seconds) {
    return Math.max(0, Math.round((Number(seconds) || 0) * 1000));
}

function resolveTrackRef(trackRef) {
    if (!trackRef?.playlistId || !trackRef?.soundId) return { playlist: null, sound: null };
    const playlist = game.playlists?.get(trackRef.playlistId) ?? null;
    const sound = playlist?.sounds?.get(trackRef.soundId) ?? null;
    return { playlist, sound };
}

function createTrackRef(sound) {
    if (!sound?.parent?.id || !sound?.id) return null;
    return {
        playlistId: sound.parent.id,
        soundId: sound.id,
        label: `${sound.parent.name} / ${sound.name}`,
        playlistName: sound.parent.name,
        soundName: sound.name,
        path: sound.path ?? '',
        volume: Number(sound.volume ?? 0.5)
    };
}

function isSameRef(a, b) {
    return !!a && !!b && a.playlistId === b.playlistId && a.soundId === b.soundId;
}

async function updateSound(sound, updates) {
    if (!sound || !updates || typeof updates !== 'object') return;
    await sound.update(updates);
}

export const PlaylistManager = {
    createTrackRef,

    getAllTrackRefs() {
        return (game.playlists?.contents ?? [])
            .flatMap((playlist) => playlist.sounds.contents.map((sound) => createTrackRef(sound)))
            .filter(Boolean)
            .sort((a, b) => a.label.localeCompare(b.label));
    },

    getTrackOptions() {
        return this.getAllTrackRefs().map((ref) => ({
            value: `${ref.playlistId}::${ref.soundId}`,
            label: ref.label
        }));
    },

    parseTrackRefValue(value) {
        if (!value || typeof value !== 'string' || !value.includes('::')) return null;
        const [playlistId, soundId] = value.split('::');
        const { sound } = resolveTrackRef({ playlistId, soundId });
        return sound ? createTrackRef(sound) : null;
    },

    getPlaylistSummary() {
        const favorites = StorageManager.getFavorites();
        const recents = StorageManager.getRecents();
        return (game.playlists?.contents ?? []).map((playlist) => ({
            id: playlist.id,
            name: playlist.name,
            mode: playlist.mode,
            playing: !!playlist.playing,
            sounds: playlist.sounds.contents.map((sound) => {
                const ref = createTrackRef(sound);
                return {
                    id: sound.id,
                    name: sound.name,
                    path: sound.path,
                    volume: Number(sound.volume ?? 0.5),
                    playing: !!sound.playing,
                    pausedTime: Number(sound.pausedTime ?? 0),
                    favorite: favorites.some((entry) => isSameRef(entry, ref)),
                    recent: recents.some((entry) => isSameRef(entry, ref)),
                    trackRef: ref
                };
            })
        }));
    },

    getNowPlaying() {
        const playingTracks = [];
        for (const playlist of game.playlists?.contents ?? []) {
            for (const sound of playlist.sounds.contents) {
                if (!sound.playing) continue;
                playingTracks.push({
                    trackRef: createTrackRef(sound),
                    playlistId: playlist.id,
                    playlistName: playlist.name,
                    soundId: sound.id,
                    soundName: sound.name,
                    volume: Number(sound.volume ?? 0.5),
                    pausedTime: Number(sound.pausedTime ?? 0)
                });
            }
        }
        return {
            music: RuntimeManager.getState().musicTrack,
            ambientTracks: RuntimeManager.getState().ambientTracks.map((track) => ({ ...track })),
            activeTracks: playingTracks
        };
    },

    createPlaybackSnapshot() {
        const tracks = [];
        for (const playlist of game.playlists?.contents ?? []) {
            for (const sound of playlist.sounds.contents) {
                if (!sound.playing) continue;
                tracks.push({
                    ...createTrackRef(sound),
                    volume: Number(sound.volume ?? 0.5),
                    pausedTime: Number(sound.pausedTime ?? 0),
                    fade: Number(sound.fade ?? playlist.fade ?? 0)
                });
            }
        }
        return {
            musicTrack: RuntimeManager.getState().musicTrack ? { ...RuntimeManager.getState().musicTrack } : null,
            ambientTracks: RuntimeManager.getState().ambientTracks.map((track) => ({ ...track })),
            tracks
        };
    },

    async restorePlaybackSnapshot(snapshot) {
        if (!snapshot?.tracks?.length) {
            await this.stopAllAudio();
            return;
        }

        await this.stopAllAudio();
        for (const track of snapshot.tracks) {
            const layer = isSameRef(track, snapshot.musicTrack) ? 'music' : 'ambient';
            await this.playTrack(track, {
                layer,
                volume: track.volume,
                fadeIn: 0,
                exclusive: layer === 'music',
                recordRecent: false
            });
        }
    },

    async playTrack(trackRef, {
        layer = 'music',
        volume = null,
        fadeIn = null,
        exclusive = true,
        recordRecent = true
    } = {}) {
        const { playlist, sound } = resolveTrackRef(trackRef);
        if (!playlist || !sound) return false;

        const effectiveFade = fadeIn ?? StorageManager.getDefaultFadeSeconds();
        const updates = {};
        if (volume !== null && Number.isFinite(Number(volume))) updates.volume = Number(volume);
        updates.fade = getFadeMilliseconds(effectiveFade);
        updates.pausedTime = 0;

        if (layer === 'music' && exclusive) {
            await this.stopLayer('music', effectiveFade, trackRef);
        }

        await updateSound(sound, updates);
        if (typeof playlist.playSound === 'function') {
            await playlist.playSound(sound);
        } else {
            await updateSound(sound, { playing: true });
        }

        if (layer === 'music') RuntimeManager.setMusicTrack(createTrackRef(sound));
        if (layer === 'ambient') RuntimeManager.addAmbientTrack(createTrackRef(sound));
        if (recordRecent) await this.pushRecent(createTrackRef(sound));

        return true;
    },

    async stopTrack(trackRef, fadeOut = null) {
        const { playlist, sound } = resolveTrackRef(trackRef);
        if (!playlist || !sound) return false;

        const effectiveFade = fadeOut ?? StorageManager.getDefaultFadeSeconds();
        await updateSound(sound, { fade: getFadeMilliseconds(effectiveFade) });
        if (typeof playlist.stopSound === 'function') {
            await playlist.stopSound(sound);
        } else {
            await updateSound(sound, { playing: false });
        }

        if (isSameRef(RuntimeManager.getState().musicTrack, trackRef)) RuntimeManager.setMusicTrack(null);
        RuntimeManager.removeAmbientTrack(trackRef);
        return true;
    },

    async pauseTrack(trackRef) {
        const { sound } = resolveTrackRef(trackRef);
        if (!sound) return false;
        const pausedTime = Number(sound.sound?.currentTime ?? sound.pausedTime ?? 0);
        await updateSound(sound, { playing: false, pausedTime });
        return true;
    },

    async resumeTrack(trackRef) {
        const { sound } = resolveTrackRef(trackRef);
        if (!sound) return false;
        await updateSound(sound, { playing: true });
        return true;
    },

    async setTrackVolume(trackRef, volume) {
        const { sound } = resolveTrackRef(trackRef);
        if (!sound) return false;
        await updateSound(sound, { volume: Math.min(1, Math.max(0, Number(volume) || 0)) });
        return true;
    },

    async stopLayer(layer, fadeOut = null, exceptTrackRef = null) {
        const runtime = RuntimeManager.getState();
        const targets = layer === 'music'
            ? (runtime.musicTrack ? [runtime.musicTrack] : [])
            : runtime.ambientTracks;

        for (const track of targets) {
            if (exceptTrackRef && isSameRef(track, exceptTrackRef)) continue;
            await this.stopTrack(track, fadeOut);
        }

        if (layer === 'music') RuntimeManager.setMusicTrack(null);
        if (layer === 'ambient') RuntimeManager.setAmbientTracks([]);
    },

    async stopAllAudio(fadeOut = null) {
        const tracks = [];
        for (const playlist of game.playlists?.contents ?? []) {
            for (const sound of playlist.sounds.contents) {
                if (sound.playing) tracks.push(createTrackRef(sound));
            }
        }
        for (const trackRef of tracks) {
            await this.stopTrack(trackRef, fadeOut);
        }
        RuntimeManager.setMusicTrack(null);
        RuntimeManager.setAmbientTracks([]);
    },

    async skipPlaylist(playlistId) {
        const playlist = game.playlists?.get(playlistId) ?? null;
        if (!playlist) return false;
        if (typeof playlist.playNext === 'function') {
            await playlist.playNext();
            return true;
        }
        return false;
    },

    async toggleFavorite(trackRef) {
        const favorites = StorageManager.getFavorites();
        const exists = favorites.some((entry) => isSameRef(entry, trackRef));
        const next = exists
            ? favorites.filter((entry) => !isSameRef(entry, trackRef))
            : [trackRef, ...favorites];
        await StorageManager.saveFavorites(next);
        return !exists;
    },

    async pushRecent(trackRef) {
        const recents = StorageManager.getRecents();
        const next = [trackRef, ...recents.filter((entry) => !isSameRef(entry, trackRef))]
            .slice(0, StorageManager.getRecentLimit());
        await StorageManager.saveRecents(next);
    }
};
