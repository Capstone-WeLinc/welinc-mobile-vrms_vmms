import { StatusBar } from "expo-status-bar";
import * as SQLite from "expo-sqlite";
import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import {
  Animated,
  ActivityIndicator,
  Dimensions,
  Easing,
  Image,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import Svg, { Circle, Path, Rect } from "react-native-svg";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

import { clearDatabase, initializeDatabase } from "./database/database";
import { DATABASE_NAME } from "./database/tables";
import { DashboardScreen } from "./screens/DashboardScreen";
import { MobilePageHeader } from "./components/MobilePageHeader";
import { LoginScreen } from "./screens/LoginScreen";
import { SplashScreen } from "./screens/SplashScreen";
import { PhoneNumberField } from "./screens/PhoneNumberField";
import { NotificationsScreen } from "./screens/NotificationsScreen";
import { useNotifications } from "./services/useNotifications";
import { WorkOrderScreen } from "./screens/WorkOrderScreen";
import {
  API_BASE_URL,
  AuthService,
  getMobileAccessRole,
  type AuthenticatedUser,
} from "./services/AuthService";
import { isValidPhoneNumber, normalizePhoneNumber } from "./services/phoneNumber";
import { SyncService } from "./services/SyncService";

const authService = new AuthService(API_BASE_URL);
const welinc = require("./assets/welinc_logo.jpg");

function NavbarRefreshLine({ visible }: { visible: boolean }) {
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!visible) {
      progress.setValue(0);
      return;
    }
    const animation = Animated.loop(
      Animated.timing(progress, {
        toValue: 1,
        duration: 900,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    animation.start();
    return () => animation.stop();
  }, [progress, visible]);

  if (!visible) return null;
  const translateX = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [-96, Dimensions.get("window").width],
  });
  return (
    <View style={styles.navbarRefreshTrack} pointerEvents="none">
      <Animated.View style={[styles.navbarRefreshSegment, { transform: [{ translateX }] }]} />
    </View>
  );
}

const syncService = new SyncService({
  apiBaseUrl: API_BASE_URL,
  getAccessToken: () => authService.getAccessToken(),
  onUnauthorized: () => authService.clearSession(),
});

