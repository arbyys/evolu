<script setup lang="ts">
import { useSyncState, useSyncProgress } from "@evolu/vue";
import { computed } from "vue";

const syncState = useSyncState();
const syncProgress = useSyncProgress();

const isSyncing = computed(() => syncState.value.type === "SyncStateIsSyncing");

const statusLabel = computed(() => {
  switch (syncState.value.type) {
    case "SyncStateInitial":
      return "Connecting...";
    case "SyncStateIsSyncing":
      return "Syncing...";
    case "SyncStateIsSynced":
      return "Synced";
    case "SyncStateIsNotSynced":
      return "Offline";
  }
});

const statusColor = computed(() => {
  switch (syncState.value.type) {
    case "SyncStateInitial":
      return "#9e9e9e";
    case "SyncStateIsSyncing":
      return "#2196f3";
    case "SyncStateIsSynced":
      return "#4caf50";
    case "SyncStateIsNotSynced":
      return "#f44336";
  }
});

const progressPercent = computed(() => {
  const { receivedBytes, totalBytes } = syncProgress.value;
  if (totalBytes == null || totalBytes === 0) return null;
  return Math.min(100, Math.round((receivedBytes / totalBytes) * 100));
});

const formatBytes = (bytes: number): string => {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${Math.round(bytes / Math.pow(1024, i))} ${units[i]}`;
};
</script>

<template>
  <div class="sync-widget" :style="{ borderColor: statusColor }">
    <div class="sync-header">
      <span class="sync-dot" :style="{ backgroundColor: statusColor }" />
      <span class="sync-label" :style="{ color: statusColor }">
        {{ statusLabel }}
      </span>
      <span v-if="isSyncing" class="sync-bytes">
        {{ formatBytes(syncProgress.receivedBytes) }}
      </span>
    </div>

    <div v-if="isSyncing" class="sync-bar-track">
      <div
        v-if="progressPercent != null"
        class="sync-bar-fill"
        :style="{
          width: progressPercent + '%',
          backgroundColor: statusColor,
        }"
      />
      <div v-else class="sync-bar-indeterminate" />
    </div>
  </div>
</template>

<style scoped>
.sync-widget {
  font-family: system-ui, sans-serif;
  font-size: 12px;
  border: 1px solid;
  border-radius: 8px;
  padding: 8px 12px;
  width: 220px;
  margin-bottom: 12px;
}

.sync-header {
  display: flex;
  align-items: center;
  gap: 6px;
}

.sync-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.sync-label {
  font-weight: 600;
}

.sync-bytes {
  margin-left: auto;
  color: #666;
  font-size: 11px;
}

.sync-bar-track {
  height: 4px;
  background: #eee;
  border-radius: 2px;
  margin-top: 6px;
  overflow: hidden;
}

.sync-bar-fill {
  height: 100%;
  border-radius: 2px;
  transition: width 0.3s ease;
}

.sync-bar-indeterminate {
  height: 100%;
  width: 40%;
  background: #2196f3;
  border-radius: 2px;
  animation: slide 1.2s ease-in-out infinite;
}

@keyframes slide {
  0% {
    transform: translateX(-100%);
  }
  100% {
    transform: translateX(350%);
  }
}
</style>
