/**
 * Speak2Split design tokens — light, warm, friendly fintech-app style
 * (matching the reference design: white surfaces, a confident blue
 * primary, soft tinted cards, generous rounding).
 */
export const colors = {
  bg: "#F6F8FC",
  bgElevated: "#FFFFFF",
  card: "#FFFFFF",
  cardTinted: "#EFF5FF",
  border: "#EAEEF5",
  textPrimary: "#0F172A",
  textSecondary: "#64748B",
  textMuted: "#94A3B8",
  primary: "#2F6FED",
  primaryDark: "#1E4FC4",
  primaryMuted: "#E4EDFF",
  accent: "#2F6FED", // kept as an alias so existing screens using `accent` still work
  accentMuted: "#E4EDFF",
  positive: "#1BB980",
  negative: "#F04452",
  warning: "#F5A623",
  onDark: "#FFFFFF",
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

export const radius = {
  sm: 10,
  md: 16,
  lg: 24,
  pill: 999,
};

/**
 * Font family names, registered via useFonts() in the root layout using
 * @expo-google-fonts/plus-jakarta-sans. Falls back to the system font
 * automatically until the fonts finish loading (see _layout.tsx).
 */
export const fonts = {
  regular: "PlusJakartaSans_400Regular",
  medium: "PlusJakartaSans_500Medium",
  semibold: "PlusJakartaSans_600SemiBold",
  bold: "PlusJakartaSans_700Bold",
  extrabold: "PlusJakartaSans_800ExtraBold",
};

export const typography = {
  display: { fontSize: 30, fontFamily: fonts.extrabold, letterSpacing: -0.5 },
  title: { fontSize: 20, fontFamily: fonts.bold, letterSpacing: -0.3 },
  body: { fontSize: 16, fontFamily: fonts.regular },
  bodyMedium: { fontSize: 15, fontFamily: fonts.medium },
  caption: { fontSize: 13, fontFamily: fonts.medium },
  label: { fontSize: 12, fontFamily: fonts.semibold, letterSpacing: 0.4 },
};
