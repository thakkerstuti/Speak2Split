import { create } from "zustand";
import * as SecureStore from "expo-secure-store";

const LAST_GROUP_KEY = "speak2split_last_group_id";

interface PrefsState {
  lastGroupId: string | null;
  loaded: boolean;
  load: () => Promise<void>;
  setLastGroupId: (id: string) => void;
}

/** Small per-device preferences (e.g. the last group an expense was added to). */
export const usePrefsStore = create<PrefsState>((set, get) => ({
  lastGroupId: null,
  loaded: false,
  load: async () => {
    if (get().loaded) return;
    try {
      const id = await SecureStore.getItemAsync(LAST_GROUP_KEY);
      set({ lastGroupId: id, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },
  setLastGroupId: (id) => {
    set({ lastGroupId: id });
    SecureStore.setItemAsync(LAST_GROUP_KEY, id).catch(() => {});
  },
}));
