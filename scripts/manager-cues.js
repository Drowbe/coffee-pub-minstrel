// ==================================================================
// ===== MINSTREL CUE MANAGER =======================================
// ==================================================================

import { MODULE } from './const.js';
import { PlaylistManager } from './manager-playlists.js';
import { RuntimeManager } from './manager-runtime.js';
import { StorageManager } from './manager-storage.js';

const PLAYLIST_TYPE_CUE_BOARD = 'cue-board';
const CUE_PLAYLIST_PREFIX = '[CUE]';
const cueCache = {
    cues: null
};

function normalizeCueIcon(icon) {
    const value = String(icon ?? '').trim();
    if (!value) return 'fa-solid fa-bell';
    if (value.includes(' ')) return value;
    if (value.startsWith('fa-')) return `fa-solid ${value}`;
    return `fa-solid fa-${value}`;
}

function parseCueId(cueId) {
    if (!cueId || typeof cueId !== 'string' || !cueId.includes('::')) return { playlistId: null, soundId: null };
    const [playlistId, soundId] = cueId.split('::');
    return { playlistId, soundId };
}

function getCueBoardPlaylists() {
    return (game.playlists?.contents ?? [])
        .filter((playlist) => playlist?.getFlag?.(MODULE.ID, 'type') === PLAYLIST_TYPE_CUE_BOARD)
        .sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? ''), undefined, { sensitivity: 'base' }));
}

function getCueBoardMeta(playlist) {
    return foundry.utils.deepClone(playlist?.getFlag?.(MODULE.ID, 'cueBoardMeta') ?? {});
}

function getCueMeta(sound) {
    return foundry.utils.deepClone(sound?.getFlag?.(MODULE.ID, 'cueMeta') ?? {});
}

function formatCueBoardPlaylistName(boardName) {
    const baseName = String(boardName ?? 'General').trim() || 'General';
    return `${CUE_PLAYLIST_PREFIX} ${baseName}`;
}

function sanitizeSourceTrackRef(trackRef) {
    if (!trackRef || typeof trackRef !== 'object') return null;
    if (!trackRef.playlistId || !trackRef.soundId) return null;
    const ref = PlaylistManager.parseTrackRefValue(`${trackRef.playlistId}::${trackRef.soundId}`);
    return ref ?? null;
}

function resolveLegacySourceTrack(sound) {
    const normalizedPath = String(sound?.path ?? '').trim().toLowerCase();
    if (!normalizedPath) return null;

    const candidates = PlaylistManager.getAllTrackRefs()
        .filter((trackRef) => trackRef?.channel === 'cue')
        .filter((trackRef) => String(trackRef.path ?? '').trim().toLowerCase() === normalizedPath)
        .filter((trackRef) => {
            const playlist = game.playlists?.get(trackRef.playlistId) ?? null;
            return playlist?.getFlag?.(MODULE.ID, 'type') !== PLAYLIST_TYPE_CUE_BOARD;
        });

    return candidates[0] ?? null;
}

function buildCueFromSound(playlist, sound) {
    const cueMeta = getCueMeta(sound);
    const track = sanitizeSourceTrackRef(cueMeta.sourceTrack)
        ?? resolveLegacySourceTrack(sound)
        ?? PlaylistManager.createTrackRef(sound);
    if (!track) return null;
    return {
        id: `${playlist.id}::${sound.id}`,
        name: String(sound.name ?? 'New Cue').trim() || 'New Cue',
        icon: normalizeCueIcon(cueMeta.icon ?? 'fa-solid fa-bell'),
        category: String(getCueBoardMeta(playlist).boardName ?? playlist.name ?? 'General')
            .replace(/^\[CUE\]\s*/i, '')
            .trim() || 'General',
        tintColor: String(cueMeta.tintColor ?? '#b96c26').trim() || '#b96c26',
        track,
        volume: Number.isFinite(Number(cueMeta.volume)) ? Number(cueMeta.volume) : Number(sound.volume ?? 1),
        cooldown: Number.isFinite(Number(cueMeta.cooldown)) ? Number(cueMeta.cooldown) : 0,
        duckOthers: !!cueMeta.duckOthers,
        stopOnSceneChange: !!cueMeta.stopOnSceneChange,
        favorite: !!cueMeta.favorite,
        enabled: cueMeta.enabled !== false
    };
}

