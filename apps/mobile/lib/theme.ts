/**
 * Speak2Split Design System Tokens — Premium Fintech Visual Language:
 * Clean off-white background (#F8FAFD), crisp white elevated cards with subtle borders & soft shadows,
 * deep indigo/blue primary branding (#2563EB / #1E1B4B), vibrant emerald green (#10B981) for positive balances,
 * refined coral (#EF4444) for negative balances, and Plus Jakarta Sans geometric typography.
 */
export const colors = {
  bg: "#F8FAFD",
  bgElevated: "#FFFFFF",
  card: "#FFFFFF",
  cardTinted: "#F8FAFC",
  cardSecondary: "#F1F5F9",
  cardDark: "#0F172A",
  cardIndigo: "#1E1B4B",
  border: "#E2E8F0",
  borderSubtle: "#F1F5F9",
  textPrimary: "#0F172A",
  textSecondary: "#475569",
  textMuted: "#94A3B8",
  primary: "#2563EB",
  primaryDark: "#1D4ED8",
  primaryDeep: "#1E1B4B",
  primaryMuted: "#DBEAFE",
  primaryLight: "#EFF6FF",
  accent: "#3B82F6",
  accentMuted: "#E0F2FE",
  cardBlue: "#2563EB",
  coral: "#EF4444",
  coralDark: "#DC2626",
  coralMuted: "#FEE2E2",
  positive: "#10B981",
  positiveDark: "#059669",
  positiveSoft: "#ECFDF5",
  negative: "#EF4444",
  negativeDark: "#DC2626",
  negativeSoft: "#FEF2F2",
  warning: "#F59E0B",
  warningSoft: "#FEF3C7",
  purple: "#8B5CF6",
  purpleSoft: "#F3E8FF",
  orange: "#F97316",
  orangeSoft: "#FFEDD5",
  onDark: "#FFFFFF",
  pillBg: "#F1F5F9",
  darkBtnBg: "#0F172A",
};

export const shadows = {
  sm: {
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 6,
    elevation: 2,
  },
  md: {
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 4,
  },
  lg: {
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
    elevation: 6,
  },
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
  xs: 8,
  sm: 12,
  md: 18,
  lg: 24,
  xl: 32,
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
  display: { fontSize: 32, fontFamily: fonts.extrabold, letterSpacing: -0.8 },
  title: { fontSize: 22, fontFamily: fonts.bold, letterSpacing: -0.4 },
  heading: { fontSize: 18, fontFamily: fonts.bold, letterSpacing: -0.2 },
  body: { fontSize: 15, fontFamily: fonts.medium },
  bodyRegular: { fontSize: 14, fontFamily: fonts.regular },
  caption: { fontSize: 13, fontFamily: fonts.medium },
  label: { fontSize: 12, fontFamily: fonts.semibold, letterSpacing: 0.5 },
};
