import { useState } from "react";
import { StyleSheet, Text, TextInput, View, type TextInputProps } from "react-native";
import { SubscriptionCard } from "../components/SubscriptionCard";
import { Button, Card, ErrorNote, Heading, Loading, Muted, Screen } from "../components/ui";
import { errorMessage } from "../lib/api";
import { API_URL } from "../lib/config";
import { useAuth } from "../state/auth";
import { usePlayer } from "../state/player";
import { colors, radius, space } from "../theme";

export function AccountScreen() {
  const { me, loading, connectionError } = useAuth();
  if (loading) return <Loading />;
  return (
    <Screen>
      {connectionError ? <ErrorNote message={connectionError} /> : null}
      {me ? <SignedIn /> : <SignInForms />}
      <Muted small style={styles.server}>
        Server: {API_URL}
      </Muted>
    </Screen>
  );
}

function SignedIn() {
  const { me, logout } = useAuth();
  const player = usePlayer();
  const [busy, setBusy] = useState(false);
  if (!me) return null;
  const { user } = me;

  return (
    <View style={{ gap: space.lg }}>
      <View style={styles.profile}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{user.displayName.slice(0, 1).toUpperCase()}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.name}>{user.displayName}</Text>
          <Muted>{user.email}</Muted>
        </View>
      </View>
      <SubscriptionCard />
      {me.artists.length ? (
        <Card style={{ gap: space.sm }}>
          <Heading style={{ marginBottom: 0 }}>Your artist profiles</Heading>
          <Muted>{me.artists.map((a) => a.name).join(", ")}</Muted>
          <Muted small>Upload music and see your earnings in Studio on the Trusic website.</Muted>
        </Card>
      ) : null}
      <Button
        title={busy ? "Logging out…" : "Log out"}
        variant="ghost"
        disabled={busy}
        onPress={() => {
          setBusy(true);
          // Stop first, so the last listen is reported while still signed in.
          void player
            .stop()
            .then(logout)
            .finally(() => setBusy(false));
        }}
      />
    </View>
  );
}

function SignInForms() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const registering = mode === "register";

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (registering) await register(email, password, displayName);
      else await login(email, password);
    } catch (e) {
      setError(errorMessage(e, registering ? "Couldn't create your account." : "Couldn't log in."));
    } finally {
      setBusy(false);
    }
  };

  const canSubmit = email.trim() && password && (!registering || (displayName.trim() && password.length >= 8));

  return (
    <Card style={{ gap: space.md }}>
      <Heading style={{ marginBottom: 0 }}>{registering ? "Join Trusic" : "Log in"}</Heading>
      {registering ? (
        <Muted>Subscribe to pay the artists you love, or upload your own music from the website.</Muted>
      ) : null}
      {error ? <ErrorNote message={error} /> : null}
      {registering ? (
        <Field label="Your name" value={displayName} onChangeText={setDisplayName} maxLength={60} />
      ) : null}
      <Field
        label="Email"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
        textContentType="emailAddress"
      />
      <Field
        label="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoCapitalize="none"
        autoComplete={registering ? "new-password" : "current-password"}
        textContentType={registering ? "newPassword" : "password"}
        onSubmitEditing={() => canSubmit && void submit()}
        hint={registering ? "At least 8 characters." : undefined}
      />
      <Button
        title={busy ? (registering ? "Creating account…" : "Logging in…") : registering ? "Create account" : "Log in"}
        onPress={() => void submit()}
        disabled={busy || !canSubmit}
      />
      <Button
        title={registering ? "I already have an account" : "Create an account"}
        variant="ghost"
        onPress={() => {
          setMode(registering ? "login" : "register");
          setError(null);
        }}
      />
    </Card>
  );
}

function Field({ label, hint, ...props }: TextInputProps & { label: string; hint?: string }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        {...props}
        accessibilityLabel={label}
        placeholderTextColor={colors.muted}
        style={styles.input}
        autoCorrect={false}
      />
      {hint ? <Muted small>{hint}</Muted> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  profile: { flexDirection: "row", alignItems: "center", gap: space.md },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: colors.primaryInk, fontSize: 24, fontWeight: "800" },
  name: { color: colors.text, fontSize: 22, fontWeight: "800" },
  label: { color: colors.text, fontSize: 14, fontWeight: "600" },
  input: {
    backgroundColor: colors.raised,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.sm,
    color: colors.text,
    paddingHorizontal: space.md,
    paddingVertical: 11,
    fontSize: 16,
  },
  server: { marginTop: space.xl, textAlign: "center" },
});