function DashboardTabIcon({ active }: { active: boolean }) {
  return (
    <Svg width={30} height={30} viewBox="0 0 64 64" fill="none">
      <Path
        d="M18 12h10v10H18zm18 0h10v10H36zm-18 18h10v10H18zm18 0h10v10H36z"
        stroke={active ? "#ffffff" : "#D4A93F"}
        strokeWidth={4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function WorkOrderTabIcon({ active }: { active: boolean }) {
  const source = active
    ? require("./assets/work-order-icon2.png")
    : require("./assets/work-order-icon.png");

  return (
    <Image
      source={source}
      style={{
        width: 36,
        height: 36,
        resizeMode: "contain",
        opacity: active ? 1 : 0.95,
        backgroundColor: "transparent",
      }}
    />
  );
}

function NotificationTabIcon({ active, count = 0 }: { active: boolean; count?: number }) {
  return (
    <View>
    <Svg width={26} height={26} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 4.5a4.5 4.5 0 0 1 4.5 4.5v2.1c0 .8.3 1.5.8 2.2l1.2 1.5c.6.7.1 1.7-.8 1.7H6.3c-.9 0-1.4-1-.8-1.7l1.2-1.5c.5-.7.8-1.4.8-2.2V9A4.5 4.5 0 0 1 12 4.5Z"
        stroke={active ? "#ffffff" : "#D4A93F"}
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
      <Path
        d="M10 18a2 2 0 0 0 4 0"
        stroke={active ? "#ffffff" : "#D4A93F"}
        strokeWidth={1.8}
        strokeLinecap="round"
      />
    </Svg>
    {count > 0 ? <Text accessibilityLabel={`${count} unread notifications`} style={{ position: "absolute", top: -9, right: -15, backgroundColor: "#a32121", color: "white", borderRadius: 10, paddingHorizontal: 5, fontSize: 11 }}>{count > 99 ? "99+" : count}</Text> : null}
    </View>
  );
}

function ProfileTabIcon({ active }: { active: boolean }) {
  const source = active ? require("./assets/profile2.png") : require("./assets/profile.png");

  return (
    <Image
      source={source}
      style={{
        width: 36,
        height: 36,
        resizeMode: "contain",
        opacity: active ? 1 : 0.95,
        backgroundColor: "transparent",
      }}
    />
  );
}

function FieldLabel({ children, required = false }: { children: string; required?: boolean }) {
  return (
    <Text style={styles.fieldLabel}>
      {children}
      {required ? <Text style={styles.requiredMark}> *</Text> : null}
    </Text>
  );
}

function ConfirmationDialog({
  visible,
  title,
  message,
  confirmLabel,
  variant,
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  variant: "primary" | "danger";
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
    >
      <View style={styles.confirmationBackdrop}>
        <View style={styles.confirmationDialog}>
          <Text style={styles.confirmationTitle}>{title}</Text>
          <View style={styles.confirmationDivider} />
          <Text style={styles.confirmationMessage}>{message}</Text>

          <View style={styles.confirmationActions}>
            <TouchableOpacity
              style={[
                styles.confirmationButton,
                variant === "danger"
                  ? styles.confirmationDangerButton
                  : styles.confirmationPrimaryButton,
              ]}
              onPress={onConfirm}
            >
              <Text style={styles.confirmationPrimaryText}>{confirmLabel}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.confirmationButton, styles.confirmationSecondaryButton]}
              onPress={onCancel}
            >
              <Text style={styles.confirmationSecondaryText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

export default function App() {
  const [startupStatus, setStartupStatus] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const [startupError, setStartupError] = useState<string | null>(null);
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const inbox = useNotifications(user?.id);
  const [notificationOrderId, setNotificationOrderId] = useState<string | null>(null);
  const [profileForm, setProfileForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    contact: "",
  });
  const [profileMessage, setProfileMessage] = useState<string | null>(null);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileEditing, setProfileEditing] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [confirmation, setConfirmation] = useState<"logout" | null>(null);
  const [passwordForm, setPasswordForm] = useState({
    current: "",
    next: "",
    confirm: "",
  });
  const [showSplash, setShowSplash] = useState(true);
  const [isPageRefreshing, setIsPageRefreshing] = useState(false);
  const [profileRefreshing, setProfileRefreshing] = useState(false);
  const [profilePullRefreshing, setProfilePullRefreshing] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeScreen, setActiveScreen] = useState<
    "dashboard" | "work-orders" | "notifications" | "profile"
  >("dashboard");
  const [navigationReloadKey, setNavigationReloadKey] = useState(0);
  const hasPasswordInput = Object.values(passwordForm).some((value) => value.length > 0);
  const passwordFormComplete = Boolean(
    passwordForm.current && passwordForm.next && passwordForm.confirm &&
      passwordForm.next === passwordForm.confirm,
  );

  useEffect(() => {
    if (!user) return;

    const nameParts = user.name.trim().split(/\s+/);
    setProfileForm({
      firstName: nameParts[0] ?? "",
      lastName: nameParts.slice(1).join(" "),
      email: user.email,
      contact: user.contact ?? "",
    });
  }, [user]);

  useEffect(() => {
    let mounted = true;
    Promise.all([initializeDatabase(), authService.restoreSession()])
      .then(async ([, restoredUser]) => {
        if (!mounted) return;

        if (restoredUser) {
          try {
            await syncService.forceRefreshFromBackend();
          } catch (error) {
            console.warn("[App] Forced backend refresh failed", error);
          }
        }

        setUser(restoredUser);
        if (restoredUser) {
          const nameParts = restoredUser.name.trim().split(/\s+/);
          setProfileForm({
            firstName: nameParts[0] ?? "",
            lastName: nameParts.slice(1).join(" "),
            email: restoredUser.email,
            contact: restoredUser.contact ?? "",
          });
        }
        setStartupStatus("ready");
      })
      .catch((error) => {
        console.error("[App] Startup failed", error);
        if (mounted) {
          setStartupStatus("error");
          setStartupError(
            error instanceof Error ? error.message : String(error),
          );
        }
      });
    return () => {
      mounted = false;
      syncService.stopAutoSync();
    };
  }, []);

  const logout = async () => {
    syncService.stopAutoSync();
    try {
      await authService.recordLogout();
      await authService.clearSession();
      // Prevent one account from seeing another account's cached data.
      await clearDatabase();
    } finally {
      setUser(null);
      setActiveScreen("dashboard");
    }
  };

  const confirmLogout = () => {
    setConfirmation("logout");
  };

  const closeConfirmation = () => {
    setConfirmation(null);
  };

  const saveProfile = async () => {
    if (!user || profileSaving) return;

    const name = `${profileForm.firstName.trim()} ${profileForm.lastName.trim()}`.trim();
    if (
      !profileForm.firstName.trim() ||
      !profileForm.lastName.trim() ||
      !profileForm.email.trim()
    ) {
      setProfileMessage("Complete all required personal details.");
      return;
    }

    if (profileForm.contact.trim() && !isValidPhoneNumber(profileForm.contact)) {
      setProfileMessage("Enter a Philippine mobile number: +639171234567 or 09171234567.");
      return;
    }

    setProfileSaving(true);
    setProfileMessage(null);
    try {
      const updatedUser = await authService.updateOwnProfile({
        name,
        email: profileForm.email.trim(),
        contact: normalizePhoneNumber(profileForm.contact) || null,
      });
      setUser(updatedUser);
      setProfileForm({
        firstName: updatedUser.name.trim().split(/\s+/)[0] ?? "",
        lastName: updatedUser.name.trim().split(/\s+/).slice(1).join(" "),
        email: updatedUser.email,
        contact: updatedUser.contact ?? "",
      });
      setProfileMessage("Personal details saved.");
      setProfileEditing(false);
      setTimeout(() => setProfileMessage(null), 2500);
    } catch (error) {
      setProfileMessage(
        error instanceof Error ? error.message : "Unable to save personal details.",
      );
    } finally {
      setProfileSaving(false);
    }
  };

  const validatePasswordForm = async () => {
    if (!passwordForm.current || !passwordForm.next || !passwordForm.confirm) {
      setPasswordMessage("Complete all required password fields.");
      return;
    }
    if (passwordForm.next !== passwordForm.confirm) {
      setPasswordMessage("New password and confirmation must match.");
      return;
    }
    if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/.test(passwordForm.next)) {
      setPasswordMessage("Password must be at least 8 characters and include uppercase, lowercase, number, and special character.");
      return;
    }
    if (passwordSaving || !user) return;

    setPasswordSaving(true);
    setPasswordMessage(null);
    try {
      await authService.changeOwnPassword({
        currentPassword: passwordForm.current,
        newPassword: passwordForm.next,
        confirmPassword: passwordForm.confirm,
      });
      const updatedUser = await authService.login(user.email, passwordForm.next);
      setUser(updatedUser);
      setPasswordForm({ current: "", next: "", confirm: "" });
      setPasswordMessage("Password updated successfully.");
    } catch (error) {
      setPasswordMessage(error instanceof Error ? error.message : "Unable to update password.");
    } finally {
      setPasswordSaving(false);
    }
  };

  const refreshProfile = async (fromPullToRefresh = false) => {
    if (profileRefreshing) return;
    setProfileRefreshing(true);
    if (fromPullToRefresh) setProfilePullRefreshing(true);
    setIsPageRefreshing(true);
    try {
      const refreshedUser = await authService.restoreSession();
      if (!refreshedUser) {
        throw new Error("Your session could not be restored. Please sign in again.");
      }
      setUser(refreshedUser);
      setProfileMessage(null);
    } catch (error) {
      setProfileMessage(error instanceof Error ? error.message : "Unable to refresh your profile.");
    } finally {
      setProfileRefreshing(false);
      setProfilePullRefreshing(false);
      setIsPageRefreshing(false);
    }
  };

  const navigateTo = (
    screen: "dashboard" | "work-orders" | "notifications" | "profile",
  ) => {
    setNotificationOrderId(null);
    setActiveScreen(screen);
    setNavigationReloadKey((key) => key + 1);
    if (screen === "notifications") void inbox.refresh();
    if (screen === "profile") void refreshProfile();
  };

  const globalSearchItems = [
    { title: "Truck 204 - PM Check", category: "Vehicles" },
    { title: "Hydraulic leak inspection", category: "Tasks" },
    { title: "Oil change reminder", category: "Notifications" },
    { title: "Maintenance record - Engine 12", category: "Maintenance" },
    { title: "Juan dela Cruz", category: "Employees" },
    { title: "Crane inspection report", category: "Records" },
    { title: "Inspection overdue", category: "Alerts" },
  ];

  const filteredSearchResults = searchQuery.trim()
    ? globalSearchItems.filter((item) => {
        const query = searchQuery.toLowerCase();
        return (
          item.title.toLowerCase().includes(query) ||
          item.category.toLowerCase().includes(query)
        );
      })
    : globalSearchItems;

  const renderContent = () => {
    if (startupStatus === "loading") {
      return (
        <View style={styles.centered}>
          <ActivityIndicator size="large" />
          <Text style={styles.message}>Preparing offline storage…</Text>
        </View>
      );
    }

    if (startupStatus === "error") {
      return (
        <View style={styles.centered}>
          <Text style={styles.error}>
            Unable to initialize offline storage.
          </Text>
          {startupError ? (
            <Text style={styles.errorDetails}>{startupError}</Text>
          ) : null}
        </View>
      );
    }

    if (showSplash) {
      return <SplashScreen onContinue={() => setShowSplash(false)} />;
    }

    if (!user) {
      return (
        <LoginScreen
          authService={authService}
          onAuthenticated={setUser}
          onBack={() => setShowSplash(true)}
        />
      );
    }

    const accessRole = getMobileAccessRole(user.roles);
    if (accessRole === "none") {
      return (
        <View style={styles.centered}>
          <Text style={styles.error}>
            Only mechanics and chief mechanics can use this mobile version.
          </Text>
          <TouchableOpacity
            style={styles.logoutButton}
            onPress={() => void logout()}
          />
        </View>
      );
    }

    const tabItems: Array<{
      key: "dashboard" | "work-orders" | "notifications" | "profile";
      Icon: (props: { active: boolean }) => ReactElement;
    }> = [
      { key: "dashboard", Icon: DashboardTabIcon },
      { key: "work-orders", Icon: WorkOrderTabIcon },
      { key: "notifications", Icon: ({ active }: { active: boolean }) => <NotificationTabIcon active={active} count={inbox.unreadCount} /> },
      { key: "profile", Icon: ProfileTabIcon },
    ];

    return (
      <View style={styles.shell}>
        <View style={styles.header}>
          <View style={styles.headerTitleBlock}>
            <Image source={welinc} style={styles.logo} resizeMode="contain" />
            <View style={styles.headerTextBlock}>
              <Text style={styles.title}>VMMS</Text>
              <Text style={styles.userName}>
                {user.name} •{" "}
                {accessRole === "chiefMechanic" ? "Chief Mechanic" : "Mechanic"}
              </Text>
            </View>
          </View>

          <TouchableOpacity
            accessibilityRole="button"
            onPress={() => setIsSearchOpen(true)}
            style={styles.searchButton}
          >
            <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
              <Circle cx="11" cy="11" r="5.5" stroke="#D4A93F" strokeWidth={2} />
              <Path d="M16 16L21 21" stroke="#D4A93F" strokeWidth={2} strokeLinecap="round" />
            </Svg>
          </TouchableOpacity>
        </View>

        {isSearchOpen ? (
          <View style={styles.searchOverlay}>
            <View style={styles.searchSheet}>
              <View style={styles.searchHeaderRow}>
                <Text style={styles.searchTitle}>Global Search</Text>
                <TouchableOpacity onPress={() => setIsSearchOpen(false)}>
                  <Text style={styles.searchClose}>Close</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.searchInputWrap}>
                <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" style={styles.searchInputIcon}>
                  <Circle cx="11" cy="11" r="5.5" stroke="#D4A93F" strokeWidth={2} />
                  <Path d="M16 16L21 21" stroke="#D4A93F" strokeWidth={2} strokeLinecap="round" />
                </Svg>
                <TextInput
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  placeholder="Search vehicles, tasks, notifications..."
                  placeholderTextColor="#94a3b8"
                  style={styles.searchInput}
                  autoFocus
                />
              </View>

              <ScrollView style={styles.searchResults} showsVerticalScrollIndicator={false}>
                {filteredSearchResults.length > 0 ? (
                  filteredSearchResults.map((item, index) => (
                    <View key={`${item.title}-${index}`} style={styles.searchResultItem}>
                      <Text style={styles.searchResultTitle}>{item.title}</Text>
                      <Text style={styles.searchResultCategory}>{item.category}</Text>
                    </View>
                  ))
                ) : (
                  <Text style={styles.searchEmpty}>No results found.</Text>
                )}
              </ScrollView>
            </View>
          </View>
        ) : null}

        <ConfirmationDialog
          visible={confirmation !== null}
          title="Confirm sign out"
          message="Are you sure you want to sign out of your account?"
          confirmLabel="Sign out"
          variant="danger"
          onConfirm={() => {
            closeConfirmation();
            void logout();
          }}
          onCancel={closeConfirmation}
        />

        <View style={styles.tabBar}>
          {tabItems.map((item) => {
            const isActive = activeScreen === item.key;
            const Icon = item.Icon;

            return (
              <TouchableOpacity
                key={item.key}
                accessibilityRole="button"
                activeOpacity={0.8}
                style={[
                  styles.tabButton,
                  isActive && styles.tabButtonActive,
                  item.key === "dashboard" && styles.tabButtonWide,
                ]}
                onPress={() => navigateTo(item.key)}
              >
                <Icon active={isActive} />
              </TouchableOpacity>
            );
          })}
        </View>
        <NavbarRefreshLine visible={isPageRefreshing} />

        {activeScreen === "dashboard" ? (
          <DashboardScreen
            key={navigationReloadKey}
            user={user}
            syncService={syncService}
            onLogout={logout}
            onLoadingChange={setIsPageRefreshing}
          />
        ) : activeScreen === "work-orders" ? (
          <WorkOrderScreen key={navigationReloadKey} accessRole={accessRole} user={user} initialOrderId={notificationOrderId} syncService={syncService} onLoadingChange={setIsPageRefreshing} />
        ) : activeScreen === "notifications" ? (
          <NotificationsScreen key={navigationReloadKey} notifications={inbox.notifications} loading={inbox.loading} error={inbox.error} onRefresh={() => inbox.refresh()} onLoadingChange={setIsPageRefreshing} onOpen={(notification) => {
            void inbox.markRead(notification.id);
            setNotificationOrderId(notification.scheduleId);
            setActiveScreen("work-orders");
          }} />
        ) : (
          <ScrollView
            key={navigationReloadKey}
            style={styles.profileScroll}
            contentContainerStyle={styles.profileContent}
            refreshControl={
              <RefreshControl
                refreshing={profilePullRefreshing}
                onRefresh={() => void refreshProfile(true)}
                colors={["#1a1f6e", "#d4a93f"]}
                tintColor="#1a1f6e"
                progressBackgroundColor="#ffffff"
              />
            }
          >
            <MobilePageHeader title="Profile" subtitle="Manage your account information and security" />
            <View style={styles.profileTopCard}>
              <View style={styles.profileHeaderRow}>
                <View style={styles.profileAvatar}>
                  <Text style={styles.profileAvatarText}>
                    {user.name
                      .split(" ")
                      .map((part) => part[0])
                      .slice(0, 2)
                      .join("")
                      .toUpperCase() || "VM"}
                  </Text>
                </View>

                <View style={styles.profileIdentity}>
                  <Text style={styles.profileName}>{user.name}</Text>
                  <Text style={styles.profileRole}>
                    {accessRole === "chiefMechanic" ? "Chief Mechanic" : "Mechanic"}
                  </Text>
                </View>
              </View>

              <View style={styles.profileInfoList}>
                <View style={styles.profileInfoRow}>
                  <Text style={styles.profileInfoLabel}>Email</Text>
                  <Text style={styles.profileInfoValue}>{user.email}</Text>
                </View>
                <View style={styles.profileInfoRow}>
                  <Text style={styles.profileInfoLabel}>Phone</Text>
                  <Text style={styles.profileInfoValue}>
                    {user.contact ? user.contact : "No phone on record"}
                  </Text>
                </View>
              </View>
            </View>

            <View style={styles.settingsCard}>
              <Text style={styles.cardTitle}>Personal details</Text>

              <View style={styles.formGrid}>
                <View style={styles.formFieldHalf}>
                  <FieldLabel required>First name</FieldLabel>
                  <TextInput
                    style={styles.textInput}
                    editable={profileEditing}
                    value={profileForm.firstName}
                    onChangeText={(firstName) => {
                      setProfileForm((current) => ({ ...current, firstName }));
                      setProfileMessage(null);
                    }}
                    autoCapitalize="words"
                  />
                </View>

                <View style={styles.formFieldHalf}>
                  <FieldLabel required>Last name</FieldLabel>
                  <TextInput
                    style={styles.textInput}
                    editable={profileEditing}
                    value={profileForm.lastName}
                    onChangeText={(lastName) => {
                      setProfileForm((current) => ({ ...current, lastName }));
                      setProfileMessage(null);
                    }}
                    autoCapitalize="words"
                  />
                </View>
              </View>

              <View style={styles.formGrid}>
                <View style={styles.formFieldHalf}>
                  <FieldLabel required>Email</FieldLabel>
                  <TextInput
                    style={styles.textInput}
                    editable={profileEditing}
                    value={profileForm.email}
                    onChangeText={(email) => {
                      setProfileForm((current) => ({ ...current, email }));
                      setProfileMessage(null);
                    }}
                    autoCapitalize="none"
                    keyboardType="email-address"
                  />
                </View>

                <View style={styles.formFieldHalf}>
                  <FieldLabel>Mobile number</FieldLabel>
                  <PhoneNumberField editable={profileEditing} value={profileForm.contact} onChange={(contact) => {
                    setProfileForm((current) => ({ ...current, contact }));
                    setProfileMessage(null);
                  }} />
                </View>
              </View>

              {profileMessage ? (
                <Text
                  style={
                    profileMessage === "Personal details saved."
                      ? styles.profileSuccess
                      : styles.profileError
                  }
                >
                  {profileMessage}
                </Text>
              ) : null}

              {profileEditing ? (
                <View style={styles.actionRowRight}>
                  <TouchableOpacity
                    style={styles.cancelButton}
                    onPress={() => {
                      const nameParts = user.name.trim().split(/\s+/);
                      setProfileForm({
                        firstName: nameParts[0] ?? "",
                        lastName: nameParts.slice(1).join(" "),
                        email: user.email,
                        contact: user.contact ?? "",
                      });
                      setProfileMessage(null);
                      setProfileEditing(false);
                    }}
                    disabled={profileSaving}
                  >
                    <Text style={styles.cancelButtonText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.primaryButton, profileSaving && styles.disabledButton]}
                    onPress={() => void saveProfile()}
                    disabled={profileSaving}
                  >
                    <Text style={styles.primaryButtonText}>
                      {profileSaving ? "Saving..." : "Save changes"}
                    </Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={styles.actionRowRight}>
                  <TouchableOpacity
                    style={styles.primaryButton}
                    onPress={() => {
                      setProfileMessage(null);
                      setProfileEditing(true);
                    }}
                  >
                    <Text style={styles.primaryButtonText}>Edit</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>

            <View style={styles.settingsCard}>
              <Text style={styles.cardTitle}>Password & security</Text>

              <FieldLabel required>Current password</FieldLabel>
              <TextInput
                style={styles.textInput}
                value={passwordForm.current}
                onChangeText={(current) => {
                  setPasswordForm((form) => ({ ...form, current }));
                  setPasswordMessage(null);
                }}
                placeholder="Enter current password"
                placeholderTextColor="#94a3b8"
                secureTextEntry
              />

              <View style={styles.formGrid}>
                <View style={styles.formFieldHalf}>
                  <FieldLabel required>New password</FieldLabel>
                  <TextInput
                    style={styles.textInput}
                    value={passwordForm.next}
                    onChangeText={(next) => {
                      setPasswordForm((form) => ({ ...form, next }));
                      setPasswordMessage(null);
                    }}
                    placeholder="New password"
                    placeholderTextColor="#94a3b8"
                    secureTextEntry
                  />
                </View>

                <View style={styles.formFieldHalf}>
                  <FieldLabel required>Confirm new password</FieldLabel>
                  <TextInput
                    style={styles.textInput}
                    value={passwordForm.confirm}
                    onChangeText={(confirm) => {
                      setPasswordForm((form) => ({ ...form, confirm }));
                      setPasswordMessage(null);
                    }}
                    placeholder="Confirm"
                    placeholderTextColor="#94a3b8"
                    secureTextEntry
                  />
                </View>
              </View>

              {passwordMessage ? (
                <Text
                  style={
                    passwordMessage === "Password updated successfully."
                      ? styles.profileSuccess
                      : styles.profileError
                  }
                >
                  {passwordMessage}
                </Text>
              ) : null}

              {hasPasswordInput ? (
                <View style={styles.actionRowRight}>
                  <TouchableOpacity
                    style={styles.cancelButton}
                    onPress={() => {
                      setPasswordForm({ current: "", next: "", confirm: "" });
                      setPasswordMessage(null);
                    }}
                    disabled={passwordSaving}
                  >
                    <Text style={styles.cancelButtonText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.primaryButton, (!passwordFormComplete || passwordSaving) && styles.disabledButton]}
                    onPress={() => void validatePasswordForm()}
                    disabled={!passwordFormComplete || passwordSaving}
                  >
                    <Text style={styles.primaryButtonText}>{passwordSaving ? "Updating..." : "Update"}</Text>
                  </TouchableOpacity>
                </View>
              ) : null}
            </View>

            <TouchableOpacity
              style={styles.logoutButton}
              onPress={confirmLogout}
              activeOpacity={0.9}
            >
              <Text style={styles.logoutButtonText}>Log out</Text>
            </TouchableOpacity>
          </ScrollView>
        )}
      </View>
    );
  };

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safeArea}>{renderContent()}</SafeAreaView>
      <StatusBar style="auto" />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#f1f5f9" },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    backgroundColor: "#f1f5f9",
  },
  message: { marginTop: 12, color: "#64748b" },
  error: { color: "#ef4444", textAlign: "center" },
  errorDetails: { marginTop: 8, color: "#9b1c1c", textAlign: "center" },
  shell: { flex: 1, backgroundColor: "#f1f5f9" },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 12,
    backgroundColor: "#ffffff",
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
  },
  headerTitleBlock: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flex: 1,
  },
  logo: { width: 32, height: 32 },
  headerTextBlock: { flex: 1 },
  title: { fontSize: 24, fontWeight: "800", color: "#1a1f6e" },
  userName: { fontSize: 13, color: "#64748b", marginTop: 2 },
  searchButton: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#dbeafe",
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 8,
  },
  searchOverlay: {
    position: "absolute",
    top: 76,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(15, 23, 42, 0.2)",
    justifyContent: "flex-start",
    alignItems: "center",
    paddingTop: 12,
    zIndex: 20,
  },
  searchSheet: {
    width: "92%",
    maxWidth: 420,
    backgroundColor: "#ffffff",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    shadowColor: "#0f172a",
    shadowOpacity: 0.1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 5,
  },
  searchHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  searchTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: "#1a1f6e",
  },
  searchClose: {
    color: "#1a1f6e",
    fontWeight: "700",
  },
  searchInputWrap: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#dbeafe",
    borderRadius: 12,
    backgroundColor: "#f8fafc",
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
  },
  searchInputIcon: { marginRight: 8 },
  searchInput: {
    flex: 1,
    color: "#0f172a",
    fontSize: 14,
    paddingVertical: 0,
  },
  searchResults: {
    maxHeight: 260,
  },
  searchResultItem: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
  },
  searchResultTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: "#1e293b",
  },
  searchResultCategory: {
    fontSize: 12,
    color: "#64748b",
    marginTop: 2,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  searchEmpty: {
    color: "#64748b",
    paddingVertical: 12,
    textAlign: "center",
  },
  confirmationBackdrop: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    backgroundColor: "rgba(0, 0, 0, 0.45)",
  },
  confirmationDialog: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: "#ffffff",
    borderRadius: 12,
    padding: 24,
    shadowColor: "#0f172a",
    shadowOpacity: 0.28,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 12 },
    elevation: 10,
  },
  confirmationTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: "#141827",
    textTransform: "uppercase",
    letterSpacing: 0.7,
  },
  confirmationDivider: {
    height: 1,
    backgroundColor: "#dde3eb",
    marginVertical: 16,
  },
  confirmationMessage: {
    color: "#141827",
    fontSize: 16,
    lineHeight: 24,
    textAlign: "center",
  },
  confirmationPasswordInput: {
    height: 48,
    marginTop: 20,
    borderWidth: 2,
    borderColor: "#9a8f8f",
    borderRadius: 12,
    paddingHorizontal: 16,
    color: "#141827",
    fontSize: 14,
    backgroundColor: "#ffffff",
  },
  confirmationActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    marginTop: 24,
  },
  confirmationButton: {
    minHeight: 44,
    flexGrow: 1,
    flexBasis: 120,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    paddingHorizontal: 16,
  },
  confirmationPrimaryButton: {
    backgroundColor: "#070b45",
  },
  confirmationDangerButton: {
    backgroundColor: "#b50000",
  },
  confirmationSecondaryButton: {
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#c8ced8",
  },
  confirmationPrimaryText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "800",
  },
  confirmationSecondaryText: {
    color: "#141827",
    fontSize: 15,
    fontWeight: "700",
  },
  profileScroll: {
    flex: 1,
    backgroundColor: "#f1f5f9",
  },
  profileContent: {
    padding: 12,
    paddingBottom: 24,
  },
  profileTopCard: {
    backgroundColor: "#ffffff",
    borderRadius: 8,
    padding: 16,
    marginTop: 12,
    marginBottom: 12,
    shadowColor: "#0f172a",
    shadowOpacity: 0.04,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  profileHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  profileIdentity: {
    flex: 1,
  },
  profileAvatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "#1a1f6e",
    alignItems: "center",
    justifyContent: "center",
  },
  profileAvatarText: {
    fontSize: 22,
    fontWeight: "800",
    color: "#ffffff",
  },
  profileName: {
    fontSize: 22,
    fontWeight: "800",
    color: "#0f172a",
  },
  profileRole: {
    color: "#1a1f6e",
    fontSize: 13,
    fontWeight: "700",
    marginTop: 4,
  },
  profileInfoList: {
    marginTop: 14,
    borderTopWidth: 1,
    borderTopColor: "#e2e8f0",
    paddingTop: 14,
  },
  profileInfoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 6,
  },
  profileInfoLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "#64748b",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  profileInfoValue: {
    fontSize: 14,
    fontWeight: "600",
    color: "#475569",
    maxWidth: "65%",
    textAlign: "right",
  },
  settingsCard: {
    backgroundColor: "#ffffff",
    borderRadius: 8,
    padding: 16,
    marginBottom: 12,
    shadowColor: "#0f172a",
    shadowOpacity: 0.04,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: "800",
    color: "#0f172a",
    marginBottom: 14,
  },
  formGrid: {
    flexDirection: "column",
    gap: 0,
    marginBottom: 0,
  },
  formFieldHalf: {
    width: "100%",
    marginBottom: 12,
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "#64748b",
    letterSpacing: 0.8,
    marginBottom: 6,
    textTransform: "uppercase",
  },
  requiredMark: {
    color: "#dc2626",
    fontSize: 14,
    fontWeight: "800",
  },
  textInput: {
    backgroundColor: "#f8fafc",
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#ccd0d5",
    minHeight: 48,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: "#0f172a",
    fontSize: 16,
  },
  profileSuccess: {
    color: "#15803d",
    fontSize: 14,
    fontWeight: "700",
    marginTop: 2,
  },
  profileError: {
    color: "#b91c1c",
    fontSize: 14,
    fontWeight: "700",
    marginTop: 2,
  },
  disabledButton: {
    opacity: 0.6,
  },
  actionRowRight: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 12,
    marginTop: 4,
  },
  cancelButton: {
    flex: 1,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
    borderRadius: 6,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#dbeafe",
  },
  cancelButtonText: {
    color: "#1a1f6e",
    fontWeight: "700",
    fontSize: 15,
  },
  primaryButton: {
    flex: 1,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1a1f6e",
    borderRadius: 6,
    paddingHorizontal: 12,
  },
  primaryButtonDark: {
    flex: 1,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1a1f6e",
    borderRadius: 6,
    paddingHorizontal: 12,
  },
  primaryButtonText: {
    color: "#ffffff",
    fontWeight: "800",
    fontSize: 15,
  },
  logoutButton: {
    backgroundColor: "#d62828",
    minHeight: 48,
    borderRadius: 6,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: "center",
    marginBottom: 12,
    shadowColor: "#d62828",
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  logoutButtonText: { color: "#ffffff", fontWeight: "800", fontSize: 15 },
  tabBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginHorizontal: 0,
    marginTop: 0,
    marginBottom: 0,
    backgroundColor: "#ffffff",
    borderTopWidth: 1,
    borderTopColor: "#e2e8f0",
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
    paddingHorizontal: 8,
    paddingVertical: 8,
    shadowColor: "#0f172a",
    shadowOpacity: 0.06,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: -1 },
    elevation: 2,
  },
  navbarRefreshTrack: {
    height: 3,
    overflow: "hidden",
    backgroundColor: "rgba(212, 169, 63, 0.18)",
  },
  navbarRefreshSegment: {
    width: 96,
    height: 3,
    borderRadius: 2,
    backgroundColor: "#d4a93f",
  },
  tabButton: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    borderRadius: 10,
    marginHorizontal: 4,
    minHeight: 52,
  },
  tabButtonWide: {
    flex: 1.1,
  },
  tabButtonActive: {
    backgroundColor: "#1a1f6e",
    shadowColor: "#1a1f6e",
    shadowOpacity: 0.16,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  tabButtonText: { fontSize: 14, fontWeight: "700", color: "#64748b" },
  tabButtonTextActive: { color: "#ffffff" },
  tabIcon: {
    fontSize: 22,
    lineHeight: 22,
    color: "#475569",
  },
  tabIconActive: {
    color: "#ffffff",
  },
  notificationScreen: {
    flex: 1,
    backgroundColor: "#f8fafc",
    padding: 20,
    justifyContent: "center",
  },
  notificationTitle: {
    fontSize: 28,
    fontWeight: "800",
    color: "#1a1f6e",
    marginBottom: 8,
  },
  notificationText: {
    fontSize: 16,
    color: "#475569",
  },
});
