import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import AuthForm from "@/components/auth-form";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const supabaseConfigured = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );

  if (!supabaseConfigured) {
    return (
      <>
        <header className="header"><div className="wrap nav"><Link className="brand" href="/"><span className="brandmark">✦</span>Aura OS</Link><Link className="mutedlink" href="/">Back to Aura ↗</Link></div></header>
        <main className="auth-page">
          <section className="auth-card">
            <Link className="brand" href="/"><span className="brandmark">✦</span>Aura OS</Link>
            <h1>Connect your workspace</h1>
            <p>Aura’s sign-in and creator workspace use Supabase. Add your project URL and publishable key to finish setup.</p>
            <div className="setup-note">
              <strong>In the project folder</strong>
              <ol>
                <li>Copy <code>.env.example</code> to <code>.env.local</code>.</li>
                <li>Replace the two Supabase values with the ones from your Supabase project.</li>
                <li>Stop and restart the dev server.</li>
              </ol>
              <p>For now, you can view the public site at <code>http://localhost:3000</code>.</p>
            </div>
            <Link className="btn secondary" href="/">Back to the public site</Link>
          </section>
        </main>
      </>
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const claims = error ? null : data?.claims ?? null;
  if (claims?.sub) redirect("/dashboard");

  return (
    <><header className="header"><div className="wrap nav"><Link className="brand" href="/"><span className="brandmark">✦</span>Aura OS</Link><Link className="mutedlink" href="/">Back to Aura ↗</Link></div></header>
      <main className="auth-page"><AuthForm /></main></>
  );
}
