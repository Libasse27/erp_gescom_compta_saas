import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { QueryClientProvider } from "@tanstack/react-query";
import { StatusBar } from "expo-status-bar";
import { ActivityIndicator, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider, useAuth } from "./src/lib/auth-context";
import { queryClient, useSyncEngine } from "./src/lib/offline";
import type { AppStackParamList, AuthStackParamList } from "./src/navigation/types";
import { ClientFormScreen } from "./src/screens/ClientFormScreen";
import { ClientsListScreen } from "./src/screens/ClientsListScreen";
import { HomeScreen } from "./src/screens/HomeScreen";
import { LoginScreen } from "./src/screens/LoginScreen";
import { MfaVerifyScreen } from "./src/screens/MfaVerifyScreen";

// Flux d'authentification réel (Phase 9.2, docs/adr/0012-stack-mobile.md) :
// remplace le squelette de navigation de la Phase 9.0. La navigation
// protégée par tenant/permissions/plan arrive avec les écrans ERP (9.4).
const AuthStack = createNativeStackNavigator<AuthStackParamList>();
const AppStack = createNativeStackNavigator<AppStackParamList>();

function RootNavigator() {
  const { status } = useAuth();
  // Rejeu de la file de mutations hors-ligne dès qu'une session authentifiée
  // et une connexion réseau sont disponibles (Phase 9.3, docs/adr/0014-...).
  useSyncEngine();

  if (status === "loading") {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator />
      </View>
    );
  }

  if (status === "unauthenticated") {
    return (
      <AuthStack.Navigator>
        <AuthStack.Screen name="Login" component={LoginScreen} options={{ title: "Connexion" }} />
        <AuthStack.Screen name="MfaVerify" component={MfaVerifyScreen} options={{ title: "Vérification" }} />
      </AuthStack.Navigator>
    );
  }

  return (
    <AppStack.Navigator>
      <AppStack.Screen name="Home" component={HomeScreen} options={{ title: "Accueil" }} />
      <AppStack.Screen name="ClientsList" component={ClientsListScreen} options={{ title: "Clients" }} />
      <AppStack.Screen name="ClientForm" component={ClientFormScreen} options={{ title: "Client" }} />
    </AppStack.Navigator>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <NavigationContainer>
            <RootNavigator />
          </NavigationContainer>
        </AuthProvider>
      </QueryClientProvider>
      <StatusBar style="auto" />
    </SafeAreaProvider>
  );
}
