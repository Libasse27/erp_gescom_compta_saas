import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { QueryClientProvider } from "@tanstack/react-query";
import { StatusBar } from "expo-status-bar";
import { ActivityIndicator, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider, useAuth } from "./src/lib/auth-context";
import { queryClient, useSyncEngine } from "./src/lib/offline";
import type { AppStackParamList, AuthStackParamList } from "./src/navigation/types";
import { AccountFormScreen } from "./src/screens/AccountFormScreen";
import { AccountsListScreen } from "./src/screens/AccountsListScreen";
import { ClientFormScreen } from "./src/screens/ClientFormScreen";
import { ClientsListScreen } from "./src/screens/ClientsListScreen";
import { HomeScreen } from "./src/screens/HomeScreen";
import { InvoiceDetailScreen } from "./src/screens/InvoiceDetailScreen";
import { InvoiceFormScreen } from "./src/screens/InvoiceFormScreen";
import { InvoicesListScreen } from "./src/screens/InvoicesListScreen";
import { JournalEntriesListScreen } from "./src/screens/JournalEntriesListScreen";
import { JournalEntryDetailScreen } from "./src/screens/JournalEntryDetailScreen";
import { JournalEntryFormScreen } from "./src/screens/JournalEntryFormScreen";
import { LoginScreen } from "./src/screens/LoginScreen";
import { MfaVerifyScreen } from "./src/screens/MfaVerifyScreen";
import { ProductFormScreen } from "./src/screens/ProductFormScreen";
import { ProductsListScreen } from "./src/screens/ProductsListScreen";
import { PurchaseDetailScreen } from "./src/screens/PurchaseDetailScreen";
import { PurchaseFormScreen } from "./src/screens/PurchaseFormScreen";
import { PurchasesListScreen } from "./src/screens/PurchasesListScreen";
import { ReportsScreen } from "./src/screens/ReportsScreen";
import { SaleDetailScreen } from "./src/screens/SaleDetailScreen";
import { SaleFormScreen } from "./src/screens/SaleFormScreen";
import { SalesListScreen } from "./src/screens/SalesListScreen";
import { StockLevelsScreen } from "./src/screens/StockLevelsScreen";
import { StockMovementFormScreen } from "./src/screens/StockMovementFormScreen";
import { StockMovementHistoryScreen } from "./src/screens/StockMovementHistoryScreen";
import { SupplierFormScreen } from "./src/screens/SupplierFormScreen";
import { SuppliersListScreen } from "./src/screens/SuppliersListScreen";
import { TrialBalanceScreen } from "./src/screens/TrialBalanceScreen";

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
      <AppStack.Screen name="SuppliersList" component={SuppliersListScreen} options={{ title: "Fournisseurs" }} />
      <AppStack.Screen name="SupplierForm" component={SupplierFormScreen} options={{ title: "Fournisseur" }} />
      <AppStack.Screen name="ProductsList" component={ProductsListScreen} options={{ title: "Produits" }} />
      <AppStack.Screen name="ProductForm" component={ProductFormScreen} options={{ title: "Produit" }} />
      <AppStack.Screen name="StockLevels" component={StockLevelsScreen} options={{ title: "Stock" }} />
      <AppStack.Screen
        name="StockMovementForm"
        component={StockMovementFormScreen}
        options={{ title: "Mouvement de stock" }}
      />
      <AppStack.Screen
        name="StockMovementHistory"
        component={StockMovementHistoryScreen}
        options={{ title: "Historique" }}
      />
      <AppStack.Screen name="SalesList" component={SalesListScreen} options={{ title: "Ventes" }} />
      <AppStack.Screen name="SaleForm" component={SaleFormScreen} options={{ title: "Nouvelle vente" }} />
      <AppStack.Screen name="SaleDetail" component={SaleDetailScreen} options={{ title: "Vente" }} />
      <AppStack.Screen name="PurchasesList" component={PurchasesListScreen} options={{ title: "Achats" }} />
      <AppStack.Screen name="PurchaseForm" component={PurchaseFormScreen} options={{ title: "Nouvel achat" }} />
      <AppStack.Screen name="PurchaseDetail" component={PurchaseDetailScreen} options={{ title: "Achat" }} />
      <AppStack.Screen name="InvoicesList" component={InvoicesListScreen} options={{ title: "Facturation" }} />
      <AppStack.Screen name="InvoiceForm" component={InvoiceFormScreen} options={{ title: "Nouvelle facture" }} />
      <AppStack.Screen name="InvoiceDetail" component={InvoiceDetailScreen} options={{ title: "Facture" }} />
      <AppStack.Screen name="AccountsList" component={AccountsListScreen} options={{ title: "Comptabilité" }} />
      <AppStack.Screen name="AccountForm" component={AccountFormScreen} options={{ title: "Nouveau compte" }} />
      <AppStack.Screen
        name="JournalEntriesList"
        component={JournalEntriesListScreen}
        options={{ title: "Écritures" }}
      />
      <AppStack.Screen
        name="JournalEntryForm"
        component={JournalEntryFormScreen}
        options={{ title: "Nouvelle écriture" }}
      />
      <AppStack.Screen
        name="JournalEntryDetail"
        component={JournalEntryDetailScreen}
        options={{ title: "Écriture" }}
      />
      <AppStack.Screen name="TrialBalance" component={TrialBalanceScreen} options={{ title: "Balance" }} />
      <AppStack.Screen name="Reports" component={ReportsScreen} options={{ title: "Rapports" }} />
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
