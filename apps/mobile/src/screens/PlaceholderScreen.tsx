import { StyleSheet, Text, View } from "react-native";

// Écran temporaire du scaffold Phase 9.0 — remplacé par le flux
// d'authentification réel en Phase 9.2 (docs/adr/0012-stack-mobile.md).
export function PlaceholderScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>ERP Gescom Compta</Text>
      <Text>Application mobile — en construction (Phase 9).</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  title: {
    fontSize: 20,
    fontWeight: "600",
  },
});
