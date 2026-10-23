"use client";
import Link from "next/link";
import { FormEvent, useState } from "react";
import { createClient } from "@/lib/supabase/client";
export default function AuthForm() {
  const [mode, setMode] = useState<"login" | "signup">("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    try {
      const supabase = createClient();
      const result = mode === "signup"
        ? await supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin + "/auth/callback?next=/dashboard" } })
        : await supabase.auth.signInWithPassword({ email, password });
      if (result.error) throw result.error;
      if (mode === "signup" && !result.data.session) setMessage("Check your email to confirm your account, then come back to sign in.");
      else window.location.assign("/dashboard");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Authentication failed.");
    } finally { setBusy(false); }
  }
  return <section className="auth-card">
    <Link className="brand" href="/"><span className="brandmark">✦</span>Aura OS</Link>
    <h1>{mode === "signup" ? "Start your creator workspace." : "Welcome back."}</h1>
    <p>Sign in to manage uploads, review AI clip suggestions, and keep your edits together.</p>
    <form onSubmit={submit}>
      <label className="field">Email<input type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required /></label>
      <label className="field">Password<input type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} minLength={8} value={password} onChange={e => setPassword(e.target.value)} required /></label>
      {error && <p className="error" role="alert">{error}</p>}
      {message && <p className="success" role="status">{message}</p>}
      <button className="btn primary" type="submit" disabled={busy}>{busy ? "Please wait…" : mode === "signup" ? "Create account ↗" : "Sign in ↗"}</button>
    </form>
    <button className="switchmode" type="button" onClick={() => { setMode(mode === "signup" ? "login" : "signup"); setMessage(""); setError(""); }}>
      {mode === "signup" ? "Already have an account? Sign in" : "New to Aura OS? Create an account"}
    </button>
  </section>;
}
