import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { PlaceholderScreen } from "./src/screens/PlaceholderScreen";

// Squelette de navigation Phase 9.0 (docs/adr/0012-stack-mobile.md). Le flux
// d'authentification (login/MFA/refresh via expo-secure-store) et la
// navigation protégée par tenant/permissions arrivent en Phase 9.2 — pas de
// logique métier ici volontairement.
const Stack = createNativeStackNavigator();

export default function App() {
  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <Stack.Navigator>
          <Stack.Screen name="Accueil" component={PlaceholderScreen} />
        </Stack.Navigator>
      </NavigationContainer>
      <StatusBar style="auto" />
    </SafeAreaProvider>
  );
}
