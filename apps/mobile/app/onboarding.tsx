import { useRef, useState } from "react";
import { View, Text, StyleSheet, Dimensions, ScrollView, Pressable } from "react-native";
import { useRouter } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { Wallet, Mic, CalendarCheck, Users2, Sparkles, HandCoins } from "lucide-react-native";
import { colors, spacing, radius, typography, fonts } from "../lib/theme";

const ONBOARDING_KEY = "speak2split_has_onboarded";
const { width } = Dimensions.get("window");

const SLIDES = [
  {
    icons: [Wallet, Users2, CalendarCheck],
    title: "Split Money Made\nSimple for Everyone",
    subtitle: "Whether it's rent, groceries, or a weekend trip — keep everyone on the same page. Add, split, and settle with just a tap.",
  },
  {
    icons: [Mic, Sparkles, HandCoins],
    title: "Just Say the\nExpense Out Loud",
    subtitle: '"I paid 2400 for electricity" — Speak2Split understands the amount, who paid, and who\'s splitting it. No typing needed.',
  },
  {
    icons: [HandCoins, Users2, Wallet],
    title: "See Balances,\nSettle Instantly",
    subtitle: "Always know who owes what. Settle up in one tap, and everyone in the group sees it update in real time.",
  },
];

export default function OnboardingScreen() {
  const router = useRouter();
  const scrollRef = useRef<ScrollView>(null);
  const [index, setIndex] = useState(0);

  const finish = async () => {
    await SecureStore.setItemAsync(ONBOARDING_KEY, "true");
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
          <Pressable onPress={finish} hitSlop={12}>
            <Text style={styles.skipText}>Skip</Text>
          </Pressable>
        ) : (
          <View style={{ height: 20 }} />
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
              <View style={styles.illustrationCircleOuter}>
                <View style={styles.illustrationCircleInner}>
                  {slide.icons[1] && (
                    <View style={styles.iconBadgeCenter}>
                      {(() => {
                        const CenterIcon = slide.icons[1];
                        return <CenterIcon color={colors.primary} size={40} strokeWidth={1.8} />;
                      })()}
                    </View>
                  )}
                </View>
                <View style={[styles.iconBadgeFloating, { top: 12, left: 4 }]}>
                  {(() => {
                    const Icon = slide.icons[0];
                    return <Icon color={colors.onDark} size={20} />;
                  })()}
                </View>
                <View style={[styles.iconBadgeFloating, styles.iconBadgeFloatingAlt, { bottom: 18, right: 0 }]}>
                  {(() => {
                    const Icon = slide.icons[2];
                    return <Icon color={colors.onDark} size={20} />;
                  })()}
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

        <Pressable style={styles.nextButton} onPress={next}>
          <Text style={styles.nextButtonText}>{index === SLIDES.length - 1 ? "Get Started" : "Next"}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  skipRow: { flexDirection: "row", justifyContent: "flex-end", paddingHorizontal: spacing.lg, paddingTop: spacing.xl },
  skipText: { color: colors.textSecondary, fontFamily: fonts.semibold, fontSize: 14 },
  slide: { flex: 1, paddingHorizontal: spacing.xl, alignItems: "center", paddingTop: spacing.lg },
  illustrationWrap: { width: 260, height: 260, alignItems: "center", justifyContent: "center", marginBottom: spacing.xl },
  illustrationCircleOuter: {
    width: 240,
    height: 240,
    borderRadius: 120,
    backgroundColor: colors.primaryMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  illustrationCircleInner: {
    width: 150,
    height: 150,
    borderRadius: 75,
    backgroundColor: colors.bgElevated,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: colors.primary,
    shadowOpacity: 0.12,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  iconBadgeCenter: { alignItems: "center", justifyContent: "center" },
  iconBadgeFloating: {
    position: "absolute",
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: colors.primary,
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  iconBadgeFloatingAlt: { backgroundColor: colors.warning, shadowColor: colors.warning },
  title: { ...typography.display, fontSize: 26, color: colors.textPrimary, textAlign: "center", lineHeight: 34 },
  subtitle: { ...typography.body, color: colors.textSecondary, textAlign: "center", marginTop: spacing.md, lineHeight: 22, paddingHorizontal: spacing.sm },
  footer: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xl, paddingTop: spacing.md },
  dotsRow: { flexDirection: "row", justifyContent: "center", gap: 6, marginBottom: spacing.lg },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.border },
  dotActive: { width: 22, backgroundColor: colors.primary },
  nextButton: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 17, alignItems: "center" },
  nextButtonText: { color: colors.onDark, fontFamily: fonts.bold, fontSize: 16 },
});
