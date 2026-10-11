import { useState, type FormEvent } from "react";
import { ApiError } from "@ecopulse/core";
import { api, errorMessage } from "../lib/api";
import { useApp } from "../lib/store";
import { useQueryClient } from "@tanstack/react-query";
import { haptic } from "../lib/haptics";
import { Banner, Button, Segmented } from "./ui";

export function Field({ label, hint, ...rest }: React.InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  const id = rest.id ?? `f-${label.toLowerCase().replace(/\W+/g, "-")}`;
  return (
    <label htmlFor={id} className="block">
      <span className="block text-[0.9063rem] font-medium text-ink-2 mb-1.5">{label}</span>
      <input
        id={id}
        className="block h-12 w-full rounded-md border border-line-strong bg-surface px-3.5 text-[1.0938rem] text-ink placeholder:text-ink-3 focus:border-brand focus:outline-none focus-visible:outline-2"
        {...rest}
      />
      {hint && <span className="mt-1 block text-[0.875rem] text-ink-3">{hint}</span>}
    </label>
  );
}

export function AuthForm({ initialMode = "login", onDone }: { initialMode?: "login" | "register"; onDone: () => void }) {
  const [mode, setMode] = useState<"login" | "register">(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setUser = useApp((s) => s.setUser);
  const qc = useQueryClient();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = mode === "login" ? await api.auth.login(email.trim(), password) : await api.auth.register(email.trim(), password, name.trim());
      setUser(r.user);
      qc.removeQueries({ queryKey: ["me"] });
      qc.removeQueries({ queryKey: ["myReports"] });
      qc.removeQueries({ queryKey: ["points"] });
      qc.removeQueries({ queryKey: ["notifications"] });
      haptic.success();
      onDone();
    } catch (err) {
      haptic.error();
      if (err instanceof ApiError && err.code === "validation_error") setError(mode === "register" ? "Check your details: password needs 8+ characters, name 2+." : "Check your email and password.");
      else setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <Segmented
        label="Account"
        value={mode}
        onChange={(m) => {
          setMode(m);
          setError(null);
        }}
        options={[
          { value: "login", label: "Sign in" },
          { value: "register", label: "Create account" },
        ]}
      />
      {mode === "register" && <Field label="Name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your first name is enough" minLength={2} required />}
      <Field label="Email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" value={email} onChange={(e) => setEmail(e.target.value)} required />
      <Field
        label="Password"
        type="password"
        autoComplete={mode === "login" ? "current-password" : "new-password"}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        hint={mode === "register" ? "At least 8 characters." : undefined}
        required
      />
      {error && <Banner tone="danger">{error}</Banner>}
      <Button type="submit" block size="lg" loading={busy} disabled={!email || !password || (mode === "register" && name.trim().length < 2)}>
        {mode === "login" ? "Sign in" : "Create account"}
      </Button>
      {mode === "login" && (
        <button
          type="button"
          className="block w-full h-11 text-[0.9375rem] text-ink-3"
          onClick={() => {
            setEmail("citizen@ecopulse.dev");
            setPassword("ecopulse-demo");
          }}
        >
          Use the sample account (for trying the app)
        </button>
      )}
    </form>
  );
}