async function ensureCueBoardPlaylist(boardName) {
    const normalized = String(boardName ?? 'General').trim() || 'General';
    const existing = getCueBoardPlaylists().find((playlist) => {
        const metaName = String(getCueBoardMeta(playlist).boardName ?? '').trim();
        const playlistName = String(playlist.name ?? '').replace(/^\[CUE\]\s*/i, '').trim();
        return metaName.toLowerCase() === normalized.toLowerCase() || playlistName.toLowerCase() === normalized.toLowerCase();
    });
    const cueBoardsFolder = await StorageManager.ensureMinstrelPlaylistFolder('Cue Boards');
    if (existing) {
        const currentFolderId = String(existing.folder?.id ?? existing.folder ?? '');
        const updates = {};
        if (currentFolderId !== String(cueBoardsFolder?.id ?? '')) updates.folder = cueBoardsFolder?.id ?? null;
        const expectedName = formatCueBoardPlaylistName(normalized);
        if (String(existing.name ?? '') !== expectedName) updates.name = expectedName;
        if (Object.keys(updates).length) {
            await existing.update(updates);
        }
        return existing;
    }

    return Playlist.create({
        name: formatCueBoardPlaylistName(normalized),
        mode: CONST.PLAYLIST_MODES?.DISABLED ?? 0,
        folder: cueBoardsFolder?.id ?? null,
        sorting: 'm',
        flags: {
            [MODULE.ID]: {
                type: PLAYLIST_TYPE_CUE_BOARD,
                cueBoardMeta: {
                    boardName: normalized
                }
            }
        }
    });
}

function buildCueSoundData(cue) {
    if (!cue?.track?.playlistId || !cue?.track?.soundId) return null;
    const sourceSound = game.playlists?.get(cue?.track?.playlistId)?.sounds?.get(cue?.track?.soundId) ?? null;
    const baseData = sourceSound?.toObject?.() ?? {
        name: cue?.name ?? 'New Cue',
        path: cue?.track?.path ?? '',
        volume: Number(cue?.volume ?? 1),
        channel: 'interface',
        repeat: false
    };

    delete baseData._id;
    delete baseData.id;
    delete baseData.playing;
    delete baseData.pausedTime;
    delete baseData.sort;

    return {
        ...baseData,
        name: String(cue?.name ?? baseData.name ?? 'New Cue').trim() || 'New Cue',
        path: String(baseData.path ?? cue?.track?.path ?? ''),
        volume: Number.isFinite(Number(cue?.volume)) ? Number(cue.volume) : Number(baseData.volume ?? 1),
        channel: 'interface',
        repeat: false,
        flags: foundry.utils.mergeObject(baseData.flags ?? {}, {
            [MODULE.ID]: {
                cueMeta: {
                    sourceTrack: {
                        playlistId: String(cue.track.playlistId),
                        soundId: String(cue.track.soundId),
                        label: String(cue.track.label ?? ''),
                        playlistName: String(cue.track.playlistName ?? ''),
                        soundName: String(cue.track.soundName ?? ''),
                        path: String(cue.track.path ?? ''),
                        channel: String(cue.track.channel ?? '')
                    },
                    icon: normalizeCueIcon(cue?.icon ?? 'fa-solid fa-bell'),
                    tintColor: String(cue?.tintColor ?? '#b96c26').trim() || '#b96c26',
                    volume: Number.isFinite(Number(cue?.volume)) ? Number(cue.volume) : Number(baseData.volume ?? 1),
                    cooldown: Number.isFinite(Number(cue?.cooldown)) ? Number(cue.cooldown) : 0,
                    duckOthers: !!cue?.duckOthers,
                    stopOnSceneChange: !!cue?.stopOnSceneChange,
                    favorite: !!cue?.favorite,
                    enabled: cue?.enabled !== false
                }
            }
        }, { inplace: false })
    };
}

