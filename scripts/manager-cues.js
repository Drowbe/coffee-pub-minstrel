// ==================================================================
// ===== MINSTREL CUE MANAGER =======================================
// ==================================================================

import { MODULE } from './const.js';
import { PlaylistManager } from './manager-playlists.js';
import { RuntimeManager } from './manager-runtime.js';

const PLAYLIST_TYPE_CUE_BOARD = 'cue-board';

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

function buildCueFromSound(playlist, sound) {
    const track = PlaylistManager.createTrackRef(sound);
    if (!track) return null;
    const cueMeta = getCueMeta(sound);
    return {
        id: `${playlist.id}::${sound.id}`,
        name: String(sound.name ?? 'New Cue').trim() || 'New Cue',
        icon: String(cueMeta.icon ?? 'fa-solid fa-bell'),
        category: String(getCueBoardMeta(playlist).boardName ?? playlist.name ?? 'general').trim() || 'general',
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
    const existing = getCueBoardPlaylists().find((playlist) => String(playlist.name ?? '').trim().toLowerCase() === normalized.toLowerCase());
    if (existing) return existing;

    return Playlist.create({
        name: normalized,
        mode: CONST.PLAYLIST_MODES?.DISABLED ?? 0,
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
                    icon: String(cue?.icon ?? 'fa-solid fa-bell'),
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
    getCues() {
        return getCueBoardPlaylists()
            .flatMap((playlist) => playlist.sounds.contents.map((sound) => buildCueFromSound(playlist, sound)))
            .filter(Boolean)
            .sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? ''), undefined, { sensitivity: 'base' }));
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
        const boardName = String(cue?.category ?? 'General').trim() || 'General';
        const targetPlaylist = await ensureCueBoardPlaylist(boardName);
        const soundData = buildCueSoundData(cue);
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

        return savedSound ? buildCueFromSound(targetPlaylist, savedSound) : null;
    },

    async deleteCue(cueId) {
        const { playlistId, soundId } = parseCueId(cueId);
        const playlist = game.playlists?.get(playlistId) ?? null;
        const sound = playlist?.sounds?.get(soundId) ?? null;
        if (!playlist || !sound || playlist.getFlag?.(MODULE.ID, 'type') !== PLAYLIST_TYPE_CUE_BOARD) return;
        await playlist.deleteEmbeddedDocuments('PlaylistSound', [soundId]);
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
