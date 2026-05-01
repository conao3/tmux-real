/* global React, ReactDOM */
const { useState, useEffect, useRef } = React;

const REPO_URL = "https://github.com/conao3/tmux-real";
const INSTALL_CMD = "cargo install --git https://github.com/conao3/tmux-real tmux-real";
const TPM_PLUGIN_LINE = "set -g @plugin 'conao3/tmux-real'";

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "accent": "lime",
  "scanlines": true,
  "density": "regular",
  "showBootBanner": true,
  "demoSpeed": "normal"
}/*EDITMODE-END*/;

const ACCENTS = {
  lime:   { hex: "#a3e635", soft: "rgba(163,230,53,.14)", glow: "rgba(163,230,53,.35)", name: "lime" },
  cyan:   { hex: "#22d3ee", soft: "rgba(34,211,238,.14)", glow: "rgba(34,211,238,.40)", name: "cyan" },
  amber:  { hex: "#fbbf24", soft: "rgba(251,191,36,.14)", glow: "rgba(251,191,36,.35)", name: "amber" },
  magenta:{ hex: "#f472b6", soft: "rgba(244,114,182,.14)", glow: "rgba(244,114,182,.35)", name: "magenta" },
};

const fmtRFC3339 = (d) => {
  const pad = (n) => String(n).padStart(2, "0");
  const tz = -d.getTimezoneOffset();
  const sign = tz >= 0 ? "+" : "-";
  const tzh = pad(Math.floor(Math.abs(tz)/60));
  const tzm = pad(Math.abs(tz)%60);
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${tzh}:${tzm}`;
};

// ─────────────────────────────────────────────────────────────────────────────
// Hero terminal — live "challenge" countdown demo
// ─────────────────────────────────────────────────────────────────────────────

const STAGE_PROMPT      = "prompt";   // user idle
const STAGE_CHALLENGE   = "challenge"; // banner + countdown
const STAGE_WARN_30     = "warn30";
const STAGE_WARN_10     = "warn10";
const STAGE_FINAL       = "final";    // 5..1
const STAGE_TIMEOUT     = "timeout";
const STAGE_POSTING     = "posting";
const STAGE_POSTED      = "posted";

function HeroTerminal({ accent, scanlines, demoSpeed }) {
  const [lines, setLines] = useState([]);
  const [remaining, setRemaining] = useState(120);
  const [stage, setStage] = useState(STAGE_PROMPT);
  const [restartKey, setRestartKey] = useState(0);
  const scrollRef = useRef(null);

  // speed multiplier for the loop only (not for timestamps)
  const SPEED = demoSpeed === "fast" ? 0.35 : demoSpeed === "slow" ? 1.2 : 0.6;

  // The deterministic, looping demo script. Times are virtual — we collapse
  // the 120s grace into ~12s of action.
  useEffect(() => {
    let cancelled = false;
    const timers = [];
    const at = (ms, fn) => timers.push(setTimeout(() => { if (!cancelled) fn(); }, ms * SPEED));

    setLines([]);
    setStage(STAGE_PROMPT);
    setRemaining(120);

    const now = new Date();
    const deadline = new Date(now.getTime() + 120_000);
    const target = "dev";

    const push = (l) => setLines((xs) => [...xs, ...(Array.isArray(l) ? l : [l])]);

    // boot
    at(120,  () => push({ k: "prompt", text: "tmux-real start" }));
    at(380,  () => push([
      { k: "ok",   text: "✓ tmux client detected (session=dev)" },
      { k: "ok",   text: "✓ gh auth status — logged in as @conao3" },
      { k: "ok",   text: "✓ scheduler started (pid 28471)" },
      { k: "dim",  text: `next_challenge_at = ${fmtRFC3339(new Date(now.getTime() + 600_000))}` },
    ]));
    at(900,  () => push({ k: "dim", text: "[ scheduler waiting … coffee. ]" }));

    // challenge fires
    at(1500, () => {
      setStage(STAGE_CHALLENGE);
      push({ k: "banner", text: `[tmux-real] target=${target} grace=120s deadline=${fmtRFC3339(deadline)} timeout=post secret gist  skip='tmux-real skip'  stop='tmux-real stop'` });
    });

    // virtual countdown: 120 → 30 (in ~3.5s wall)
    at(1700, () => {
      const start = Date.now();
      const tick = () => {
        if (cancelled) return;
        const elapsed = (Date.now() - start) / (1500 * SPEED);   // ~1.5s -> 90 virtual seconds
        const v = Math.max(30, 120 - elapsed * 90);
        setRemaining(Math.round(v));
        if (v > 30) requestAnimationFrame(tick);
        else setRemaining(30);
      };
      tick();
    });

    // 60s notification
    at(2100, () => push({ k: "tick", text: `[tmux-real] target=${target} remaining=60s  skip='tmux-real skip'  stop='tmux-real stop'` }));

    // 30s notification
    at(3300, () => {
      setStage(STAGE_WARN_30);
      push({ k: "warn", text: `[tmux-real] target=${target} remaining=30s  skip='tmux-real skip'  stop='tmux-real stop'` });
    });

    // 30 → 10 (real wall ~2.5s)
    at(3400, () => {
      const start = Date.now();
      const tick = () => {
        if (cancelled) return;
        const elapsed = (Date.now() - start) / (1100 * SPEED);
        const v = Math.max(10, 30 - elapsed * 20);
        setRemaining(Math.round(v));
        if (v > 10) requestAnimationFrame(tick);
        else setRemaining(10);
      };
      tick();
    });

    // 10s notification
    at(4600, () => {
      setStage(STAGE_WARN_10);
      push({ k: "warn", text: `[tmux-real] target=${target} remaining=10s  skip='tmux-real skip'  stop='tmux-real stop'` });
    });

    // final 5..1 (5 ticks, 800ms each scaled)
    at(4800, () => setStage(STAGE_FINAL));
    [5, 4, 3, 2, 1].forEach((n, i) => {
      at(5000 + i * 700, () => {
        setRemaining(n);
        push({ k: "warn", text: `[tmux-real] target=${target} remaining=${n}s  skip='tmux-real skip'  stop='tmux-real stop'` });
      });
    });

    at(8500, () => {
      setRemaining(0);
      setStage(STAGE_TIMEOUT);
      push({ k: "alert", text: `[tmux-real] target=${target} timeout reached; capturing panes and creating secret gist…` });
    });

    at(9100, () => {
      setStage(STAGE_POSTING);
      push([
        { k: "dim", text: "  capturing pane %1 (active)  4823 bytes" },
        { k: "dim", text: "  capturing pane %2          1102 bytes" },
        { k: "dim", text: "  capturing pane %3            612 bytes" },
        { k: "dim", text: "  redacting … 2 matches replaced with [REDACTED]" },
        { k: "dim", text: "  gh gist create tmux-real-20260502-023200.txt  --secret" },
      ]);
    });

    at(10500, () => {
      setStage(STAGE_POSTED);
      push([
        { k: "ok",     text: "[tmux-real] posted https://gist.github.com/conao3/4f2c…91ab (demo)" },
        { k: "prompt", text: "" },
      ]);
    });

    // loop
    at(15500, () => setRestartKey((k) => k + 1));

    return () => { cancelled = true; timers.forEach(clearTimeout); };
  }, [restartKey, SPEED]);

  // autoscroll
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [lines]);

  const onSkip = () => {
    if (stage === STAGE_POSTING || stage === STAGE_POSTED) return;
    setLines((xs) => [
      ...xs,
      { k: "prompt", text: "tmux-real skip" },
      { k: "ok",     text: "[tmux-real] skipped current challenge for target=dev" },
      { k: "dim",    text: "scheduler continues. you live to type another day." },
    ]);
    setStage(STAGE_PROMPT);
    setTimeout(() => setRestartKey((k) => k + 1), 2200);
  };

  const a = ACCENTS[accent] || ACCENTS.lime;

  // big countdown digits color logic
  const digitColor =
    stage === STAGE_TIMEOUT || stage === STAGE_POSTING || stage === STAGE_POSTED ? "#fb7185"
      : stage === STAGE_FINAL ? "#fb7185"
      : stage === STAGE_WARN_10 ? "#fbbf24"
      : stage === STAGE_WARN_30 ? "#fbbf24"
      : a.hex;

  return (
    <div className="term" data-scan={scanlines ? "on" : "off"}>
      <div className="term-chrome">
        <span className="dot" style={{background:"#ff5f57"}}></span>
        <span className="dot" style={{background:"#febc2e"}}></span>
        <span className="dot" style={{background:"#28c840"}}></span>
        <span className="term-title">tmux — dev:1 — 122×34</span>
        <span className="term-meta" style={{color: a.hex}}>● rec</span>
      </div>

      <div className="term-body">
        <div className="term-stream" ref={scrollRef}>
          {lines.map((l, i) => <TermLine key={i} line={l} accent={a} />)}
        </div>

        {(stage === STAGE_CHALLENGE || stage === STAGE_WARN_30 || stage === STAGE_WARN_10 || stage === STAGE_FINAL) && (
          <div className="hud">
            <div className="hud-label" style={{color: a.hex}}>⏱ tmux-real challenge — secret gist on timeout</div>
            <div className="hud-row">
              <div className="hud-digits" style={{color: digitColor, textShadow: `0 0 24px ${digitColor}55`}}>
                {String(Math.floor(remaining/60)).padStart(2,"0")}<span className="colon">:</span>{String(remaining%60).padStart(2,"0")}
              </div>
              <div className="hud-actions">
                <button className="hud-btn skip" onClick={onSkip}>
                  <kbd>tmux-real skip</kbd>
                </button>
                <button className="hud-btn stop" onClick={() => {
                  setLines((xs) => [...xs,
                    { k: "prompt", text: "tmux-real stop" },
                    { k: "ok", text: "[tmux-real] scheduler stopped for target=dev" },
                  ]);
                  setStage(STAGE_PROMPT);
                  setTimeout(() => setRestartKey((k) => k + 1), 2400);
                }}>
                  <kbd>tmux-real stop</kbd>
                </button>
              </div>
            </div>
            <div className="hud-bar">
              <div className="hud-bar-fill" style={{
                width: `${(remaining/120)*100}%`,
                background: digitColor,
                boxShadow: `0 0 12px ${digitColor}88`,
              }}/>
            </div>
          </div>
        )}

        {stage === STAGE_POSTING && (
          <div className="hud posting">
            <div className="hud-label" style={{color:"#fb7185"}}>● posting secret gist…</div>
            <div className="hud-spinner">
              <span/><span/><span/><span/><span/>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function TermLine({ line, accent }) {
  if (line.k === "prompt") {
    return (
      <div className="ln">
        <span className="psn" style={{color: accent.hex}}>conao@dev</span>
        <span className="psd"> ~/code/tmux-real </span>
        <span className="pst" style={{color: accent.hex}}>$ </span>
        <span className="cmd">{line.text}</span>
        {line.text === "" && <span className="caret" style={{background: accent.hex}}/>}
      </div>
    );
  }
  if (line.k === "ok")    return <div className="ln ok">{line.text}</div>;
  if (line.k === "dim")   return <div className="ln dim">{line.text}</div>;
  if (line.k === "warn")  return <div className="ln warn">{line.text}</div>;
  if (line.k === "alert") return <div className="ln alert">{line.text}</div>;
  if (line.k === "tick")  return <div className="ln tick" style={{color: accent.hex}}>{line.text}</div>;
  if (line.k === "banner") {
    return (
      <div className="banner" style={{borderColor: accent.hex + "55", background: accent.soft, color: accent.hex}}>
        {line.text}
      </div>
    );
  }
  return <div className="ln">{line.text}</div>;
}

// ─────────────────────────────────────────────────────────────────────────────
// How it works — flow diagram
// ─────────────────────────────────────────────────────────────────────────────

function HowItWorks({ accent }) {
  const a = ACCENTS[accent] || ACCENTS.lime;
  const steps = [
    {
      n: "01",
      title: "scheduler waits",
      sub: "interval 60m ± jitter 15m",
      body: "A background process per tmux server. One target session, locked to the client that ran `tmux-real start`.",
      glyph: "◷",
    },
    {
      n: "02",
      title: "challenge fires",
      sub: "120s grace · countdown reminders at 60/30/10/5..1",
      body: "display-message broadcasts to every pane in the target session. status line is left untouched. you get one hundred and twenty seconds to react.",
      glyph: "◉",
    },
    {
      n: "03",
      title: "skip · stop · ignore",
      sub: "your three options",
      body: "skip: dismiss this one, scheduler continues. stop: kill the scheduler entirely. ignore: see step 04.",
      glyph: "⋮",
    },
    {
      n: "04",
      title: "timeout → secret gist",
      sub: "visible panes, captured & redacted",
      body: "tmux capture-pane records the visible viewport of every pane in scope. ANSI is stripped, secrets are redacted via regex, then the result is posted as a secret gist via gh.",
      glyph: "✦",
    },
  ];

  return (
    <section className="hiw">
      <div className="section-head">
        <div className="kicker" style={{color: a.hex}}>// how it works</div>
        <h2>
          Four states.
          <br />
          One scheduler.
          <br />
          Zero excuses.
        </h2>
        <p className="lede">tmux-real lives as a Rust binary plus a thin TPM plugin entrypoint. The binary does the real work.</p>
      </div>

      <ol className="hiw-grid">
        {steps.map((s, i) => (
          <li key={s.n} className="hiw-card">
            <div className="hiw-card-top">
              <span className="hiw-num" style={{color: a.hex}}>{s.n}</span>
              <span className="hiw-glyph" style={{color: a.hex, textShadow: `0 0 18px ${a.glow}`}}>{s.glyph}</span>
            </div>
            <div className="hiw-title">{s.title}</div>
            <div className="hiw-sub" style={{color: a.hex}}>{s.sub}</div>
            <p className="hiw-body">{s.body}</p>
            {i < steps.length - 1 && <span className="hiw-arrow" style={{color: a.hex}}>→</span>}
          </li>
        ))}
      </ol>

      <div className="state-rail">
        <div className="rail-label">state machine</div>
        <div className="rail-track">
          {["idle","waiting","challenge","posting","posted"].map((s, i, arr) => (
            <React.Fragment key={s}>
              <span className={"rail-node " + (s === "challenge" ? "rail-active" : "")}
                    style={s === "challenge" ? {background: a.hex, color: "#0a0a0a", boxShadow: `0 0 24px ${a.glow}`} : {}}>
                {s}
              </span>
              {i < arr.length - 1 && <span className="rail-edge" style={{background: a.hex + "33"}}/>}
            </React.Fragment>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Install
// ─────────────────────────────────────────────────────────────────────────────

function Install({ accent }) {
  const a = ACCENTS[accent] || ACCENTS.lime;
  const [copied, setCopied] = useState(null);

  const copy = (text, key) => {
    navigator.clipboard?.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 1400);
  };

  const tpmLine = TPM_PLUGIN_LINE;
  const cargoLine = INSTALL_CMD;
  const ghAuth = "gh auth login";
  const start = "tmux-real start";

  const Block = ({ id, prompt, code, note }) => (
    <div className="cmd-block" onClick={() => copy(code, id)}>
      <div className="cmd-line">
        {prompt && <span className="cmd-prompt" style={{color: a.hex}}>{prompt} </span>}
        <span className="cmd-code">{code}</span>
      </div>
      <button className="copy-btn" aria-label="copy">
        {copied === id ? <span style={{color: a.hex}}>copied</span> : <span>copy</span>}
      </button>
      {note && <div className="cmd-note">{note}</div>}
    </div>
  );

  return (
    <section className="install">
      <div className="section-head">
        <div className="kicker" style={{color: a.hex}}>// install</div>
        <h2>
          Three lines.
          <br />
          One binary.
          <br />
          Then start the timer.
        </h2>
        <p className="lede">tmux-real ships as a TPM-loadable plugin. The plugin is just an entrypoint — the real logic is the Rust binary you install once.</p>
      </div>

      <div className="install-grid">
        <div className="install-step">
          <div className="step-n" style={{color: a.hex}}>1.</div>
          <div className="step-h">Install the binary</div>
          <Block id="cargo" prompt="$" code={cargoLine} note="rustc 1.74+, gh in PATH" />
        </div>

        <div className="install-step">
          <div className="step-n" style={{color: a.hex}}>2.</div>
          <div className="step-h">Add to <code>~/.tmux.conf</code></div>
          <Block id="tpm" prompt="" code={tpmLine} note="then prefix + I to fetch via TPM" />
        </div>

        <div className="install-step">
          <div className="step-n" style={{color: a.hex}}>3.</div>
          <div className="step-h">Authenticate gh, then start</div>
          <Block id="gh" prompt="$" code={ghAuth} />
          <Block id="start" prompt="$" code={start} note="targets the session of the client that ran it" />
        </div>
      </div>

      <div className="config">
        <div className="config-h">
          <span className="kicker" style={{color: a.hex}}>// config</span>
          <span>set as global <code>@tmux-real-*</code> options</span>
        </div>
        <div className="config-grid">
          <ConfigRow k="@tmux-real-interval-minutes"   v="60"     a={a}/>
          <ConfigRow k="@tmux-real-jitter-minutes"     v="15"     a={a}/>
          <ConfigRow k="@tmux-real-grace-seconds"      v="120"    a={a}/>
          <ConfigRow k="@tmux-real-redact-patterns"    v={"ghp_[A-Za-z0-9]+ || AIza[0-9A-Za-z_-]+"} a={a}/>
          <ConfigRow k="@tmux-real-exclude-sessions"   v="prod, staging" a={a}/>
          <ConfigRow k="@tmux-real-exclude-panes"      v="%1, %8" a={a}/>
        </div>
      </div>
    </section>
  );
}

function ConfigRow({ k, v, a }) {
  return (
    <div className="cfg-row">
      <code className="cfg-k">{k}</code>
      <span className="cfg-eq" style={{color: a.hex}}>=</span>
      <code className="cfg-v">{v}</code>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Commands strip
// ─────────────────────────────────────────────────────────────────────────────

function CommandsStrip({ accent }) {
  const a = ACCENTS[accent] || ACCENTS.lime;
  const cmds = [
    ["init",     "seed default options. no scheduler."],
    ["status",   "what's running, what's next, last gist url."],
    ["start",    "lock target session, start scheduler."],
    ["once",     "fire one challenge right now. no scheduler."],
    ["skip",     "dismiss the active challenge."],
    ["stop",     "kill scheduler. no posting."],
    ["post-now", "skip the ceremony. publish a gist. now."],
  ];
  return (
    <section className="cmds">
      <div className="kicker" style={{color: a.hex}}>// commands</div>
      <div className="cmds-grid">
        {cmds.map(([c, d]) => (
          <div className="cmd-pill" key={c}>
            <span className="cmd-pill-c" style={{color: a.hex}}>tmux-real {c}</span>
            <span className="cmd-pill-d">{d}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// App
// ─────────────────────────────────────────────────────────────────────────────

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const a = ACCENTS[t.accent] || ACCENTS.lime;

  // expose accent to CSS
  useEffect(() => {
    const r = document.documentElement;
    r.style.setProperty("--accent", a.hex);
    r.style.setProperty("--accent-soft", a.soft);
    r.style.setProperty("--accent-glow", a.glow);
    r.dataset.density = t.density;
    r.dataset.scan = t.scanlines ? "on" : "off";
  }, [t.accent, t.density, t.scanlines, a]);

  return (
    <div className="page">
      {t.scanlines && <div className="scan-overlay" aria-hidden="true"/>}
      <div className="grid-bg" aria-hidden="true"/>

      <header className="topbar">
        <div className="brand">
          <span className="brand-glyph" style={{color: a.hex, textShadow: `0 0 14px ${a.glow}`}}>▣</span>
          <span className="brand-name">tmux-real</span>
          <span className="brand-ver">v0.1.0 · MVP</span>
        </div>
        <nav className="nav">
          <a href="#how">how it works</a>
          <a href="#install">install</a>
          <a href="#commands">commands</a>
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="nav-cta"
            style={{borderColor: a.hex + "66", color: a.hex}}
          >
            ★ github
          </a>
        </nav>
      </header>

      <main>
        <section className="hero">
          <div className="hero-left">
            {t.showBootBanner && (
              <div className="boot-banner" style={{borderColor: a.hex + "44"}}>
                <span style={{color: a.hex}}>●</span>
                <span>secret-gist scheduler · live demo</span>
                <span className="boot-dot">·</span>
                <span className="boot-dim">no actual gists were created</span>
              </div>
            )}
            <h1 className="title">
              Be <span className="title-accent" style={{color: a.hex, textShadow: `0 0 28px ${a.glow}`}}>real</span>
              <br/>in your tmux.
            </h1>
            <p className="sub">
              A scheduler that, on its own schedule, asks your terminal to <em>show its work</em>.
              Don't <kbd>skip</kbd> in time and the visible viewport of every pane in your session ships to a secret gist.
              Built in Rust. Loaded via TPM. Powered by <code>gh</code>.
            </p>
            <div className="hero-cta">
              <a
                href={REPO_URL}
                target="_blank"
                rel="noreferrer"
                className="cta-primary"
                style={{background: a.hex, boxShadow: `0 0 0 1px ${a.hex}, 0 12px 40px ${a.glow}`}}
              >
                view source on github
              </a>
              <a href="#how" className="cta-secondary">how does this work →</a>
            </div>
            <ul className="hero-stats">
              <li><b style={{color: a.hex}}>0</b><span>tmux hooks patched</span></li>
              <li><b style={{color: a.hex}}>1</b><span>secret gist per timeout</span></li>
              <li><b style={{color: a.hex}}>∞</b><span>regret per posted .bashrc</span></li>
            </ul>
          </div>

          <div className="hero-right">
            <HeroTerminal accent={t.accent} scanlines={t.scanlines} demoSpeed={t.demoSpeed}/>
            <div className="hero-caption">
              live demo · loops · click <kbd>tmux-real skip</kbd> to interrupt
            </div>
          </div>
        </section>

        <section id="how"><HowItWorks accent={t.accent}/></section>
        <section id="commands"><CommandsStrip accent={t.accent}/></section>
        <section id="install"><Install accent={t.accent}/></section>

        <footer className="foot">
          <div className="foot-l">
            <span className="brand-glyph" style={{color: a.hex}}>▣</span>
            <span>tmux-real</span>
            <span className="foot-dim">— a parody. you are the experiment.</span>
          </div>
          <div className="foot-r">
            <a href={REPO_URL} target="_blank" rel="noreferrer" className="foot-dim">github.com/conao3/tmux-real</a>
          </div>
        </footer>
      </main>

      <TweaksPanel>
        <TweakSection label="Accent"/>
        <TweakRadio
          label="Color"
          value={t.accent}
          options={[
            { value: "lime",    label: "lime" },
            { value: "cyan",    label: "cyan" },
            { value: "amber",   label: "amber" },
            { value: "magenta", label: "mag" },
          ]}
          onChange={(v) => setTweak("accent", v)}
        />
        <TweakSection label="Vibe"/>
        <TweakToggle label="CRT scanlines" value={t.scanlines} onChange={(v) => setTweak("scanlines", v)}/>
        <TweakToggle label="Boot banner"   value={t.showBootBanner} onChange={(v) => setTweak("showBootBanner", v)}/>
        <TweakRadio
          label="Density"
          value={t.density}
          options={[
            { value: "compact", label: "compact" },
            { value: "regular", label: "regular" },
            { value: "comfy",   label: "comfy" },
          ]}
          onChange={(v) => setTweak("density", v)}
        />
        <TweakSection label="Demo"/>
        <TweakRadio
          label="Speed"
          value={t.demoSpeed}
          options={[
            { value: "slow",   label: "slow" },
            { value: "normal", label: "normal" },
            { value: "fast",   label: "fast" },
          ]}
          onChange={(v) => setTweak("demoSpeed", v)}
        />
      </TweaksPanel>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App/>);
