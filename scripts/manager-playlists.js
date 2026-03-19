// ==================================================================
// ===== MINSTREL PLAYLIST MANAGER ==================================
// ==================================================================

import { RuntimeManager } from './manager-runtime.js';
import { StorageManager } from './manager-storage.js';

const durationCache = new Map();

function getFadeMilliseconds(seconds) {
    return Math.max(0, Math.round((Number(seconds) || 0) * 1000));
}

function resolveTrackRef(trackRef) {
    if (!trackRef?.playlistId || !trackRef?.soundId) return { playlist: null, sound: null };
    const playlist = game.playlists?.get(trackRef.playlistId) ?? null;
    const sound = playlist?.sounds?.get(trackRef.soundId) ?? null;
    return { playlist, sound };
}

function normalizeChannelValue(channel) {
    const value = String(channel ?? '').trim().toLowerCase();
    if (value === 'music') return 'music';
    if (value === 'environment') return 'ambient';
    if (value === 'interface') return 'cue';
    return 'unknown';
}

function getSoundChannel(sound) {
    return normalizeChannelValue(sound?.channel ?? sound?.audioChannel ?? sound?.audio?.channel);
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
        volume: Number(sound.volume ?? 0.5),
        playing: !!sound.playing,
        channel: getSoundChannel(sound)
    };
}

function getTrackDurationSecondsFromSound(sound) {
    const candidates = [
        sound?.duration,
        sound?.audio?.duration,
        sound?.sound?.duration,
        sound?.sound?.buffer?.duration,
        sound?.sound?.node?.buffer?.duration
    ];

    for (const candidate of candidates) {
        const value = Number(candidate);
        if (Number.isFinite(value) && value > 0) return value;
    }

    return 0;
}

async function getDurationSecondsFromPath(path) {
    const key = String(path ?? '').trim();
    if (!key) return 0;
    if (durationCache.has(key)) return durationCache.get(key);

    const promise = new Promise((resolve) => {
        const audio = new Audio();

        const cleanup = () => {
            audio.removeEventListener('loadedmetadata', onLoadedMetadata);
            audio.removeEventListener('error', onError);
            audio.preload = 'none';
            audio.src = '';
        };

        const onLoadedMetadata = () => {
            const duration = Number(audio.duration);
            cleanup();
            resolve(Number.isFinite(duration) && duration > 0 ? duration : 0);
        };

        const onError = () => {
            cleanup();
            resolve(0);
        };

        audio.preload = 'metadata';
        audio.addEventListener('loadedmetadata', onLoadedMetadata, { once: true });
        audio.addEventListener('error', onError, { once: true });
        audio.src = key;
        audio.load();
    }).then((duration) => {
        durationCache.set(key, duration);
        return duration;
    });

    durationCache.set(key, promise);
    return promise;
}

function isSameRef(a, b) {
    return !!a && !!b && a.playlistId === b.playlistId && a.soundId === b.soundId;
}

function getPlaylistVisualType(sounds = []) {
    const counts = sounds.reduce((accumulator, sound) => {
        const channel = String(sound?.channel ?? 'unknown');
        accumulator[channel] = (accumulator[channel] ?? 0) + 1;
        return accumulator;
    }, {});

    if ((counts.music ?? 0) >= Math.max(counts.ambient ?? 0, counts.cue ?? 0)) return 'music';
    if ((counts.ambient ?? 0) >= Math.max(counts.music ?? 0, counts.cue ?? 0)) return 'environment';
    if ((counts.cue ?? 0) > 0) return 'oneshot';
    return 'music';
}

async function updateSound(sound, updates) {
    if (!sound || !updates || typeof updates !== 'object') return;
    await sound.update(updates);
}

