import Link from "next/link";

type Plan = {
  name: string;
  price: string;
  period: string;
  copy: string;
  features: string[];
  button: string;
  badge?: string;
  recommended?: boolean;
  free?: boolean;
};

const plans: Plan[] = [
  { name: "Free", price: "$0", period: "forever", copy: "Try Aura OS with no payment details.", button: "Start free", badge: "No card", free: true, features: ["1 source video / month", "Up to 5 clips when processing is live", "Captions + vertical framing", "Watermarked 720p exports"] },
  { name: "Basic", price: "$10", period: "month", copy: "A first step into short-form.", button: "Choose Basic", features: ["5 source videos / month", "Up to 20 clips", "Auto captions", "720p exports"] },
  { name: "Creator", price: "$25", period: "month", copy: "Room for an active creator.", button: "Choose Creator", features: ["15 source videos / month", "Up to 75 clips", "Captions, zoom & SFX", "1080p exports"] },
  { name: "Pro", price: "$50", period: "month", copy: "A workflow for growing channels.", button: "Choose Pro", features: ["40 source videos / month", "Up to 200 clips", "Brand kits & templates", "Priority processing"] },
  { name: "Startup Pro", price: "$75", period: "month", copy: "A shared clipping engine for teams.", button: "Choose Startup Pro", badge: "Recommended", recommended: true, features: ["Unlimited team seats", "100 source videos / month", "Shared approvals", "Priority support"] },
];

export default function Home() {
  return (
    <>
      <div className="announcement">✦ &nbsp; Aura OS turns long videos into ready-to-post short clips.</div>
      <header className="header"><div className="wrap nav">
        <Link className="brand" href="/"><span className="brandmark">✦</span>Aura OS</Link>
        <nav className="navlinks"><a href="#how">How it works</a><a href="#pricing">Pricing</a><a href="#about">About</a></nav>
        <div className="navright"><Link className="mutedlink" href="/login">Log in</Link><Link className="btn primary" href="/login">Get started ↗</Link></div>
      </div></header>
      <main>
        <section className="hero"><div className="wrap hero-grid">
          <div><div className="eyebrow">AI video clipping studio</div><h1>One long video.<br/><span>Endless moments.</span></h1>
            <p>Drop in a YouTube video or upload a recording. Aura finds the moments people will replay, then prepares polished clips with captions, smart zooms, and sound.</p>
            <div className="hero-actions"><Link className="btn primary" href="/login">Open your creator workspace ↗</Link><a className="btn secondary" href="#how">See how Aura works</a></div>
            <div className="micro">AI finds the moments. You keep the final say.</div>
          </div>
          <div className="preview"><div className="preview-top"><span>● ● ●</span><span>app.auraos.ai / workspace</span><span>•••</span></div><div className="appmock">
            <aside className="mock-side"><div className="mock-logo">✦ Aura OS</div><div className="mock-nav sel">▦ &nbsp;Dashboard</div><div className="mock-nav">✧ &nbsp;AI Agents</div><div className="mock-nav">☷ &nbsp;Tasks</div><div className="mock-nav">▣ &nbsp;My clips</div></aside>
            <div className="mock-main"><div className="mock-title">Running tasks · Video editor</div><div className="mock-sub">Your content pipeline, in one place</div><div className="mock-cards"><div className="mock-video">▶ &nbsp; Clip preview</div><div className="feature-mini"><div className="mock-title">Quick edit · Auto enhanced ✦</div><p className="mock-sub">“Start before I felt ready.”</p><div className="mock-timeline"></div><div className="mock-sub">Captions · smart zoom · sound FX</div></div></div><div className="mock-status"><div>Tasks in progress<b>02 &nbsp;<span className="ok">Active</span></b></div><div>Waiting approval<b>03 &nbsp; Review</b></div><div>AI ideas<b>05 &nbsp; New</b></div></div></div>
          </div></div>
        </div></section>
        <section className="section" id="how"><div className="wrap"><div className="sectionhead"><div className="eyebrow">From full video to feed-ready</div><h2>Your best moments, already halfway there.</h2><p>Aura takes the first edit pass. You choose the clips that sound and feel like you.</p></div>
          <div className="featuregrid"><article className="feature"><span className="num">01 / INPUT</span><h3>Bring your video</h3><p>Paste a YouTube link or upload a recording, podcast, livestream, or interview.</p></article><article className="feature"><span className="num">02 / DISCOVER</span><h3>Find the hook</h3><p>AI identifies standout moments, follows the context, and frames clips for vertical video.</p></article><article className="feature"><span className="num">03 / EDIT</span><h3>Make it yours</h3><p>Refine captions, smart zooms, and sound effects. Review each clip, then export.</p></article></div>
          <div className="chiprow"><div className="chip"><span>✦</span> Viral moment detection</div><div className="chip"><span>▤</span> Animated captions</div><div className="chip"><span>⌖</span> Smart reframing</div><div className="chip"><span>♫</span> Sound effects</div></div>
        </div></section>
        <section className="pricing" id="pricing"><div className="wrap"><div className="sectionhead"><div className="eyebrow">Subscriptions</div><h2>Pick your creative runway.</h2><p>Start simple. Move up when your video pipeline does.</p></div><div className="plans">{plans.map(plan => <article key={plan.name} className={"plan" + (plan.recommended ? " recommended" : "") + (plan.free ? " free-plan" : "")}>{plan.badge && <span className="badge">{plan.badge}</span>}<h3>{plan.name}</h3><p>{plan.copy}</p><div className="price">{plan.price}<small> / {plan.period}</small></div><Link className={"btn " + (plan.recommended || plan.free ? "primary" : "secondary")} href="/login">{plan.button}</Link><ul>{plan.features.map(feature => <li key={feature}>{feature}</li>)}</ul></article>)}</div><p className="micro" style={{textAlign:"center"}}>Free signup requires no card. Plan limits are launch estimates; AI clip processing is still being connected, so videos may remain queued until it is live.</p></div></section>
        <section className="section" id="about"><div className="wrap about"><div><div className="eyebrow">More time for making</div><h2>Your long videos have more to say.</h2><p>Aura OS is a creative workspace for turning the videos you already make into more ways to show up. Let AI take the first pass, keep the final say, and build a repeatable clip workflow.</p><Link className="btn secondary" href="/login">Explore your workspace ↗</Link></div><div className="about-card"><blockquote>“One source video. More moments worth sharing. A whole lot less time in the edit bay.”</blockquote><small>Built for creators, podcasters, and content teams.</small></div></div></section>
      </main>
      <footer className="footer"><div className="wrap footer-row"><Link className="brand" href="/"><span className="brandmark">✦</span>Aura OS</Link><span>AI-powered clipping for people creating what’s next.</span><span>© 2026 Aura OS</span></div></footer>
    </>
  );
}
