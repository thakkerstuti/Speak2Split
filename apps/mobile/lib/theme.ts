/**
 * Speak2Split design tokens — matching the Splitzy mockup style:
 * Clean white surfaces, vibrant primary blue (#2563EB), soft sky blue tints (#E0F2FE),
 * pill-shaped buttons, capsule tags, and Plus Jakarta Sans geometric typography.
 */
export const colors = {
  bg: "#F8FAFC",
  bgElevated: "#FFFFFF",
  card: "#FFFFFF",
  cardTinted: "#F1F5F9",
  cardBlue: "#2563EB",
  border: "#E2E8F0",
  textPrimary: "#0F172A",
  textSecondary: "#64748B",
  textMuted: "#94A3B8",
  primary: "#2563EB",
  primaryDark: "#1D4ED8",
  primaryMuted: "#E0F2FE",
  primaryLight: "#EFF6FF",
  accent: "#2563EB",
  accentMuted: "#E0F2FE",
  positive: "#10B981",
  negative: "#EF4444",
  warning: "#F59E0B",
  purple: "#8B5CF6",
  orange: "#F97316",
  onDark: "#FFFFFF",
  pillBg: "#E0F2FE",
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
  sm: 12,
  md: 18,
  lg: 24,
  xl: 30,
  pill: 999,
};

export const fonts = {
  regular: "PlusJakartaSans_400Regular",
  medium: "PlusJakartaSans_500Medium",
  semibold: "PlusJakartaSans_600SemiBold",
  bold: "PlusJakartaSans_700Bold",
  extrabold: "PlusJakartaSans_800ExtraBold",
};

export const typography = {
  display: { fontSize: 28, fontFamily: fonts.extrabold, letterSpacing: -0.5 },
  title: { fontSize: 20, fontFamily: fonts.bold, letterSpacing: -0.3 },
  heading: { fontSize: 18, fontFamily: fonts.bold },
  body: { fontSize: 15, fontFamily: fonts.medium },
  bodyRegular: { fontSize: 14, fontFamily: fonts.regular },
  caption: { fontSize: 13, fontFamily: fonts.medium },
  label: { fontSize: 12, fontFamily: fonts.semibold, letterSpacing: 0.4 },
};
