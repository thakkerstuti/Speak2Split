import { create } from "zustand";
import * as SecureStore from "expo-secure-store";
import { User } from "../lib/api";

const TOKEN_KEY = "speak2split_token";
const USER_KEY = "speak2split_user";

interface AuthState {
  token: string | null;
  user: User | null;
  isHydrated: boolean;
  hydrate: () => Promise<void>;
  setSession: (token: string, user: User) => Promise<void>;
  refreshProfile: () => Promise<void>;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  user: null,
  isHydrated: false,

  hydrate: async () => {
    const [token, userJson] = await Promise.all([
      SecureStore.getItemAsync(TOKEN_KEY),
      SecureStore.getItemAsync(USER_KEY),
    ]);
    set({
      token,
      user: userJson ? JSON.parse(userJson) : null,
      isHydrated: true,
    });
  },

  setSession: async (token: string, user: User) => {
    await Promise.all([
      SecureStore.setItemAsync(TOKEN_KEY, token),
      SecureStore.setItemAsync(USER_KEY, JSON.stringify(user)),
    ]);
    set({ token, user });
  },

  logout: () => {
    SecureStore.deleteItemAsync(TOKEN_KEY);
    SecureStore.deleteItemAsync(USER_KEY);
    set({ token: null, user: null });
  },

  refreshProfile: async () => {
    // Lazy require avoids a circular import at module-eval time — api.ts
    // itself imports this store for its request interceptor.
    const { authApi } = require("../lib/api");
    try {
      const fullProfile = await authApi.me();
      await SecureStore.setItemAsync(USER_KEY, JSON.stringify(fullProfile));
      set({ user: fullProfile });
    } catch {
      // Non-fatal — the app keeps working with whatever profile info it
      // already has from login/register.
    }
  },
}));
