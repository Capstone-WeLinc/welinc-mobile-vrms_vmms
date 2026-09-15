import { Image, ImageBackground, Pressable, StyleSheet, Text, View } from "react-native";

interface SplashScreenProps {
  onContinue: () => void;
}

const welincLogo = require("../assets/welinc_logo.jpg");

export function SplashScreen({ onContinue }: SplashScreenProps) {
  return (
    <Pressable accessibilityLabel="Open WeLinc Logistics" accessibilityRole="button" onPress={onContinue} style={styles.touchTarget}>
      <ImageBackground source={welincLogo} resizeMode="cover" style={styles.background} imageStyle={styles.backgroundImage}>
        <View style={styles.overlay} />
        <View style={styles.content}>
          <View style={styles.brandRow}>
            <View style={styles.logoTile}>
              <Image source={welincLogo} style={styles.logo} resizeMode="cover" />
            </View>
          </View>

          <View style={styles.hero}>
            <Text style={styles.heroTitle}>WeLinc Logistics</Text>
            <Text style={styles.heroTitle}>
              <Text style={styles.heroAccent}>Operations</Text> Workspace
            </Text>
            <Text style={styles.heroSubtitle}>
              Centralized platform for managing logistics operations, vehicle monitoring, and maintenance schedules.
            </Text>
          </View>

        </View>
      </ImageBackground>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  touchTarget: { flex: 1 },
  background: { flex: 1, backgroundColor: "#101958" },
  backgroundImage: { opacity: 0.32, transform: [{ scale: 1.25 }] },
  overlay: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(12, 20, 82, 0.82)" },
  content: { flex: 1, paddingHorizontal: 24, paddingTop: 28, paddingBottom: 22 },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 14 },
  logoTile: { width: 44, height: 44, borderRadius: 12, overflow: "hidden", backgroundColor: "#f4c400", borderWidth: 2, borderColor: "#f4c400" },
  logo: { width: "100%", height: "100%", transform: [{ scale: 1.45 }] },
  hero: { flex: 1, justifyContent: "center", alignItems: "center", paddingTop: 12 },
  heroTitle: { color: "#ffffff", fontSize: 28, lineHeight: 33, fontWeight: "800", letterSpacing: -0.5, textAlign: "center" },
  heroAccent: { color: "#f4c400" },
  heroSubtitle: { maxWidth: 290, marginTop: 16, color: "#d4d9ee", fontSize: 14, lineHeight: 21, fontWeight: "500", textAlign: "justify" },
});
