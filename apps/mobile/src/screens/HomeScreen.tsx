import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useAuth } from "../lib/auth-context";
import { useHasPermission } from "../lib/permissions";
import type { AppStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<AppStackParamList, "Home">;

// Écran d'accueil affiché une fois authentifié — remplace le
// PlaceholderScreen du scaffold Phase 9.0. Le module Clients (Phase 9.4) est
// le premier écran ERP réel ; les autres modules suivront dans des cycles
// ultérieurs, probablement derrière une barre d'onglets à ce moment-là.
export function HomeScreen({ navigation }: Props) {
  const { user, logout } = useAuth();
  // Gating au niveau de l'entrée de navigation uniquement (masquer le
  // bouton) — même discipline que le web, le backend reste la seule
  // autorité réelle (docs/adr/0015-...).
  const canReadClients = useHasPermission("clients.read");
  const canReadSuppliers = useHasPermission("suppliers.read");
  const canReadProducts = useHasPermission("products.read");
  const canReadStock = useHasPermission("stock.read");
  const canReadSales = useHasPermission("sales.read");
  const canReadPurchases = useHasPermission("purchases.read");

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Bienvenue{user ? `, ${user.firstName}` : ""}</Text>
      <Text>Application mobile — en construction (Phase 9).</Text>
      {canReadClients ? (
        <Pressable style={styles.button} onPress={() => navigation.navigate("ClientsList")}>
          <Text style={styles.buttonText}>Clients</Text>
        </Pressable>
      ) : null}
      {canReadSuppliers ? (
        <Pressable style={styles.button} onPress={() => navigation.navigate("SuppliersList")}>
          <Text style={styles.buttonText}>Fournisseurs</Text>
        </Pressable>
      ) : null}
      {canReadProducts ? (
        <Pressable style={styles.button} onPress={() => navigation.navigate("ProductsList")}>
          <Text style={styles.buttonText}>Produits</Text>
        </Pressable>
      ) : null}
      {canReadStock ? (
        <Pressable style={styles.button} onPress={() => navigation.navigate("StockLevels")}>
          <Text style={styles.buttonText}>Stock</Text>
        </Pressable>
      ) : null}
      {canReadSales ? (
        <Pressable style={styles.button} onPress={() => navigation.navigate("SalesList")}>
          <Text style={styles.buttonText}>Ventes</Text>
        </Pressable>
      ) : null}
      {canReadPurchases ? (
        <Pressable style={styles.button} onPress={() => navigation.navigate("PurchasesList")}>
          <Text style={styles.buttonText}>Achats</Text>
        </Pressable>
      ) : null}
      <Pressable style={styles.button} onPress={() => void logout()}>
        <Text style={styles.buttonText}>Se déconnecter</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  title: {
    fontSize: 20,
    fontWeight: "600",
  },
  button: {
    marginTop: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#1a5fb4",
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  buttonText: {
    color: "#1a5fb4",
    fontWeight: "600",
  },
});
