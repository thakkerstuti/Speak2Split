import { View, ActivityIndicator } from "react-native";
import { colors } from "../lib/theme";

export default function Index() {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg }}>
      <ActivityIndicator color={colors.primary} size="large" />
    </View>
  );
}

