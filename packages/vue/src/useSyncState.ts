import type { SyncState } from "@evolu/common/local-first";
import { onScopeDispose, ref, type Ref } from "vue";
import { useEvolu } from "./useEvolu.js";

/** Subscribe to {@link SyncState} changes. */
export const useSyncState = (): Ref<SyncState> => {
  const evolu = useEvolu();

  const syncState = ref(evolu.getSyncState()) as Ref<SyncState>;
  const unsubscribe = evolu.subscribeSyncState(() => {
    syncState.value = evolu.getSyncState();
  });
  onScopeDispose(unsubscribe);

  return syncState;
};
