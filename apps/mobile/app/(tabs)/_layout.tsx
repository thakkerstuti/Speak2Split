import { View, Pressable, StyleSheet, Text } from "react-native";
import { Tabs, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Home, Users, Contact2, User, Mic } from "lucide-react-native";
import { colors, fonts } from "../../lib/theme";

/** Raised center button: one tap starts listening — no group selection needed. */
function SpeakTabButton() {
  const router = useRouter();
  return (
    <View style={styles.speakSlot} pointerEvents="box-none">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Add expense by voice"
        onPress={() =>
          router.push({
            pathname: "/(tabs)/add-expense",
            params: { mode: "voice", autostart: String(Date.now()), groupId: "" },
          })
        }
        style={({ pressed }) => [styles.speakButton, pressed && { transform: [{ scale: 0.94 }] }]}
      >
        <Mic color={colors.onDark} size={26} strokeWidth={2.4} />
      </Pressable>
      <Text style={styles.speakLabel}>Speak</Text>
    </View>
  );
}

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const bottomPad = Math.max(insets.bottom, 10);
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarHideOnKeyboard: true,
        tabBarStyle: {
          backgroundColor: colors.card,
          borderTopColor: colors.borderSubtle,
          borderTopWidth: 1,
          height: 60 + bottomPad,
          paddingTop: 8,
          paddingBottom: bottomPad,
          elevation: 12,
          shadowColor: "#0F172A",
          shadowOffset: { width: 0, height: -4 },
          shadowOpacity: 0.05,
          shadowRadius: 12,
        },
        tabBarLabelStyle: { fontFamily: fonts.semibold, fontSize: 11, marginTop: 2 },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Home", tabBarIcon: ({ color, size }) => <Home color={color} size={size - 2} strokeWidth={2.2} /> }} />
      <Tabs.Screen name="groups/index" options={{ title: "Groups", tabBarIcon: ({ color, size }) => <Users color={color} size={size - 2} strokeWidth={2.2} /> }} />
      <Tabs.Screen name="add-expense" options={{ title: "Speak", tabBarButton: () => <SpeakTabButton /> }} />
      <Tabs.Screen name="people" options={{ title: "People", tabBarIcon: ({ color, size }) => <Contact2 color={color} size={size - 2} strokeWidth={2.2} /> }} />
      <Tabs.Screen name="profile" options={{ title: "Profile", tabBarIcon: ({ color, size }) => <User color={color} size={size - 2} strokeWidth={2.2} /> }} />
      <Tabs.Screen name="notifications" options={{ href: null }} />
      <Tabs.Screen name="groups/[groupId]" options={{ href: null }} />
      <Tabs.Screen name="groups/shopping-list" options={{ href: null }} />
      <Tabs.Screen name="groups/templates" options={{ href: null }} />
      <Tabs.Screen name="groups/documents" options={{ href: null }} />
      <Tabs.Screen name="search" options={{ href: null }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  speakSlot: { flex: 1, alignItems: "center", justifyContent: "flex-start" },
  speakButton: {
    marginTop: -26,
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 4,
    borderColor: colors.card,
    shadowColor: colors.primary,
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10,
  },
  speakLabel: { fontFamily: fonts.semibold, fontSize: 11, color: colors.primary, marginTop: 2 },
});
