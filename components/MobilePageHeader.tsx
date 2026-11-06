import { StyleSheet, Text, View } from "react-native";

export function MobilePageHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.subtitle}>{subtitle}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 2 },
  title: { fontSize: 24, fontWeight: "700", color: "#0d0d0d" },
  subtitle: { color: "#64748b", fontSize: 13 },
});
