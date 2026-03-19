// ==================================================================
// ===== MINSTREL RUNTIME STATE =====================================
// ==================================================================

const runtimeState = {
    activeSoundSceneId: null,
    previousSnapshot: null,
    musicTrack: null,
    ambientTracks: [],
    previewTrack: null,
    scheduledLayerHandles: [],
    recentCueIds: [],
    activeCueRefs: [],
    combatState: false,
    cooldowns: new Map(),
    windowRef: null
};

function isSameRef(a, b) {
    return !!a && !!b && a.playlistId === b.playlistId && a.soundId === b.soundId;
}

export const RuntimeManager = {
    getState() {
        return runtimeState;
    },

    setWindowRef(windowRef) {
        runtimeState.windowRef = windowRef;
    },

    clearWindowRef(windowRef) {
        if (runtimeState.windowRef === windowRef) runtimeState.windowRef = null;
    },

    setMusicTrack(trackRef) {
        runtimeState.musicTrack = trackRef ? { ...trackRef } : null;
    },

    setAmbientTracks(trackRefs = []) {
        runtimeState.ambientTracks = trackRefs.map((ref) => ({ ...ref }));
    },

    setPreviewTrack(trackRef) {
        runtimeState.previewTrack = trackRef ? { ...trackRef } : null;
    },

    getPreviewTrack() {
        return runtimeState.previewTrack ? { ...runtimeState.previewTrack } : null;
    },

    clearPreviewTrack() {
        runtimeState.previewTrack = null;
    },

    addAmbientTrack(trackRef) {
        if (!trackRef) return;
        if (runtimeState.ambientTracks.some((entry) => isSameRef(entry, trackRef))) return;
        runtimeState.ambientTracks.push({ ...trackRef });
    },

    removeAmbientTrack(trackRef) {
        runtimeState.ambientTracks = runtimeState.ambientTracks.filter((entry) => !isSameRef(entry, trackRef));
    },

    setScheduledLayerHandles(handles = []) {
        runtimeState.scheduledLayerHandles = Array.isArray(handles) ? [...handles] : [];
    },

    getScheduledLayerHandles() {
        return [...runtimeState.scheduledLayerHandles];
    },

    clearScheduledLayerHandles() {
        runtimeState.scheduledLayerHandles = [];
    },

    setActiveSoundSceneId(soundSceneId) {
        runtimeState.activeSoundSceneId = soundSceneId ?? null;
    },

    setPreviousSnapshot(snapshot) {
        runtimeState.previousSnapshot = snapshot ? foundry.utils.deepClone(snapshot) : null;
    },

    getPreviousSnapshot() {
        return runtimeState.previousSnapshot ? foundry.utils.deepClone(runtimeState.previousSnapshot) : null;
    },

    setCombatState(active) {
        runtimeState.combatState = !!active;
    },

    addRecentCue(cueId) {
        if (!cueId) return;
        runtimeState.recentCueIds = [cueId, ...runtimeState.recentCueIds.filter((id) => id !== cueId)].slice(0, 8);
    },

    getRecentCueIds() {
        return [...runtimeState.recentCueIds];
    },

    setCueCooldown(cueId, cooldownMs) {
        if (!cueId || !cooldownMs || cooldownMs <= 0) return;
        runtimeState.cooldowns.set(cueId, Date.now() + cooldownMs);
    },

    isCueOnCooldown(cueId) {
        if (!cueId) return false;
        const expiresAt = runtimeState.cooldowns.get(cueId);
        if (!expiresAt) return false;
        if (Date.now() >= expiresAt) {
            runtimeState.cooldowns.delete(cueId);
            return false;
        }
        return true;
    },

    getCueCooldownRemaining(cueId) {
        if (!this.isCueOnCooldown(cueId)) return 0;
        return Math.max(0, (runtimeState.cooldowns.get(cueId) ?? 0) - Date.now());
    },

    setActiveCueRefs(trackRefs) {
        runtimeState.activeCueRefs = Array.isArray(trackRefs) ? trackRefs.map((ref) => ({ ...ref })) : [];
    },

    addActiveCueRef(trackRef) {
        if (!trackRef) return;
        runtimeState.activeCueRefs.push({ ...trackRef });
    },

    getActiveCueRefs() {
        return runtimeState.activeCueRefs.map((ref) => ({ ...ref }));
    },

    clearActiveCueRefs() {
        runtimeState.activeCueRefs = [];
    }
};