async function duckTracks(trackStates, multiplier) {
    for (const trackState of trackStates) {
        await PlaylistManager.setTrackVolume(
            trackState.trackRef,
            Math.max(0, Math.min(1, Number(trackState.volume ?? 0.5) * multiplier))
        );
    }
}

export const CueManager = {
    invalidateCache() {
        cueCache.cues = null;
    },

    getCues() {
        if (!cueCache.cues) {
            cueCache.cues = getCueBoardPlaylists()
                .flatMap((playlist) => playlist.sounds.contents.map((sound) => buildCueFromSound(playlist, sound)))
                .filter(Boolean)
                .sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? ''), undefined, { sensitivity: 'base' }));
        }
        return cueCache.cues;
    },

    getCue(cueId) {
        const { playlistId, soundId } = parseCueId(cueId);
        if (!playlistId || !soundId) return null;
        const playlist = game.playlists?.get(playlistId) ?? null;
        const sound = playlist?.sounds?.get(soundId) ?? null;
        if (!playlist || !sound || playlist.getFlag?.(MODULE.ID, 'type') !== PLAYLIST_TYPE_CUE_BOARD) return null;
        return buildCueFromSound(playlist, sound);
    },

    async saveCue(cue) {
        if (!cue?.track?.playlistId || !cue?.track?.soundId) return null;
        const boardName = String(cue?.category ?? '').trim();
        if (!boardName) return null;
        const targetPlaylist = await ensureCueBoardPlaylist(boardName);
        const soundData = buildCueSoundData(cue);
        if (!soundData) return null;
        const { playlistId: existingPlaylistId, soundId: existingSoundId } = parseCueId(cue?.id ?? '');

        let savedSound = null;
        if (existingPlaylistId && existingSoundId && existingPlaylistId === targetPlaylist.id) {
            const existingSound = targetPlaylist.sounds.get(existingSoundId) ?? null;
            if (existingSound) {
                await existingSound.update(soundData);
                savedSound = targetPlaylist.sounds.get(existingSoundId) ?? existingSound;
            }
        }

        if (!savedSound) {
            const [createdSound] = await targetPlaylist.createEmbeddedDocuments('PlaylistSound', [soundData]);
            savedSound = createdSound ?? targetPlaylist.sounds.contents.at(-1) ?? null;
            if (existingPlaylistId && existingSoundId && existingPlaylistId !== targetPlaylist.id) {
                const oldPlaylist = game.playlists?.get(existingPlaylistId) ?? null;
                const oldSound = oldPlaylist?.sounds?.get(existingSoundId) ?? null;
                if (oldSound) await oldPlaylist.deleteEmbeddedDocuments('PlaylistSound', [existingSoundId]);
            }
        }

        this.invalidateCache();
        return savedSound ? buildCueFromSound(targetPlaylist, savedSound) : null;
    },

    async toggleFavorite(cueId) {
        const cue = this.getCue(cueId);
        if (!cue) return null;
        return this.saveCue({
            ...cue,
            favorite: !cue.favorite
        });
    },

    async deleteCue(cueId) {
        const { playlistId, soundId } = parseCueId(cueId);
        const playlist = game.playlists?.get(playlistId) ?? null;
        const sound = playlist?.sounds?.get(soundId) ?? null;
        if (!playlist || !sound || playlist.getFlag?.(MODULE.ID, 'type') !== PLAYLIST_TYPE_CUE_BOARD) return;
        await playlist.deleteEmbeddedDocuments('PlaylistSound', [soundId]);
        this.invalidateCache();
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
        const durationSeconds = await PlaylistManager.getTrackDurationSeconds(cue.track);
        if (durationSeconds > 0) {
            window.setTimeout(() => {
                RuntimeManager.removeActiveCueRef(cue.track);
                PlaylistManager.syncRuntimeLayers();
                const windowRef = RuntimeManager.getState().windowRef;
                if (windowRef?.refreshPreservingUi) {
                    void windowRef.refreshPreservingUi();
                } else if (windowRef?.render) {
                    windowRef.render(true);
                }
                game.modules.get('coffee-pub-blacksmith')?.api?.renderMenubar?.(true);
            }, Math.max(250, Math.ceil(durationSeconds * 1000) + 150));
        }
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
