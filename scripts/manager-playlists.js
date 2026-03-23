// ==================================================================
// ===== MINSTREL PLAYLIST MANAGER ==================================
// ==================================================================

import { RuntimeManager } from './manager-runtime.js';
import { StorageManager } from './manager-storage.js';

const durationCache = new Map();
const selectorCache = {
    allTrackRefs: null,
    trackOptions: null,
    playlistSummary: null,
    nowPlaying: null
};

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
    return normalizeChannelValue(
        sound?.channel
        ?? sound?._source?.channel
        ?? sound?.audioChannel
        ?? sound?._source?.audioChannel
        ?? sound?.audio?.channel
        ?? sound?.toObject?.()?.channel
    );
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
        sound?.sound?.sourceNode?.buffer?.duration
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

function isMinstrelOwnedPlaylist(playlist) {
    const type = String(playlist?.getFlag?.('coffee-pub-minstrel', 'type') ?? '').trim().toLowerCase();
    return type === 'scene' || type === 'cue-board';
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

function getPlaylistVisualTypeRank(visualType) {
    if (visualType === 'music') return 0;
    if (visualType === 'environment') return 1;
    if (visualType === 'oneshot') return 2;
    return 99;
}

function getPlaylistVisualTypeLabel(visualType) {
    if (visualType === 'music') return 'Music';
    if (visualType === 'environment') return 'Environment';
    if (visualType === 'oneshot') return 'One-Shot';
    return 'Mixed';
}

function getPlaylistPlaybackModeLabel(mode) {
    const numericMode = Number(mode);
    if (numericMode === -1) return 'Soundboard';
    if (numericMode === 0) return 'Sequential';
    if (numericMode === 1) return 'Shuffle';
    if (numericMode === 2) return 'Simultaneous';

    const playlistModes = CONST?.PLAYLIST_MODES ?? {};
    if (mode === playlistModes.DISABLED) return 'Soundboard';
    if (mode === playlistModes.SEQUENTIAL) return 'Sequential';
    if (mode === playlistModes.SHUFFLE) return 'Shuffle';
    if (mode === playlistModes.SIMULTANEOUS) return 'Simultaneous';

    const normalized = String(mode ?? '').trim().toLowerCase();
    if ((normalized === 'disabled') || (normalized === 'soundboard')) return 'Soundboard';
    if (normalized === 'sequential') return 'Sequential';
    if (normalized === 'shuffle') return 'Shuffle';
    if (normalized === 'simultaneous') return 'Simultaneous';

    return 'Unknown';
}

function getChannelLabel(channel) {
    if (channel === 'music') return 'Music';
    if (channel === 'ambient') return 'Environment';
    if (channel === 'cue') return 'One-Shot';
    return 'Track';
}

function getUpdateValue(source, key) {
    const direct = source?.[key];
    if (direct !== undefined) return direct;
    return source?._source?.[key];
}

async function updateSound(sound, updates) {
    if (!sound || !updates || typeof updates !== 'object') return;
    const normalizedUpdates = Object.fromEntries(Object.entries(updates).filter(([, value]) => value !== undefined));
    if (!Object.keys(normalizedUpdates).length) return;
    const changed = Object.entries(normalizedUpdates).some(([key, value]) => getUpdateValue(sound, key) !== value);
    if (!changed) return;
    await sound.update(normalizedUpdates);
}

function invalidateSelectorCache(...keys) {
    if (!keys.length) {
        for (const key of Object.keys(selectorCache)) selectorCache[key] = null;
        return;
    }
    for (const key of keys) selectorCache[key] = null;
}

function collectPlayingState() {
    let musicTrack = null;
    const ambientTracks = [];
    const playingTracks = [];

    for (const playlist of game.playlists?.contents ?? []) {
        for (const sound of playlist.sounds.contents) {
            if (!sound.playing) continue;
            const trackRef = createTrackRef(sound);
            if (!trackRef) continue;
            if (trackRef.channel === 'music') musicTrack = trackRef;
            if (trackRef.channel === 'ambient') ambientTracks.push(trackRef);
            playingTracks.push({
                trackRef,
                playlistId: playlist.id,
                playlistName: playlist.name,
                soundId: sound.id,
                soundName: sound.name,
                channel: trackRef.channel,
                volume: Number(sound.volume ?? 0.5),
                pausedTime: Number(sound.pausedTime ?? 0)
            });
        }
    }

    return { musicTrack, ambientTracks, playingTracks };
}

export const PlaylistManager = {
    createTrackRef,
    getSoundChannel,
    _batchDepth: 0,
    _syncPending: false,

    invalidateCache(...keys) {
        invalidateSelectorCache(...keys);
    },

    _beginBatch() {
        this._batchDepth += 1;
    },

    _endBatch() {
        this._batchDepth = Math.max(0, this._batchDepth - 1);
        if (this._batchDepth === 0 && this._syncPending) {
            this._syncPending = false;
            this.syncRuntimeLayers();
        }
    },

    _queueRuntimeSync() {
        invalidateSelectorCache('nowPlaying');
        if (this._batchDepth > 0) {
            this._syncPending = true;
            return;
        }
        this.syncRuntimeLayers();
    },

    async getTrackDurationSeconds(trackRef) {
        const { sound } = resolveTrackRef(trackRef);
        const liveDuration = sound ? getTrackDurationSecondsFromSound(sound) : 0;
        if (liveDuration > 0) return liveDuration;
        return getDurationSecondsFromPath(trackRef?.path ?? sound?.path ?? '');
    },

    syncRuntimeLayers() {
        const playingState = collectPlayingState();
        RuntimeManager.setMusicTrack(playingState.musicTrack);
        RuntimeManager.setAmbientTracks(playingState.ambientTracks);
        selectorCache.nowPlaying = {
            music: playingState.musicTrack,
            ambientTracks: playingState.ambientTracks.map((track) => ({ ...track })),
            activeTracks: playingState.playingTracks
        };
    },

    getAllTrackRefs() {
        if (!selectorCache.allTrackRefs) {
            selectorCache.allTrackRefs = (game.playlists?.contents ?? [])
                .filter((playlist) => !isMinstrelOwnedPlaylist(playlist))
                .flatMap((playlist) => playlist.sounds.contents.map((sound) => createTrackRef(sound)))
                .filter(Boolean)
                .sort((a, b) => a.label.localeCompare(b.label));
        }
        return selectorCache.allTrackRefs;
    },

    getTrackOptions() {
        if (!selectorCache.trackOptions) {
            selectorCache.trackOptions = this.getAllTrackRefs().map((ref) => ({
                value: `${ref.playlistId}::${ref.soundId}`,
                label: ref.label,
                channel: ref.channel,
                playlistName: ref.playlistName,
                soundName: ref.soundName
            }));
        }
        return selectorCache.trackOptions;
    },

    parseTrackRefValue(value) {
        if (!value || typeof value !== 'string' || !value.includes('::')) return null;
        const [playlistId, soundId] = value.split('::');
        const { sound } = resolveTrackRef({ playlistId, soundId });
        return sound ? createTrackRef(sound) : null;
    },

    getPlaylistSummary() {
        if (!selectorCache.playlistSummary) {
            const favoriteTrackKeys = new Set(StorageManager.getFavorites().map((entry) => `${entry.playlistId}::${entry.soundId}`));
            const recentTrackKeys = new Set(StorageManager.getRecents().map((entry) => `${entry.playlistId}::${entry.soundId}`));
            const favoritePlaylistIds = new Set(StorageManager.getFavoritePlaylists().map((entry) => entry.playlistId));

            selectorCache.playlistSummary = (game.playlists?.contents ?? [])
                .filter((playlist) => !isMinstrelOwnedPlaylist(playlist))
                .slice()
                .map((playlist) => {
                    const sounds = playlist.sounds.contents.map((sound) => {
                        const ref = createTrackRef(sound);
                        const trackKey = ref ? `${ref.playlistId}::${ref.soundId}` : '';
                        const channel = ref?.channel ?? 'unknown';
                        const repeats = !!(sound.repeat ?? sound._source?.repeat);
                        return {
                            id: sound.id,
                            name: sound.name,
                            path: sound.path,
                            volume: Number(sound.volume ?? 0.5),
                            volumePercent: Math.round((Number(sound.volume ?? 0.5) || 0) * 100),
                            channel,
                            channelLabel: getChannelLabel(channel),
                            playing: !!sound.playing,
                            statusLabel: sound.playing ? 'Playing' : 'Idle',
                            pausedTime: Number(sound.pausedTime ?? 0),
                            repeats,
                            repeatLabel: repeats ? 'Repeats' : 'Single pass',
                            favorite: favoriteTrackKeys.has(trackKey),
                            recent: recentTrackKeys.has(trackKey),
                            trackRef: ref,
                            cardClass: channel === 'music'
                                ? 'minstrel-card-music'
                                : channel === 'ambient'
                                    ? 'minstrel-card-environment'
                                    : 'minstrel-card-oneshot',
                            iconClass: channel === 'music'
                                ? 'fa-solid fa-music-note'
                                : channel === 'ambient'
                                    ? 'fa-solid fa-waveform'
                                    : 'fa-solid fa-volume'
                        };
                    }).sort((a, b) => String(a?.name ?? '').localeCompare(String(b?.name ?? '')));
                    const visualType = getPlaylistVisualType(sounds);
                    return {
                        id: playlist.id,
                        name: playlist.name,
                        mode: playlist.mode,
                        playbackModeLabel: getPlaylistPlaybackModeLabel(playlist.mode),
                        playing: !!playlist.playing,
                        isActive: !!playlist.playing || sounds.some((sound) => sound.playing),
                        favorite: favoritePlaylistIds.has(playlist.id),
                        sounds,
                        visualType,
                        visualTypeLabel: getPlaylistVisualTypeLabel(visualType),
                        cardClass: visualType === 'music' ? 'minstrel-card-music' : visualType === 'environment' ? 'minstrel-card-environment' : 'minstrel-card-oneshot',
                        iconClass: visualType === 'music' ? 'fa-solid fa-music' : visualType === 'environment' ? 'fa-solid fa-wind' : 'fa-solid fa-bolt'
                    };
                }).sort((a, b) => {
                    const nameCompare = String(a?.name ?? '').localeCompare(String(b?.name ?? ''), undefined, { sensitivity: 'base' });
                    if (nameCompare !== 0) return nameCompare;
                    const typeCompare = getPlaylistVisualTypeRank(a?.visualType) - getPlaylistVisualTypeRank(b?.visualType);
                    if (typeCompare !== 0) return typeCompare;
                    return String(a?.id ?? '').localeCompare(String(b?.id ?? ''), undefined, { sensitivity: 'base' });
                });
        }
        return selectorCache.playlistSummary;
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
        invalidateSelectorCache('playlistSummary');
        return !exists;
    },

    getNowPlaying() {
        if (!selectorCache.nowPlaying) this.syncRuntimeLayers();
        return selectorCache.nowPlaying;
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

        this._beginBatch();
        try {
            await this.stopAllAudio(null, { sync: false });
            for (const track of snapshot.tracks) {
                const layer = track.channel === 'music' ? 'music' : track.channel === 'ambient' ? 'ambient' : 'cue';
                await this.playTrack(track, {
                    layer,
                    volume: track.volume,
                    fadeIn: 0,
                    exclusive: layer === 'music',
                    recordRecent: false,
                    sync: false
                });
            }
            this._queueRuntimeSync();
        } finally {
            this._endBatch();
        }
    },

    async playTrack(trackRef, {
        layer = 'music',
        volume = null,
        fadeIn = null,
        exclusive = true,
        recordRecent = true,
        sync = true
    } = {}) {
        const { playlist, sound } = resolveTrackRef(trackRef);
        if (!playlist || !sound) return false;

        const effectiveFade = fadeIn ?? StorageManager.getDefaultFadeSeconds();
        const updates = {};
        if (volume !== null && Number.isFinite(Number(volume))) updates.volume = Number(volume);
        updates.fade = getFadeMilliseconds(effectiveFade);
        updates.pausedTime = 0;

        if (layer === 'music' && exclusive) {
            await this.stopLayer('music', effectiveFade, trackRef, { sync: false });
        }

        await updateSound(sound, updates);
        if (typeof playlist.playSound === 'function') {
            await playlist.playSound(sound);
        } else {
            await updateSound(sound, { playing: true });
        }

        invalidateSelectorCache('playlistSummary', 'nowPlaying');
        if (recordRecent) await this.pushRecent(createTrackRef(sound));
        if (sync) this._queueRuntimeSync();

        return true;
    },

    async stopTrack(trackRef, fadeOut = null, { sync = true } = {}) {
        const { playlist, sound } = resolveTrackRef(trackRef);
        if (!playlist || !sound) return false;

        const effectiveFade = fadeOut ?? StorageManager.getDefaultFadeSeconds();
        await updateSound(sound, { fade: getFadeMilliseconds(effectiveFade) });
        if (typeof playlist.stopSound === 'function') {
            await playlist.stopSound(sound);
        } else {
            await updateSound(sound, { playing: false });
        }

        invalidateSelectorCache('playlistSummary', 'nowPlaying');
        if (sync) this._queueRuntimeSync();
        return true;
    },

    async pauseTrack(trackRef) {
        const { sound } = resolveTrackRef(trackRef);
        if (!sound) return false;
        const pausedTime = Number(sound.sound?.currentTime ?? sound.pausedTime ?? 0);
        await updateSound(sound, { playing: false, pausedTime });
        invalidateSelectorCache('playlistSummary', 'nowPlaying');
        this._queueRuntimeSync();
        return true;
    },

    async resumeTrack(trackRef) {
        const { sound } = resolveTrackRef(trackRef);
        if (!sound) return false;
        await updateSound(sound, { playing: true });
        invalidateSelectorCache('playlistSummary', 'nowPlaying');
        this._queueRuntimeSync();
        return true;
    },

    async setTrackVolume(trackRef, volume) {
        const { sound } = resolveTrackRef(trackRef);
        if (!sound) return false;
        await updateSound(sound, { volume: Math.min(1, Math.max(0, Number(volume) || 0)) });
        invalidateSelectorCache('playlistSummary', 'nowPlaying');
        return true;
    },

    async setTrackRepeat(trackRef, repeat, { sync = false } = {}) {
        const { sound } = resolveTrackRef(trackRef);
        if (!sound) return false;
        await updateSound(sound, { repeat: !!repeat });
        invalidateSelectorCache('playlistSummary', 'nowPlaying');
        if (sync) this._queueRuntimeSync();
        return true;
    },

    async toggleTrackRepeat(trackRef) {
        const { sound } = resolveTrackRef(trackRef);
        if (!sound) return false;
        const nextRepeat = !(sound.repeat ?? sound._source?.repeat);
        await updateSound(sound, { repeat: nextRepeat });
        invalidateSelectorCache('playlistSummary');
        return nextRepeat;
    },

    async stopLayer(layer, fadeOut = null, exceptTrackRef = null, { sync = true } = {}) {
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

        this._beginBatch();
        try {
            for (const track of targets) {
                if (exceptTrackRef && isSameRef(track, exceptTrackRef)) continue;
                await this.stopTrack(track, fadeOut, { sync: false });
            }
            if (sync) this._queueRuntimeSync();
        } finally {
            this._endBatch();
        }
    },

    async stopAllAudio(fadeOut = null, { sync = true } = {}) {
        const tracks = [];
        for (const playlist of game.playlists?.contents ?? []) {
            for (const sound of playlist.sounds.contents) {
                if (sound.playing) tracks.push(createTrackRef(sound));
            }
        }
        this._beginBatch();
        try {
            for (const trackRef of tracks) {
                await this.stopTrack(trackRef, fadeOut, { sync: false });
            }
            if (sync) this._queueRuntimeSync();
        } finally {
            this._endBatch();
        }
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

    async playPlaylist(playlistId) {
        const playlist = game.playlists?.get(playlistId) ?? null;
        if (!playlist) return false;

        if (typeof playlist.playAll === 'function') {
            await playlist.playAll();
        } else {
            const firstSound = playlist.sounds?.contents?.[0] ?? null;
            if (!firstSound) return false;
            const ref = createTrackRef(firstSound);
            if (!ref) return false;
            await this.playTrack(ref, {
                layer: ref.channel === 'ambient' ? 'ambient' : ref.channel === 'cue' ? 'cue' : 'music',
                exclusive: ref.channel === 'music'
            });
            return true;
        }

        invalidateSelectorCache('playlistSummary', 'nowPlaying');
        this._queueRuntimeSync();
        return true;
    },

    async stopPlaylist(playlistId) {
        const playlist = game.playlists?.get(playlistId) ?? null;
        if (!playlist) return false;

        if (typeof playlist.stopAll === 'function') {
            await playlist.stopAll();
        } else {
            this._beginBatch();
            try {
                for (const sound of playlist.sounds?.contents ?? []) {
                    if (!sound.playing) continue;
                    const ref = createTrackRef(sound);
                    if (!ref) continue;
                    await this.stopTrack(ref, null, { sync: false });
                }
                this._queueRuntimeSync();
            } finally {
                this._endBatch();
            }
            return true;
        }

        invalidateSelectorCache('playlistSummary', 'nowPlaying');
        this._queueRuntimeSync();
        return true;
    },

    async toggleFavorite(trackRef) {
        const favorites = StorageManager.getFavorites();
        const exists = favorites.some((entry) => isSameRef(entry, trackRef));
        const next = exists
            ? favorites.filter((entry) => !isSameRef(entry, trackRef))
            : [trackRef, ...favorites];
        await StorageManager.saveFavorites(next);
        invalidateSelectorCache('playlistSummary');
        return !exists;
    },

    async pushRecent(trackRef) {
        const recents = StorageManager.getRecents();
        const next = [trackRef, ...recents.filter((entry) => !isSameRef(entry, trackRef))]
            .slice(0, StorageManager.getRecentLimit());
        await StorageManager.saveRecents(next);
        invalidateSelectorCache('playlistSummary');
    }
};
