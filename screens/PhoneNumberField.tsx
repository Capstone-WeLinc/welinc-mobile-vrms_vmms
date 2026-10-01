import { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { normalizePhoneNumber } from "../services/phoneNumber";

// Only destinations supported by the configured SMS integration belong here.
const supportedCountry = { name: "Philippines", callingCode: "+63" };

export function PhoneNumberField({ value, onChange, editable = true }: { value: string; onChange: (value: string) => void; editable?: boolean }) {
  const [choosingCountry, setChoosingCountry] = useState(false);
  const normalized = normalizePhoneNumber(value);
  const localNumber = normalized.startsWith("+63") ? normalized.slice(3) : value;
  return (
    <View>
      <Pressable accessibilityRole="button" accessibilityLabel="Select SMS country. Philippines, plus 63" disabled={!editable} onPress={() => setChoosingCountry(true)} style={styles.selector}>
        <Text style={styles.country}>{supportedCountry.name} ({supportedCountry.callingCode}) ▾</Text>
      </Pressable>
      <View style={styles.numberRow}>
        <Text style={styles.prefix}>+63</Text>
        <TextInput editable={editable} style={styles.input} value={localNumber} onChangeText={(text) => {
          if (!text.trim()) { onChange(""); return; }
          const compact = text.trim().replace(/[\s()-]/g, "");
          // Accept a pasted complete number as well as the national digits.
          if (compact.startsWith("+") || /^639\d{9}$/.test(compact)) onChange(normalizePhoneNumber(text));
          else onChange(`+63${compact.startsWith("0") ? compact.slice(1) : compact}`);
        }} placeholder="9171234567" placeholderTextColor="#94a3b8" keyboardType="phone-pad" autoComplete="tel-national" accessibilityLabel="Mobile number, excluding country code" />
      </View>
      <Text style={styles.hint}>Enter 10 digits starting with 9.</Text>
      <Modal visible={choosingCountry} transparent animationType="fade" onRequestClose={() => setChoosingCountry(false)}>
        <View style={styles.backdrop}>
          <View style={styles.dialog}>
            <Text style={styles.title}>SMS country</Text>
            <Text style={styles.hint}>SMS is currently available for Philippine mobile numbers only.</Text>
            <Pressable accessibilityRole="radio" accessibilityState={{ checked: true }} accessibilityLabel="Philippines, plus 63, selected" onPress={() => setChoosingCountry(false)} style={styles.option}>
              <Text style={styles.country}>Philippines (+63)</Text><Text>Selected</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => setChoosingCountry(false)} style={styles.close}><Text style={styles.country}>Done</Text></Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  selector: { paddingVertical: 10 },
  country: { color: "#334155", fontWeight: "600" },
  numberRow: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: "#cbd5e1", borderRadius: 8, backgroundColor: "white" },
  prefix: { paddingLeft: 12, color: "#334155" },
  input: { flex: 1, minWidth: 0, padding: 12, color: "#0f172a" },
  hint: { color: "#64748b", fontSize: 12, marginTop: 6 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", padding: 24 },
  dialog: { backgroundColor: "white", padding: 20, borderRadius: 14 },
  title: { fontSize: 20, fontWeight: "700", color: "#0f172a" },
  option: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 20 },
  close: { alignSelf: "flex-end", padding: 12 },
});
