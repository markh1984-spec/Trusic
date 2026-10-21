import {
  REPORT_REASON_NAMES,
  REPORT_TARGET_NAMES,
  type ReportReason,
  type ReportReceipt,
  type ReportTarget,
  type ReportTargetType,
} from "@trusic/client";
import { Stack, useRouter } from "expo-router";
import { useState } from "react";
import { Linking, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from "react-native";
import { Artwork } from "../components/Artwork";
import { Icon } from "../components/Icon";
import { Body, Button, Card, ErrorNote, ErrorScreen, Heading, Loading, Muted, Note, Screen } from "../components/ui";
import { api, errorMessage } from "../lib/api";
import { useAsync } from "../lib/hooks";
import { phoneReportReasons, REASON_HINTS, reportProblem, websiteReportPath } from "../lib/report";
import { siteAddress } from "../lib/share-sheet";
import { useAuth } from "../state/auth";
import { useToast } from "../state/toast";
import { colors, radius, space } from "../theme";

const TARGET_TYPES: ReportTargetType[] = ["track", "release", "artist", "playlist"];

/**
 * "Report…" from a ⋯ sheet. Anyone can report, signed in or not. Copyright notices need the claimant's details
 * and two signed statements, so they're sent from the website's form; the rest are sent from here.
 */
export function ReportScreen({ type, id }: { type: string; id: string }) {
  if (!TARGET_TYPES.includes(type as ReportTargetType)) return <ErrorScreen message="That can't be reported." />;
  return <ReportForm type={type as ReportTargetType} id={id} />;
}

function ReportForm({ type, id }: { type: ReportTargetType; id: string }) {
  const { me } = useAuth();
  const target = useAsync(() => api.reportTarget(type, id), [type, id]);
  const [receipt, setReceipt] = useState<{ receipt: ReportReceipt; email: string } | null>(null);

  if (target.error) return <ErrorScreen message={target.error} />;
  if (!target.data) return <Loading />;
  const t = target.data;
  const noun = REPORT_TARGET_NAMES[t.type].toLowerCase();

  return (
    <Screen>
      <Stack.Screen options={{ title: `Report ${noun}` }} />
      <View style={styles.target}>
        {t.artwork ? <Artwork url={t.artwork.url} title={t.title} size={56} round={t.type === "artist"} /> : null}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.targetTitle} numberOfLines={2}>
            {t.title}
          </Text>
          <Muted small>{t.description}</Muted>
        </View>
      </View>
      {receipt ? (
        <Thanks target={t} reference={receipt.receipt.reference} email={receipt.email} />
      ) : (
        <Form
          target={t}
          signedInEmail={me?.user.email ?? null}
          onSent={(r, email) => setReceipt({ receipt: r, email })}
        />
      )}
    </Screen>
  );
}

