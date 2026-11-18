import { ReactNode, useEffect, useRef } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Animated,
  Modal,
  KeyboardAvoidingView,
  Platform,
  ViewStyle,
  StyleProp,
  TextStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ArrowLeft, X } from "lucide-react-native";
import { colors, fonts, radius, spacing, shadows } from "../lib/theme";
import { avatarColors, initials, categoryMeta } from "../lib/format";

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export function ScreenHeader({
  title,
  subtitle,
  onBack,
  right,
  large = true,
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  right?: ReactNode;
  large?: boolean;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
      <View style={styles.headerRow}>
        {onBack ? (
          <Pressable onPress={onBack} hitSlop={12} style={styles.iconButton} accessibilityLabel="Go back">
            <ArrowLeft color={colors.textPrimary} size={20} />
          </Pressable>
        ) : null}
        <View style={{ flex: 1 }}>
          <Text style={large ? styles.headerTitleLarge : styles.headerTitle} numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? (
            <Text style={styles.headerSubtitle} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {right}
      </View>
    </View>
  );
}

export function IconButton({
  icon: Icon,
  onPress,
  label,
  badge,
}: {
  icon: any;
  onPress: () => void;
  label: string;
  badge?: number;
}) {
  return (
    <Pressable onPress={onPress} hitSlop={8} style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]} accessibilityLabel={label}>
      <Icon color={colors.textPrimary} size={19} />
      {badge ? (
        <View style={styles.badgeDot}>
          <Text style={styles.badgeDotText}>{badge > 9 ? "9+" : badge}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

export function Card({
  children,
  style,
  onPress,
  padded = true,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  padded?: boolean;
}) {
  const base = [styles.card, padded && { padding: spacing.md }, style];
  if (!onPress) return <View style={base}>{children}</View>;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [...base, pressed && styles.pressed]}>
      {children}
    </Pressable>
  );
}

export function SectionHeader({ title, actionLabel, onAction }: { title: string; actionLabel?: string; onAction?: () => void }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {actionLabel && onAction ? (
        <Pressable onPress={onAction} hitSlop={8}>
          <Text style={styles.sectionAction}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "dark";

export function Button({
  label,
  onPress,
  variant = "primary",
  icon: Icon,
  loading,
  disabled,
  size = "lg",
  style,
  full = true,
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  icon?: any;
  loading?: boolean;
  disabled?: boolean;
  size?: "md" | "lg";
  style?: StyleProp<ViewStyle>;
  full?: boolean;
}) {
  const v = BUTTON_VARIANTS[variant];
  const isDisabled = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!isDisabled, busy: !!loading }}
      style={({ pressed }) => [
        styles.button,
        size === "md" && styles.buttonMd,
        { backgroundColor: v.bg, borderColor: v.border },
        full && { alignSelf: "stretch" },
        variant === "primary" && !isDisabled && shadows.md,
        isDisabled && { opacity: 0.5 },
        pressed && !isDisabled && styles.pressed,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={v.fg} />
      ) : (
        <>
          {Icon ? <Icon color={v.fg} size={size === "md" ? 16 : 18} strokeWidth={2.4} /> : null}
          <Text style={[styles.buttonText, size === "md" && { fontSize: 14 }, { color: v.fg }]}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

const BUTTON_VARIANTS: Record<ButtonVariant, { bg: string; fg: string; border: string }> = {
  primary: { bg: colors.primary, fg: colors.onDark, border: colors.primary },
  secondary: { bg: colors.card, fg: colors.textPrimary, border: colors.border },
  ghost: { bg: "transparent", fg: colors.primary, border: "transparent" },
  danger: { bg: colors.negativeSoft, fg: colors.negative, border: colors.negativeSoft },
  dark: { bg: colors.darkBtnBg, fg: colors.onDark, border: colors.darkBtnBg },
};

export function Chip({
  label,
  selected,
  onPress,
  icon: Icon,
  tone = "default",
  left,
  style,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  icon?: any;
  tone?: "default" | "warning" | "danger" | "success";
  left?: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const t = CHIP_TONES[tone];
  const fg = selected ? colors.onDark : t.fg;
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityState={{ selected: !!selected }}
      style={({ pressed }) => [
        styles.chip,
        { backgroundColor: selected ? colors.primary : t.bg, borderColor: selected ? colors.primary : t.border },
        pressed && styles.pressed,
        style,
      ]}
    >
      {left}
      {Icon ? <Icon color={fg} size={15} strokeWidth={2.4} /> : null}
      <Text style={[styles.chipText, { color: fg }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const CHIP_TONES = {
  default: { bg: colors.card, fg: colors.textSecondary, border: colors.border },
  warning: { bg: colors.warningSoft, fg: "#B45309", border: "#FDE68A" },
  danger: { bg: colors.negativeSoft, fg: colors.negativeDark, border: colors.coralMuted },
  success: { bg: colors.positiveSoft, fg: colors.positiveDark, border: "#A7F3D0" },
};

// ---------------------------------------------------------------------------
// Identity & data display
// ---------------------------------------------------------------------------

export function Avatar({ name, size = 36, ring }: { name?: string | null; size?: number; ring?: boolean }) {
  const c = avatarColors(name);
  return (
    <View
      style={[
        { width: size, height: size, borderRadius: size / 2, backgroundColor: c.bg, alignItems: "center", justifyContent: "center" },
        ring && { borderWidth: 2, borderColor: colors.card },
      ]}
    >
      <Text style={{ color: c.fg, fontFamily: fonts.bold, fontSize: size * 0.38 }}>{initials(name)}</Text>
    </View>
  );
}

export function AvatarStack({ names, max = 4, size = 28 }: { names: (string | undefined)[]; max?: number; size?: number }) {
  const shown = names.slice(0, max);
  const extra = names.length - shown.length;
  return (
    <View style={{ flexDirection: "row", alignItems: "center" }}>
      {shown.map((n, i) => (
        <View key={i} style={{ marginLeft: i === 0 ? 0 : -size * 0.3, zIndex: 10 - i }}>
          <Avatar name={n} size={size} ring />
        </View>
      ))}
      {extra > 0 ? (
        <View style={[styles.stackMore, { width: size, height: size, borderRadius: size / 2, marginLeft: -size * 0.3 }]}>
          <Text style={styles.stackMoreText}>+{extra}</Text>
        </View>
      ) : null}
    </View>
  );
}

export function CategoryIcon({ category, size = 42 }: { category?: string | null; size?: number }) {
  const meta = categoryMeta(category);
  const Icon = meta.icon;
  return (
    <View style={{ width: size, height: size, borderRadius: size * 0.33, backgroundColor: meta.bg, alignItems: "center", justifyContent: "center" }}>
      <Icon color={meta.color} size={size * 0.45} strokeWidth={2.2} />
    </View>
  );
}

export function ListRow({
  left,
  title,
  subtitle,
  right,
  onPress,
  last,
  titleStyle,
}: {
  left?: ReactNode;
  title: string;
  subtitle?: string;
  right?: ReactNode;
  onPress?: () => void;
  last?: boolean;
  titleStyle?: StyleProp<TextStyle>;
}) {
  const content = (
    <>
      {left}
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowTitle, titleStyle]} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.rowSubtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
    </>
  );
  const rowStyle = [styles.row, !last && styles.rowDivider];
  if (!onPress) return <View style={rowStyle}>{content}</View>;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [...rowStyle, pressed && { opacity: 0.6 }]}>
      {content}
    </Pressable>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  body,
  actionLabel,
  onAction,
}: {
  icon?: any;
  title: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.empty}>
      {Icon ? (
        <View style={styles.emptyIcon}>
          <Icon color={colors.primary} size={26} />
        </View>
      ) : null}
      <Text style={styles.emptyTitle}>{title}</Text>
      {body ? <Text style={styles.emptyBody}>{body}</Text> : null}
      {actionLabel && onAction ? (
        <Button label={actionLabel} onPress={onAction} size="md" full={false} style={{ marginTop: spacing.md, paddingHorizontal: spacing.lg }} />
      ) : null}
    </View>
  );
}

export function Skeleton({ width = "100%", height = 16, radius: r = 8, style }: { width?: number | `${number}%`; height?: number; radius?: number; style?: StyleProp<ViewStyle> }) {
  const opacity = useRef(new Animated.Value(0.5)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.5, duration: 700, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return <Animated.View style={[{ width, height, borderRadius: r, backgroundColor: colors.cardSecondary, opacity }, style]} />;
}

// ---------------------------------------------------------------------------
// Bottom sheet
// ---------------------------------------------------------------------------

export function Sheet({
  visible,
  onClose,
  title,
  subtitle,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.sheetOverlay}>
        <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityLabel="Close" />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.md) + spacing.md }]}>
          <View style={styles.sheetHandle} />
          {title ? (
            <View style={styles.sheetHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.sheetTitle}>{title}</Text>
                {subtitle ? <Text style={styles.sheetSubtitle}>{subtitle}</Text> : null}
              </View>
              <Pressable onPress={onClose} hitSlop={12} style={styles.iconButton} accessibilityLabel="Close">
                <X color={colors.textSecondary} size={18} />
              </Pressable>
            </View>
          ) : null}
          {children}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.85, transform: [{ scale: 0.985 }] },

  header: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md, backgroundColor: colors.bg },
  headerRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm + 4 },
  headerTitleLarge: { fontFamily: fonts.extrabold, fontSize: 28, color: colors.textPrimary, letterSpacing: -0.6 },
  headerTitle: { fontFamily: fonts.bold, fontSize: 20, color: colors.textPrimary, letterSpacing: -0.3 },
  headerSubtitle: { fontFamily: fonts.medium, fontSize: 13, color: colors.textSecondary, marginTop: 2 },

  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeDot: {
    position: "absolute",
    top: -2,
    right: -2,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: colors.negative,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: colors.bg,
  },
  badgeDotText: { color: colors.onDark, fontFamily: fonts.bold, fontSize: 9 },

  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.sm,
  },

  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: spacing.lg,
    marginBottom: spacing.sm + 4,
  },
  sectionTitle: { fontFamily: fonts.bold, fontSize: 17, color: colors.textPrimary, letterSpacing: -0.2 },
  sectionAction: { fontFamily: fonts.semibold, fontSize: 14, color: colors.primary },

  button: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingVertical: 16,
    paddingHorizontal: spacing.lg,
    minHeight: 54,
  },
  buttonMd: { paddingVertical: 10, minHeight: 42, paddingHorizontal: spacing.md },
  buttonText: { fontFamily: fonts.bold, fontSize: 16 },

  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: radius.pill,
    borderWidth: 1,
    maxWidth: 220,
  },
  chipText: { fontFamily: fonts.semibold, fontSize: 13 },

  stackMore: { backgroundColor: colors.cardSecondary, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: colors.card },
  stackMoreText: { fontFamily: fonts.bold, fontSize: 10, color: colors.textSecondary },

  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: 12 },
  rowDivider: { borderBottomWidth: 1, borderBottomColor: colors.borderSubtle },
  rowTitle: { fontFamily: fonts.semibold, fontSize: 15, color: colors.textPrimary },
  rowSubtitle: { fontFamily: fonts.medium, fontSize: 12, color: colors.textSecondary, marginTop: 2 },

  empty: { alignItems: "center", paddingVertical: spacing.xl, paddingHorizontal: spacing.lg },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: colors.primaryLight,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.md,
  },
  emptyTitle: { fontFamily: fonts.bold, fontSize: 16, color: colors.textPrimary, textAlign: "center" },
  emptyBody: { fontFamily: fonts.regular, fontSize: 14, color: colors.textSecondary, textAlign: "center", marginTop: 4, lineHeight: 20 },

  sheetOverlay: { flex: 1, backgroundColor: "rgba(15, 23, 42, 0.45)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: colors.bgElevated,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    maxHeight: "88%",
  },
  sheetHandle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: spacing.md },
  sheetHeader: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md, marginBottom: spacing.md },
  sheetTitle: { fontFamily: fonts.bold, fontSize: 20, color: colors.textPrimary, letterSpacing: -0.3 },
  sheetSubtitle: { fontFamily: fonts.regular, fontSize: 13, color: colors.textSecondary, marginTop: 4, lineHeight: 18 },
});
