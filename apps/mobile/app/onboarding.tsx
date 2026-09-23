import { useRef, useState } from "react";
import { View, Text, StyleSheet, Dimensions, ScrollView, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { Home, DollarSign, CalendarCheck, BarChart3, Wallet, Users, Mic, Sparkles, HandCoins } from "lucide-react-native";
import { useAuthStore } from "../store/auth-store";
import { colors, spacing, radius, typography, fonts } from "../lib/theme";

const { width } = Dimensions.get("window");

const SLIDES = [
  {
    title: "Split Money Made\nSimple for Roommates",
    subtitle: "Whether it's rent, groceries, or weekend plans, keep everyone on the same page. Add, split, and settle with just a tap.",
  },
  {
    title: "Just Say the\nExpense Out Loud",
    subtitle: '"I paid 2400 for electricity" — Speak2Split understands the amount, who paid, and who\'s splitting it. No typing needed.',
  },
  {
    title: "See Balances,\nSettle Instantly",
    subtitle: "Always know who owes what. Settle up in one tap, and everyone in the group sees it update in real time.",
  },
];

export default function OnboardingScreen() {
  const router = useRouter();
  const scrollRef = useRef<ScrollView>(null);
  const [index, setIndex] = useState(0);

  const finish = async () => {
    await useAuthStore.getState().setOnboarded(true);
    router.replace("/(auth)/login");
  };

  const next = () => {
    if (index < SLIDES.length - 1) {
      scrollRef.current?.scrollTo({ x: (index + 1) * width, animated: true });
      setIndex(index + 1);
    } else {
      finish();
    }
  };

  const onMomentumScrollEnd = (e: any) => {
    const newIndex = Math.round(e.nativeEvent.contentOffset.x / width);
    setIndex(newIndex);
  };

  return (
    <View style={styles.container}>
      <View style={styles.skipRow}>
        {index < SLIDES.length - 1 ? (
          <Pressable style={styles.skipPill} onPress={finish} hitSlop={12}>
            <Text style={styles.skipText}>Skip</Text>
          </Pressable>
        ) : (
          <View style={{ height: 36 }} />
        )}
      </View>

      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onMomentumScrollEnd}
        style={{ flex: 1 }}
      >
        {SLIDES.map((slide, i) => (
          <View key={i} style={[styles.slide, { width }]}>
            <View style={styles.illustrationWrap}>
              {/* Dotted Orbit Line */}
              <View style={styles.orbitCircle}>
                <View style={styles.centerHouseCard}>
                  <Home color={colors.primary} size={42} strokeWidth={2} />
                  <View style={styles.avatarRow}>
                    <Users color={colors.primary} size={20} />
                  </View>
                </View>

                {/* Floating Badges (matching mockup) */}
                <View style={[styles.floatingBadge, { top: 6, left: 18, backgroundColor: colors.primary }]}>
                  <DollarSign color={colors.onDark} size={18} strokeWidth={2.5} />
                </View>
                <View style={[styles.floatingBadge, { top: 6, right: 18, backgroundColor: "#F8FAFC", borderWidth: 1, borderColor: colors.border }]}>
                  <CalendarCheck color={colors.primary} size={18} strokeWidth={2} />
                </View>
                <View style={[styles.floatingBadge, { bottom: 20, right: 10, backgroundColor: colors.primary }]}>
                  <BarChart3 color={colors.onDark} size={18} strokeWidth={2} />
                </View>
                <View style={[styles.floatingBadge, { bottom: 20, left: 10, backgroundColor: "#F8FAFC", borderWidth: 1, borderColor: colors.border }]}>
                  <Wallet color={colors.primary} size={18} strokeWidth={2} />
                </View>
              </View>
            </View>

            <Text style={styles.title}>{slide.title}</Text>
            <Text style={styles.subtitle}>{slide.subtitle}</Text>
          </View>
        ))}
      </ScrollView>

      <View style={styles.footer}>
        <View style={styles.dotsRow}>
          {SLIDES.map((_, i) => (
            <View key={i} style={[styles.dot, i === index && styles.dotActive]} />
          ))}
        </View>

        <Pressable style={({ pressed }) => [styles.nextButton, pressed && { opacity: 0.9 }]} onPress={next}>
          <Text style={styles.nextButtonText}>{index === SLIDES.length - 1 ? "Get Started" : "Next"}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  skipRow: { flexDirection: "row", justifyContent: "flex-end", paddingHorizontal: spacing.lg, paddingTop: spacing.xl + 10 },
  skipPill: {
    backgroundColor: colors.primaryMuted,
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: radius.pill,
  },
  skipText: { color: colors.primary, fontFamily: fonts.bold, fontSize: 14 },
  slide: { flex: 1, paddingHorizontal: spacing.xl, alignItems: "center", paddingTop: spacing.md },
  illustrationWrap: { width: 280, height: 280, alignItems: "center", justifyContent: "center", marginBottom: spacing.xl },
  orbitCircle: {
    width: 250,
    height: 250,
    borderRadius: 125,
    borderWidth: 2,
    borderColor: "#93C5FD",
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  centerHouseCard: {
    width: 140,
    height: 140,
    borderRadius: 24,
    backgroundColor: colors.card,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#3B82F6",
    shadowColor: colors.primary,
    shadowOpacity: 0.15,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 5,
    gap: 8,
  },
  avatarRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  floatingBadge: {
    position: "absolute",
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  title: { ...typography.display, fontSize: 26, color: colors.textPrimary, textAlign: "center", lineHeight: 34 },
  subtitle: { ...typography.bodyRegular, color: colors.textSecondary, textAlign: "center", marginTop: spacing.md, lineHeight: 22, paddingHorizontal: spacing.xs },
  footer: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xl + 10, paddingTop: spacing.md },
  dotsRow: { flexDirection: "row", justifyContent: "center", gap: 8, marginBottom: spacing.xl },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.border },
  dotActive: { width: 24, borderRadius: 4, backgroundColor: colors.primary },
  nextButton: { backgroundColor: colors.primary, borderRadius: radius.pill, paddingVertical: 17, alignItems: "center" },
  nextButtonText: { color: colors.onDark, fontFamily: fonts.bold, fontSize: 16 },
});
