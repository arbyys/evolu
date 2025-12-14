<script setup lang="ts">
import { useSyncState } from "@evolu/vue";
import { computed, ref, watch, onUnmounted } from "vue";
import type { SyncState } from "@evolu/common";

const MIN_DISPLAY_TIME_MS = 650;
const SPEED_GAIN = 4;

const realSyncState = useSyncState();
const displaySyncState = ref<SyncState>(realSyncState.value);
const visualProgress = ref(0);
const targetProgress = ref(0);
let timeoutId: ReturnType<typeof setTimeout> | null = null;
let animationFrameId: number;

const updateAnimation = () => {
  if (visualProgress.value < targetProgress.value) {
    visualProgress.value = Math.min(targetProgress.value, visualProgress.value + SPEED_GAIN);
  } else if (visualProgress.value > targetProgress.value) {
    visualProgress.value = targetProgress.value;
  }
  animationFrameId = requestAnimationFrame(updateAnimation);
};

updateAnimation();

onUnmounted(() => {
  if (animationFrameId) cancelAnimationFrame(animationFrameId);
});

watch(realSyncState, (newState, oldState) => {
  if (newState.type === "SyncStateIsSyncing" && newState.stats) {
     const { uploadedBytes, estimatedUploadBytes } = newState.stats;
     if (estimatedUploadBytes > 0) {
        targetProgress.value = Math.min(100, (uploadedBytes / estimatedUploadBytes) * 100);
     } else {
        targetProgress.value = 0;
     }
  } else if (newState.type === "SyncStateIsSynced") {
     targetProgress.value = 100;
  } else {
     targetProgress.value = 0;
  }

  if (newState.type === "SyncStateIsSyncing") {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    displaySyncState.value = newState;
    return;
  }

  if (oldState?.type === "SyncStateIsSyncing") {
     timeoutId = setTimeout(() => {
        displaySyncState.value = realSyncState.value;
        timeoutId = null;
     }, MIN_DISPLAY_TIME_MS);
     return;
  }

  if (!timeoutId) {
      displaySyncState.value = newState;
  }
}, { deep: true });

watch(realSyncState, (newState) => {
    if (displaySyncState.value.type === "SyncStateIsSyncing" && newState.type === "SyncStateIsSyncing") {
        displaySyncState.value = newState;
    }
}, { deep: true });

const statusColor = computed(() => {
  switch (displaySyncState.value.type) {
    case "SyncStateInitial": return "#9e9e9e";
    case "SyncStateIsSyncing": return "#2196f3";
    case "SyncStateIsSynced": return "#4caf50";
    case "SyncStateIsNotSynced": return "#f44336";
  }
});

const statusText = computed(() => {
  switch (displaySyncState.value.type) {
    case "SyncStateInitial": return "Connecting...";
    case "SyncStateIsSyncing": return "Syncing...";
    case "SyncStateIsSynced": return "Synced";
    case "SyncStateIsNotSynced": return "Offline";
  }
});

const downloadSize = computed(() => {
    if (displaySyncState.value.type === "SyncStateIsSyncing" && displaySyncState.value.stats) {
        return formatBytes(displaySyncState.value.stats.downloadedBytes);
    }
    return null;
});

function formatBytes(bytes: number, decimals = 0) {
    if (!+bytes) return '0 B';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}
</script>

<template>
  <div class="sync-widget" :style="{ borderColor: statusColor }">
    <div class="header">
        <div class="status-indicator" :style="{ backgroundColor: statusColor }"></div>
        <span class="status-text" :style="{ color: statusColor }">{{ statusText }}</span>
        <span class="details" v-if="downloadSize">Downloaded: {{ downloadSize }}</span>
    </div>
    
    <div v-if="displaySyncState.type === 'SyncStateIsSyncing'" class="progress-container">
      <div class="progress-bar" :style="{ width: visualProgress + '%', backgroundColor: statusColor }">
        <span class="progress-text">{{ Math.round(visualProgress) }}%</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sync-widget {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  font-size: 12px;
  border: 1px solid;
  border-radius: 8px;
  padding: 8px 12px;
  background: #fff;
  width: 240px;
  box-shadow: 0 4px 6px rgba(0,0,0,0.05);
  transition: border-color 0.3s ease;
  margin-bottom: 10px;
}

.header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 0;
    height: 20px;
}

.status-indicator {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex-shrink: 0;
    transition: background-color 0.3s ease;
}

.status-text {
    font-weight: 600;
    transition: color 0.3s ease;
}

.details {
    color: #666;
    margin-left: auto;
    font-size: 11px;
}

.progress-container {
  height: 14px;
  background-color: #f0f0f0;
  border-radius: 7px;
  overflow: hidden;
  margin-top: 8px;
  position: relative;
}

.progress-bar {
  height: 100%;
  background-color: #2196f3;
  transition: width 0.5s cubic-bezier(0.3, 0.2, 0.1, 1);
  display: flex;
  align-items: center;
  justify-content: center;
  background-image: linear-gradient(
    45deg,
    rgba(255, 255, 255, 0.15) 25%,
    transparent 25%,
    transparent 50%,
    rgba(255, 255, 255, 0.15) 50%,
    rgba(255, 255, 255, 0.15) 75%,
    transparent 75%,
    transparent
  );
  background-size: 1rem 1rem;
  animation: progress-stripes 1s linear infinite;
}

.progress-text {
    color: white;
    font-size: 9px;
    font-weight: bold;
    text-shadow: 0 1px 1px rgba(0,0,0,0.2);
    white-space: nowrap;
    padding: 0 4px;
}

@keyframes progress-stripes {
  0% {
    background-position: 1rem 0;
  }
  100% {
    background-position: 0 0;
  }
}
</style>
