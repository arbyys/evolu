import type { SyncProgress } from "@evolu/common/local-first";
import { onScopeDispose, ref, type Ref } from "vue";
import { useEvolu } from "./useEvolu.js";

/** Subscribe to {@link SyncProgress} changes. */
export const useSyncProgress = (): Ref<SyncProgress> => {
  const evolu = useEvolu();

  const syncProgress = ref(evolu.getSyncProgress()) as Ref<SyncProgress>;
  const unsubscribe = evolu.subscribeSyncProgress(() => {
    syncProgress.value = evolu.getSyncProgress();
  });
  onScopeDispose(unsubscribe);

  return syncProgress;
};
