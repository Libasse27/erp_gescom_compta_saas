import { Pressable, StyleSheet, Text, View } from "react-native";
import { useAuth } from "../lib/auth-context";

// Écran d'accueil affiché une fois authentifié — remplace le
// PlaceholderScreen du scaffold Phase 9.0. Les écrans ERP réels (clients,
// ventes, ...) arrivent en Phase 9.4.
export function HomeScreen() {
  const { user, logout } = useAuth();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Bienvenue{user ? `, ${user.firstName}` : ""}</Text>
      <Text>Application mobile — en construction (Phase 9).</Text>
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
