// ==================================================================
// ===== MINSTREL RUNTIME STATE =====================================
// ==================================================================

const runtimeState = {
    activeSoundSceneId: null,
    lastActivatedSoundSceneId: null,
    previousSnapshot: null,
    musicTrack: null,
    ambientTracks: [],
    previewTrack: null,
    previewSound: null,
    previewTimeoutId: null,
    scheduledLayerHandles: [],
    musicSequenceHandle: null,
    sceneClock: null,
    activeSceneLayerCounts: new Map(),
    recentCueIds: [],
    activeCueRefs: [],
    combatState: false,
    cooldowns: new Map(),
    windowRef: null
};

const moduleDeferredTimeoutIds = new Set();
const scheduledLayerFollowupTimeoutIds = new Set();
const oneShotOnceFiredLayerIds = new Set();

let menubarRenderDebounceId = null;

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

    setPreviewSound(sound) {
        runtimeState.previewSound = sound ?? null;
    },

    getPreviewSound() {
        return runtimeState.previewSound ?? null;
    },

    stopPreviewSound() {
        const previewSound = runtimeState.previewSound;
        if (previewSound && typeof previewSound.stop === 'function') {
            previewSound.stop();
        }
        runtimeState.previewSound = null;
    },

    setPreviewTimeout(timeoutId) {
        runtimeState.previewTimeoutId = timeoutId ?? null;
    },

    clearPreviewTimeout() {
        if (runtimeState.previewTimeoutId) {
            window.clearTimeout(runtimeState.previewTimeoutId);
        }
        runtimeState.previewTimeoutId = null;
    },

    clearPreviewState() {
        this.clearPreviewTimeout();
        this.stopPreviewSound();
        this.clearPreviewTrack();
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

    setMusicSequenceHandle(handle = null) {
        runtimeState.musicSequenceHandle = handle ? { ...handle } : null;
    },

    getMusicSequenceHandle() {
        return runtimeState.musicSequenceHandle ? { ...runtimeState.musicSequenceHandle } : null;
    },

    clearMusicSequenceHandle() {
        const handle = runtimeState.musicSequenceHandle;
        if (handle?.timeoutId) {
            window.clearTimeout(handle.timeoutId);
        }
        runtimeState.musicSequenceHandle = null;
    },

    setSceneClock(clock = null) {
        runtimeState.sceneClock = clock ? { ...clock } : null;
    },

    getSceneClock() {
        return runtimeState.sceneClock ? { ...runtimeState.sceneClock } : null;
    },

    clearSceneClock() {
        runtimeState.sceneClock = null;
    },

    markSceneLayerActive(layerId) {
        const key = String(layerId ?? '').trim();
        if (!key) return;
        const count = Number(runtimeState.activeSceneLayerCounts.get(key) ?? 0);
        runtimeState.activeSceneLayerCounts.set(key, count + 1);
    },

    markSceneLayerInactive(layerId) {
        const key = String(layerId ?? '').trim();
        if (!key) return;
        const count = Number(runtimeState.activeSceneLayerCounts.get(key) ?? 0);
        if (count <= 1) {
            runtimeState.activeSceneLayerCounts.delete(key);
            return;
        }
        runtimeState.activeSceneLayerCounts.set(key, count - 1);
    },

    isSceneLayerActive(layerId) {
        const key = String(layerId ?? '').trim();
        if (!key) return false;
        return Number(runtimeState.activeSceneLayerCounts.get(key) ?? 0) > 0;
    },

    clearSceneLayerActivity() {
        runtimeState.activeSceneLayerCounts.clear();
    },

    clearOneShotOnceFiredLayers() {
        oneShotOnceFiredLayerIds.clear();
    },

    hasOneShotOnceFiredLayer(layerId) {
        const key = String(layerId ?? '').trim();
        return key ? oneShotOnceFiredLayerIds.has(key) : false;
    },

    markOneShotOnceFiredLayer(layerId) {
        const key = String(layerId ?? '').trim();
        if (key) oneShotOnceFiredLayerIds.add(key);
    },

    setActiveSoundSceneId(soundSceneId) {
        runtimeState.activeSoundSceneId = soundSceneId ?? null;
    },

    /** Most recent sound scene Minstrel activated (persists after Stop so “Restart Last Scene” can re-run it). */
    setLastActivatedSoundSceneId(soundSceneId) {
        const id = String(soundSceneId ?? '').trim();
        runtimeState.lastActivatedSoundSceneId = id || null;
    },

    getLastActivatedSoundSceneId() {
        const id = String(runtimeState.lastActivatedSoundSceneId ?? '').trim();
        return id || null;
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

    removeActiveCueRef(trackRef) {
        runtimeState.activeCueRefs = runtimeState.activeCueRefs.filter((entry) => !isSameRef(entry, trackRef));
    },

    getActiveCueRefs() {
        return runtimeState.activeCueRefs.map((ref) => ({ ...ref }));
    },

    clearActiveCueRefs() {
        runtimeState.activeCueRefs = [];
    },

    registerModuleDeferredTimeout(timeoutId) {
        if (timeoutId != null) moduleDeferredTimeoutIds.add(timeoutId);
    },

    unregisterModuleDeferredTimeout(timeoutId) {
        if (timeoutId != null) moduleDeferredTimeoutIds.delete(timeoutId);
    },

    clearModuleDeferredTimeouts() {
        for (const id of moduleDeferredTimeoutIds) {
            window.clearTimeout(id);
        }
        moduleDeferredTimeoutIds.clear();
    },

    /** Coalesce bursty Blacksmith menubar redraws (playback hooks, scene UI, etc.). */
    queueMenubarRender() {
        if (menubarRenderDebounceId) window.clearTimeout(menubarRenderDebounceId);
        menubarRenderDebounceId = window.setTimeout(() => {
            menubarRenderDebounceId = null;
            game.modules.get('coffee-pub-blacksmith')?.api?.renderMenubar?.(true);
        }, 350);
    },

    clearMenubarRenderDebounce() {
        if (menubarRenderDebounceId) {
            window.clearTimeout(menubarRenderDebounceId);
            menubarRenderDebounceId = null;
        }
    },

    registerScheduledLayerFollowupTimeout(timeoutId) {
        if (timeoutId != null) scheduledLayerFollowupTimeoutIds.add(timeoutId);
    },

    unregisterScheduledLayerFollowupTimeout(timeoutId) {
        if (timeoutId != null) scheduledLayerFollowupTimeoutIds.delete(timeoutId);
    },

    clearScheduledLayerFollowupTimeouts() {
        for (const id of scheduledLayerFollowupTimeoutIds) {
            window.clearTimeout(id);
        }
        scheduledLayerFollowupTimeoutIds.clear();
    }
};
