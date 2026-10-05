import { Tabs } from "expo-router";
import { Home, Users, Contact2, Bell, User } from "lucide-react-native";
import { colors, fonts } from "../../lib/theme";

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: colors.card,
          borderTopColor: colors.borderSubtle,
          borderTopWidth: 1,
          height: 68,
          paddingTop: 8,
          paddingBottom: 12,
          elevation: 8,
          shadowColor: "#0F172A",
          shadowOffset: { width: 0, height: -4 },
          shadowOpacity: 0.04,
          shadowRadius: 10,
        },
        tabBarLabelStyle: { fontFamily: fonts.semibold, fontSize: 11, marginTop: 2 },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Home", tabBarIcon: ({ color, size }) => <Home color={color} size={size - 2} strokeWidth={2.2} /> }} />
      <Tabs.Screen name="groups/index" options={{ title: "Groups", tabBarIcon: ({ color, size }) => <Users color={color} size={size - 2} strokeWidth={2.2} /> }} />
      <Tabs.Screen name="people" options={{ title: "People", tabBarIcon: ({ color, size }) => <Contact2 color={color} size={size - 2} strokeWidth={2.2} /> }} />
      <Tabs.Screen name="notifications" options={{ title: "Alerts", tabBarIcon: ({ color, size }) => <Bell color={color} size={size - 2} strokeWidth={2.2} /> }} />
      <Tabs.Screen name="profile" options={{ title: "Profile", tabBarIcon: ({ color, size }) => <User color={color} size={size - 2} strokeWidth={2.2} /> }} />
      <Tabs.Screen name="add-expense" options={{ href: null }} />
      <Tabs.Screen name="groups/[groupId]" options={{ href: null }} />
      <Tabs.Screen name="groups/shopping-list" options={{ href: null }} />
      <Tabs.Screen name="groups/templates" options={{ href: null }} />
      <Tabs.Screen name="groups/documents" options={{ href: null }} />
      <Tabs.Screen name="search" options={{ href: null }} />
    </Tabs>
  );
}
