import { create } from "zustand";
import * as SecureStore from "expo-secure-store";
import { User } from "../lib/api";

const TOKEN_KEY = "speak2split_token";
const USER_KEY = "speak2split_user";
const ONBOARDING_KEY = "speak2split_has_onboarded";

interface AuthState {
  token: string | null;
  user: User | null;
  hasOnboarded: boolean;
  isHydrated: boolean;
  hydrate: () => Promise<void>;
  setOnboarded: (onboarded: boolean) => Promise<void>;
  setSession: (token: string, user: User) => Promise<void>;
  refreshProfile: () => Promise<void>;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  user: null,
  hasOnboarded: false,
  isHydrated: false,

  hydrate: async () => {
    try {
      const [token, userJson, onboardedVal] = await Promise.all([
        SecureStore.getItemAsync(TOKEN_KEY),
        SecureStore.getItemAsync(USER_KEY),
        SecureStore.getItemAsync(ONBOARDING_KEY),
      ]);
      set({
        token,
        user: userJson ? JSON.parse(userJson) : null,
        hasOnboarded: onboardedVal === "true",
        isHydrated: true,
      });
    } catch {
      set({ token: null, user: null, hasOnboarded: false, isHydrated: true });
    }
  },

  setOnboarded: async (onboarded: boolean) => {
    await SecureStore.setItemAsync(ONBOARDING_KEY, onboarded ? "true" : "false");
    set({ hasOnboarded: onboarded });
  },

  setSession: async (token: string, user: User) => {
    await Promise.all([
      SecureStore.setItemAsync(TOKEN_KEY, token),
      SecureStore.setItemAsync(USER_KEY, JSON.stringify(user)),
      SecureStore.setItemAsync(ONBOARDING_KEY, "true"),
    ]);
    set({ token, user, hasOnboarded: true });
  },

  logout: () => {
    SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => {});
    SecureStore.deleteItemAsync(USER_KEY).catch(() => {});
    set({ token: null, user: null });
  },

  refreshProfile: async () => {
    const { authApi } = require("../lib/api");
    try {
      const fullProfile = await authApi.me();
      await SecureStore.setItemAsync(USER_KEY, JSON.stringify(fullProfile));
      set({ user: fullProfile });
    } catch {
      // Non-fatal profile refresh error
    }
  },
}));
