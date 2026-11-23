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
  container: { gap: 1 },
  title: { fontSize: 20, lineHeight: 24, fontWeight: "800", color: "#1a1f6e" },
  subtitle: {
    color: "#64748b",
    fontSize: 12,
    lineHeight: 14,
    fontWeight: "700",
  },
});
