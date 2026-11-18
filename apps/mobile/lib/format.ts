import {
  Utensils,
  ShoppingCart,
  Home,
  Zap,
  Car,
  Plane,
  ShoppingBag,
  Film,
  HeartPulse,
  Wifi,
  Receipt,
  Hotel,
  Coffee,
} from "lucide-react-native";
import { colors } from "./theme";

/** ₹1,234 / ₹1,234.50 — Indian digit grouping, decimals only when needed. */
export function formatINR(value: number | string | null | undefined, opts: { sign?: boolean } = {}): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "₹0";
  const abs = Math.abs(n);
  const hasFraction = Math.round(abs * 100) % 100 !== 0;
  const body = abs.toLocaleString("en-IN", {
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: 2,
  });
  const sign = n < 0 ? "-" : opts.sign && n > 0 ? "+" : "";
  return `${sign}₹${body}`;
}

export function formatShortDate(value: string | Date | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export interface CategoryMeta {
  id: string;
  label: string;
  icon: any;
  color: string;
  bg: string;
}

export const CATEGORIES: CategoryMeta[] = [
  { id: "food", label: "Food", icon: Utensils, color: "#EA580C", bg: "#FFEDD5" },
  { id: "groceries", label: "Groceries", icon: ShoppingCart, color: "#16A34A", bg: "#DCFCE7" },
  { id: "rent", label: "Rent", icon: Home, color: "#7C3AED", bg: "#EDE9FE" },
  { id: "electricity", label: "Bills", icon: Zap, color: "#CA8A04", bg: "#FEF9C3" },
  { id: "taxi", label: "Travel", icon: Car, color: "#0284C7", bg: "#E0F2FE" },
  { id: "shopping", label: "Shopping", icon: ShoppingBag, color: "#DB2777", bg: "#FCE7F3" },
  { id: "entertainment", label: "Fun", icon: Film, color: "#9333EA", bg: "#F3E8FF" },
  { id: "general", label: "Other", icon: Receipt, color: colors.primary, bg: colors.primaryLight },
];

const CATEGORY_ALIASES: Record<string, string> = {
  dinner: "food", lunch: "food", breakfast: "food", restaurant: "food", snacks: "food", drinks: "food", cafe: "food",
  coffee: "food", pizza: "food", swiggy: "food", zomato: "food",
  grocery: "groceries", supermarket: "groceries", vegetables: "groceries",
  flat: "rent", house: "rent", maintenance: "rent",
  bill: "electricity", bills: "electricity", utilities: "electricity", utility: "electricity", power: "electricity",
  water: "electricity", gas: "electricity", internet: "electricity", wifi: "electricity", phone: "electricity",
  cab: "taxi", uber: "taxi", ola: "taxi", auto: "taxi", travel: "taxi", transport: "taxi", fuel: "taxi", petrol: "taxi",
  flight: "taxi", train: "taxi", bus: "taxi", hotel: "taxi", stay: "taxi",
  movie: "entertainment", movies: "entertainment", party: "entertainment", games: "entertainment",
  clothes: "shopping", amazon: "shopping", gifts: "shopping", gift: "shopping",
  medical: "general", medicine: "general",
};

/** Icons for specific raw categories that collapse into a broader chip. */
const SPECIFIC_ICON: Record<string, any> = {
  internet: Wifi, wifi: Wifi, flight: Plane, hotel: Hotel, stay: Hotel, coffee: Coffee, cafe: Coffee,
  medical: HeartPulse, medicine: HeartPulse,
};

export function normalizeCategory(raw?: string | null): string {
  const key = (raw ?? "").trim().toLowerCase();
  if (!key) return "general";
  if (CATEGORIES.some((c) => c.id === key)) return key;
  return CATEGORY_ALIASES[key] ?? "general";
}

export function categoryMeta(raw?: string | null): CategoryMeta {
  const id = normalizeCategory(raw);
  const base = CATEGORIES.find((c) => c.id === id)!;
  const specific = SPECIFIC_ICON[(raw ?? "").trim().toLowerCase()];
  return specific ? { ...base, icon: specific } : base;
}

const AVATAR_PALETTE = [
  { bg: "#DBEAFE", fg: "#1D4ED8" },
  { bg: "#DCFCE7", fg: "#15803D" },
  { bg: "#FCE7F3", fg: "#BE185D" },
  { bg: "#FEF3C7", fg: "#B45309" },
  { bg: "#EDE9FE", fg: "#6D28D9" },
  { bg: "#E0F2FE", fg: "#0369A1" },
  { bg: "#FFE4E6", fg: "#BE123C" },
];

export function avatarColors(seed: string | undefined | null) {
  const s = seed ?? "?";
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length];
}

export function initials(name: string | undefined | null): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function firstName(name: string | undefined | null): string {
  return (name ?? "").trim().split(/\s+/)[0] || "Someone";
}

/** Equal split to the paisa, same rounding as the server (single implementation in ./split). */
export { equalShares } from "./split";
