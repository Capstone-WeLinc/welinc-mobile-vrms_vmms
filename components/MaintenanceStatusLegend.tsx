import { StyleSheet, Text, View } from "react-native";

const statuses = [
  { label: "Pending", color: "#047857" },
  { label: "Due", color: "#c2410c" },
  { label: "Overdue", color: "#b91c1c" },
  { label: "In Progress", color: "#1d4ed8" },
  { label: "Done / Awaiting review", color: "#b45309" },
  { label: "Completed / Cancelled", color: "#64748b" },
];

export function MaintenanceStatusLegend() {
  return (
    <View
      style={styles.container}
      accessibilityLabel="Maintenance schedule status legend"
    >
      <Text style={styles.title}>Schedule status</Text>
      <View style={styles.items}>
        {statuses.map((status) => (
          <View key={status.label} style={styles.item}>
            <View style={[styles.dot, { backgroundColor: status.color }]} />
            <Text style={styles.label}>{status.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 7 },
  title: { color: "#334155", fontSize: 12, fontWeight: "700" },
  items: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  item: { flexDirection: "row", alignItems: "center", gap: 5 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  label: { color: "#334155", fontSize: 11 },
});