function Form({
  target,
  signedInEmail,
  onSent,
}: {
  target: ReportTarget;
  signedInEmail: string | null;
  onSent(receipt: ReportReceipt, email: string): void;
}) {
  const toast = useToast();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const openCopyrightForm = async () => {
    const url = `${await siteAddress()}${websiteReportPath(target.type, target.id, "copyright")}`;
    Linking.openURL(url).catch(() => toast(`Couldn't open the website. Visit ${url} in your browser.`));
  };

  const submit = async () => {
    const problem = reportProblem({ reason, details, email: signedInEmail ? null : email });
    if (problem || !reason) return setError(problem);
    setBusy(true);
    setError(null);
    try {
      const receipt = await api.report({
        targetType: target.type,
        targetId: target.id,
        reason,
        details: details.trim(),
        ...(signedInEmail
          ? {}
          : { reporterEmail: email.trim(), ...(name.trim() ? { reporterName: name.trim() } : {}) }),
      });
      onSent(receipt, signedInEmail ?? email.trim());
    } catch (e) {
      setError(errorMessage(e, "Couldn't send your report."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: space.md }}>
      <Heading style={{ marginBottom: 0 }}>What's wrong?</Heading>
      <View role="radiogroup" style={{ gap: space.sm }}>
        {phoneReportReasons(target.type).map((r) => (
          <Choice
            key={r}
            title={REPORT_REASON_NAMES[r]}
            hint={REASON_HINTS[r]}
            selected={reason === r}
            onPress={() => (setReason(r), setError(null))}
          />
        ))}
        <Choice
          title={REPORT_REASON_NAMES.copyright}
          hint={`${REASON_HINTS.copyright} A copyright notice needs your contact details and two signed statements, so it opens the form on the Trusic website.`}
          external
          onPress={() => void openCopyrightForm()}
        />
      </View>
      {reason === "offensive" ? <Note tone="warn">If someone is in immediate danger, call 999 first.</Note> : null}

      <Field
        label={reason === "ai_label" ? "What makes you think the label is wrong?" : "Tell us what's wrong"}
        value={details}
        onChangeText={setDetails}
        multiline
        maxLength={5000}
        style={[styles.input, styles.multiline]}
        textAlignVertical="top"
      />
      {signedInEmail ? (
        <Muted small>
          We'll reply to <Text style={styles.strong}>{signedInEmail}</Text>.
        </Muted>
      ) : (
        <>
          <Field label="Your name (optional)" value={name} onChangeText={setName} maxLength={120} />
          <Field
            label="Your email address"
            hint="So we can tell you what happens, or ask for more details."
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            textContentType="emailAddress"
          />
        </>
      )}
      {error ? <ErrorNote message={error} /> : null}
      <Button title={busy ? "Sending…" : "Send report"} disabled={busy} onPress={() => void submit()} />
    </View>
  );
}

function Thanks({ target, reference, email }: { target: ReportTarget; reference: string; email: string }) {
  const router = useRouter();
  return (
    <Card style={{ gap: space.md }}>
      <Heading style={{ marginBottom: 0 }}>Thank you</Heading>
      <Body>
        We've received your report about <Text style={styles.strong}>{target.title}</Text>. Your reference is{" "}
        <Text style={styles.strong}>{reference}</Text>.
      </Body>
      <Body>
        A person at Trusic will look at it. We'll email {email} when we've decided what to do, or if we need to know
        more.
      </Body>
      <Button title="Done" onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} />
    </Card>
  );
}

/** One choice in a list, like a radio button. `external` choices open the website instead. */
function Choice({
  title,
  hint,
  selected = false,
  external = false,
  onPress,
}: {
  title: string;
  hint: string;
  selected?: boolean;
  external?: boolean;
  onPress(): void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole={external ? "link" : "radio"}
      accessibilityState={external ? undefined : { checked: selected }}
      style={({ pressed }) => [styles.choice, selected && styles.choiceOn, pressed && { opacity: 0.8 }]}
    >
      {external ? (
        <Icon name="external" size={20} color={colors.muted} />
      ) : (
        <View style={[styles.radio, selected && styles.radioOn]}>{selected ? <View style={styles.dot} /> : null}</View>
      )}
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.choiceTitle}>{title}</Text>
        <Text style={styles.choiceHint}>{hint}</Text>
      </View>
    </Pressable>
  );
}

function Field({ label, hint, style, ...props }: TextInputProps & { label: string; hint?: string }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        {...props}
        accessibilityLabel={label}
        placeholderTextColor={colors.muted}
        style={style ?? styles.input}
        autoCorrect={props.multiline ?? false}
      />
      {hint ? <Muted small>{hint}</Muted> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  target: { flexDirection: "row", alignItems: "center", gap: space.md, marginBottom: space.lg },
  targetTitle: { color: colors.text, fontSize: 18, fontWeight: "800" },
  strong: { color: colors.text, fontWeight: "700" },
  choice: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space.md,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  choiceOn: { borderColor: colors.primary },
  choiceTitle: { color: colors.text, fontSize: 15, fontWeight: "700" },
  choiceHint: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.muted,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  radioOn: { borderColor: colors.primary },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary },
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
  multiline: { minHeight: 110 },
});