export const PlaylistManager = {
    createTrackRef,
    getSoundChannel,

    async getTrackDurationSeconds(trackRef) {
        const { sound } = resolveTrackRef(trackRef);
        const liveDuration = sound ? getTrackDurationSecondsFromSound(sound) : 0;
        if (liveDuration > 0) return liveDuration;
        return getDurationSecondsFromPath(trackRef?.path ?? sound?.path ?? '');
    },

    syncRuntimeLayers() {
        let musicTrack = null;
        const ambientTracks = [];

        for (const playlist of game.playlists?.contents ?? []) {
            for (const sound of playlist.sounds.contents) {
                if (!sound.playing) continue;
                const trackRef = createTrackRef(sound);
                if (!trackRef) continue;
                if (trackRef.channel === 'music') musicTrack = trackRef;
                if (trackRef.channel === 'ambient') ambientTracks.push(trackRef);
            }
        }

        RuntimeManager.setMusicTrack(musicTrack);
        RuntimeManager.setAmbientTracks(ambientTracks);
    },

    getAllTrackRefs() {
        return (game.playlists?.contents ?? [])
            .flatMap((playlist) => playlist.sounds.contents.map((sound) => createTrackRef(sound)))
            .filter(Boolean)
            .sort((a, b) => a.label.localeCompare(b.label));
    },

    getTrackOptions() {
        return this.getAllTrackRefs().map((ref) => ({
            value: `${ref.playlistId}::${ref.soundId}`,
            label: ref.label,
            channel: ref.channel,
            playlistName: ref.playlistName,
            soundName: ref.soundName
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
        const favoritePlaylists = StorageManager.getFavoritePlaylists();
        const recents = StorageManager.getRecents();
        return (game.playlists?.contents ?? []).map((playlist) => {
            const sounds = playlist.sounds.contents.map((sound) => {
                const ref = createTrackRef(sound);
                return {
                    id: sound.id,
                    name: sound.name,
                    path: sound.path,
                    volume: Number(sound.volume ?? 0.5),
                    channel: ref?.channel ?? 'unknown',
                    playing: !!sound.playing,
                    pausedTime: Number(sound.pausedTime ?? 0),
                    favorite: favorites.some((entry) => isSameRef(entry, ref)),
                    recent: recents.some((entry) => isSameRef(entry, ref)),
                    trackRef: ref,
                    cardClass: (ref?.channel ?? 'music') === 'music'
                        ? 'minstrel-card-music'
                        : (ref?.channel ?? 'music') === 'ambient'
                            ? 'minstrel-card-environment'
                            : 'minstrel-card-oneshot',
                    iconClass: (ref?.channel ?? 'music') === 'music'
                        ? 'fa-solid fa-music'
                        : (ref?.channel ?? 'music') === 'ambient'
                            ? 'fa-solid fa-wind'
                            : 'fa-solid fa-bolt'
                };
            });
            const visualType = getPlaylistVisualType(sounds);
            return {
                id: playlist.id,
                name: playlist.name,
                mode: playlist.mode,
                playing: !!playlist.playing,
                favorite: favoritePlaylists.some((entry) => entry.playlistId === playlist.id),
                sounds,
                visualType,
                cardClass: visualType === 'music' ? 'minstrel-card-music' : visualType === 'environment' ? 'minstrel-card-environment' : 'minstrel-card-oneshot',
                iconClass: visualType === 'music' ? 'fa-solid fa-music' : visualType === 'environment' ? 'fa-solid fa-wind' : 'fa-solid fa-bolt'
            };
        });
    },

    async toggleFavoritePlaylist(playlistId) {
        const playlist = game.playlists?.get(playlistId) ?? null;
        if (!playlist) return false;
        const favorites = StorageManager.getFavoritePlaylists();
        const exists = favorites.some((entry) => entry.playlistId === playlist.id);
        const next = exists
            ? favorites.filter((entry) => entry.playlistId !== playlist.id)
            : [{ playlistId: playlist.id, playlistName: playlist.name }, ...favorites];
        await StorageManager.saveFavoritePlaylists(next);
        return !exists;
    },

    getNowPlaying() {
        this.syncRuntimeLayers();
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
                    channel: getSoundChannel(sound),
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
            const layer = track.channel === 'music' ? 'music' : track.channel === 'ambient' ? 'ambient' : 'cue';
            await this.playTrack(track, {
                layer,
                volume: track.volume,
                fadeIn: 0,
                exclusive: layer === 'music',
                recordRecent: false
            });
        }
        this.syncRuntimeLayers();
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

        this.syncRuntimeLayers();
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

        this.syncRuntimeLayers();
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
        const targets = [];
        for (const playlist of game.playlists?.contents ?? []) {
            for (const sound of playlist.sounds.contents) {
                if (!sound.playing) continue;
                const trackRef = createTrackRef(sound);
                if (!trackRef) continue;
                if (trackRef.channel !== layer) continue;
                targets.push(trackRef);
            }
        }

        for (const track of targets) {
            if (exceptTrackRef && isSameRef(track, exceptTrackRef)) continue;
            await this.stopTrack(track, fadeOut);
        }

        this.syncRuntimeLayers();
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
        this.syncRuntimeLayers();
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
