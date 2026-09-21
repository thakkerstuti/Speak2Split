import { Tabs } from "expo-router";
import { Home, Users, PlusCircle, Bell, User, Contact2 } from "lucide-react-native";
import { colors, fonts } from "../../lib/theme";

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: { backgroundColor: colors.bgElevated, borderTopColor: colors.border, height: 64, paddingTop: 8, paddingBottom: 10 },
        tabBarLabelStyle: { fontFamily: fonts.semibold, fontSize: 11 },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Home", tabBarIcon: ({ color, size }) => <Home color={color} size={size} /> }} />
      <Tabs.Screen name="groups/index" options={{ title: "Groups", tabBarIcon: ({ color, size }) => <Users color={color} size={size} /> }} />
      <Tabs.Screen name="add-expense" options={{ title: "Add", tabBarIcon: ({ color, size }) => <PlusCircle color={color} size={size} /> }} />
      <Tabs.Screen name="people" options={{ title: "People", tabBarIcon: ({ color, size }) => <Contact2 color={color} size={size} /> }} />
      <Tabs.Screen name="notifications" options={{ title: "Alerts", tabBarIcon: ({ color, size }) => <Bell color={color} size={size} /> }} />
      <Tabs.Screen name="profile" options={{ title: "Profile", tabBarIcon: ({ color, size }) => <User color={color} size={size} /> }} />
      <Tabs.Screen name="groups/[groupId]" options={{ href: null }} />
      <Tabs.Screen name="groups/shopping-list" options={{ href: null }} />
      <Tabs.Screen name="groups/templates" options={{ href: null }} />
      <Tabs.Screen name="groups/documents" options={{ href: null }} />
      <Tabs.Screen name="search" options={{ href: null }} />
    </Tabs>
  );
}
