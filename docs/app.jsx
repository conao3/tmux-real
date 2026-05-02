/* global React, ReactDOM */
const { useState, useEffect, useRef } = React;

const REPO_URL = "https://github.com/conao3/tmux-real";
const INSTALL_CMD = "cargo install tmux-real";
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

const STAGE_PROMPT = "prompt";
const STAGE_CHALLENGE = "challenge";
const STAGE_WARN_30 = "warn30";
const STAGE_WARN_10 = "warn10";
const STAGE_FINAL = "final";
const STAGE_TIMEOUT = "timeout";
const STAGE_POSTING = "posting";
const STAGE_POSTED = "posted";

const LOCALE_PATH_RE = /(^|\/)ja(\/|$)/;

function resolveLocale() {
  return LOCALE_PATH_RE.test(window.location.pathname) ? "ja" : "en";
}

function fmtRFC3339(date) {
  const pad = (n) => String(n).padStart(2, "0");
  const tz = -date.getTimezoneOffset();
  const sign = tz >= 0 ? "+" : "-";
  const tzh = pad(Math.floor(Math.abs(tz) / 60));
  const tzm = pad(Math.abs(tz) % 60);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${sign}${tzh}:${tzm}`;
}

const COPY = {
  en: {
    meta: {
      title: "tmux-real — be real, in your tmux",
      description: "tmux-real is a Rust-powered tmux prank plugin that posts the visible viewport of your panes to a secret gist if you miss the countdown.",
    },
    nav: {
      how: "how it works",
      install: "install",
      commands: "commands",
      github: "★ github",
    },
    hero: {
      banner: "secret-gist scheduler",
      titleLead: "Be",
      titleAccent: "real",
      titleTail: "in your tmux.",
      subtitle: () => (
        <>
          A scheduler that, on its own schedule, asks your terminal to <em>show its work</em>.
          {" "}Don't <kbd>skip</kbd> in time and the visible viewport of every pane in your session ships to a secret gist.
          {" "}Built in Rust. Loaded via TPM. Powered by <code>gh</code>.
        </>
      ),
      primaryCta: "view source on github",
      secondaryCta: "how does this work →",
      stats: [
        ["0", "tmux hooks patched"],
        ["1", "secret gist per timeout"],
        ["∞", "regret per posted .bashrc"],
      ],
    },
    demo: {
      tmuxDetected: "✓ tmux client detected (session=dev)",
      ghAuth: "✓ gh auth status — logged in as @conao3",
      schedulerStarted: "✓ scheduler started (pid 28471)",
      nextChallengeAt: (value) => `next_challenge_at = ${value}`,
      waiting: "[ scheduler waiting … coffee. ]",
      banner: ({ target, deadline }) => `[tmux-real] target=${target} grace=120s deadline=${deadline} timeout=post secret gist  skip='tmux-real skip'  stop='tmux-real stop'`,
      remaining: ({ target, seconds }) => `[tmux-real] target=${target} remaining=${seconds}s  skip='tmux-real skip'  stop='tmux-real stop'`,
      timeoutReached: ({ target }) => `[tmux-real] target=${target} timeout reached; capturing panes and creating secret gist…`,
      capture1: "  capturing pane %1 (active)  4823 bytes",
      capture2: "  capturing pane %2          1102 bytes",
      capture3: "  capturing pane %3            612 bytes",
      redact: "  redacting … 2 matches replaced with [REDACTED]",
      gistCreate: "  gh gist create tmux-real-20260502-023200.txt  --secret",
      posted: "[tmux-real] posted https://gist.github.com/conao3/4f2c…91ab (demo)",
      skipMessage: "[tmux-real] skipped current challenge for target=dev",
      skipFollowup: "scheduler continues. you live to type another day.",
      stopMessage: "[tmux-real] scheduler stopped for target=dev",
      hudLabel: "⏱ tmux-real challenge — secret gist on timeout",
      postingLabel: "● posting secret gist…",
      promptUser: "conao@dev",
    },
    how: {
      kicker: "// how it works",
      title: ["Four states.", "One scheduler.", "Zero excuses."],
      lede: "tmux-real lives as a Rust binary plus a thin TPM plugin entrypoint. The binary does the real work.",
      steps: [
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
      ],
      stateMachine: "state machine",
      states: ["idle", "waiting", "challenge", "posting", "posted"],
    },
    commands: {
      kicker: "// commands",
      items: [
        ["init", "seed default options. no scheduler."],
        ["status", "what's running, what's next, last gist url."],
        ["start", "lock target session, start scheduler."],
        ["once", "fire one challenge right now. no scheduler."],
        ["skip", "dismiss the active challenge."],
        ["stop", "kill scheduler. no posting."],
        ["post-now", "skip the ceremony. publish a gist. now."],
      ],
    },
    install: {
      kicker: "// install",
      title: ["Three lines.", "One binary.", "Then start the timer."],
      lede: "tmux-real ships as a TPM-loadable plugin. The plugin is just an entrypoint — the real logic is the Rust binary you install once.",
      steps: [
        {
          number: "1.",
          title: "Install the binary",
          blocks: [
            { id: "cargo", prompt: "$", code: INSTALL_CMD, note: "rustc 1.74+, gh in PATH" },
          ],
        },
        {
          number: "2.",
          title: <>Add to <code>~/.tmux.conf</code></>,
          blocks: [
            { id: "tpm", prompt: "", code: TPM_PLUGIN_LINE, note: "then prefix + I to fetch via TPM" },
          ],
        },
        {
          number: "3.",
          title: "Authenticate gh, then start",
          blocks: [
            { id: "gh", prompt: "$", code: "gh auth login" },
            { id: "start", prompt: "$", code: "tmux-real start", note: "targets the session of the client that ran it" },
          ],
        },
      ],
      copied: "copied",
      copy: "copy",
      configKicker: "// config",
      configLead: () => <>set as global <code>@tmux-real-*</code> options</>,
      configValues: {
        sessions: "prod, staging",
      },
    },
    footer: {
      note: "— a parody. you are the experiment.",
    },
    tweaks: {
      accentSection: "Accent",
      colorLabel: "Color",
      vibeSection: "Vibe",
      scanlines: "CRT scanlines",
      bootBanner: "Boot banner",
      densityLabel: "Density",
      demoSection: "Demo",
      speedLabel: "Speed",
      accentOptions: {
        lime: "lime",
        cyan: "cyan",
        amber: "amber",
        magenta: "mag",
      },
      densityOptions: {
        compact: "compact",
        regular: "regular",
        comfy: "comfy",
      },
      speedOptions: {
        slow: "slow",
        normal: "normal",
        fast: "fast",
      },
    },
  },
  ja: {
    meta: {
      title: "tmux-real — tmux でも、ちゃんと見せろ。",
      description: "tmux-real は、制限時間内に反応できないと、各 pane の見えている範囲を secret gist に投稿する Rust 製の tmux パロディプラグインです。",
    },
    nav: {
      how: "仕組み",
      install: "導入",
      commands: "コマンド",
      github: "★ GitHub",
    },
    hero: {
      banner: "secret-gist scheduler",
      titleLead: "tmuxでも",
      titleAccent: "real",
      titleTail: "を見せろ。",
      subtitle: () => (
        <>
          不定期にあなたの端末を覗きに来るスケジューラです。
          {" "}時間内に <kbd>skip</kbd> しないと、session 内の各 pane の見えている範囲が secret gist に投稿されます。
          {" "}Rust 製、TPM で読み込み、投稿は <code>gh</code> 経由です。
        </>
      ),
      primaryCta: "GitHub で見る",
      secondaryCta: "仕組みを見る →",
      stats: [
        ["0", "tmux hook の改変"],
        ["1", "timeout ごとの secret gist"],
        ["∞", ".bashrc を晒した後悔"],
      ],
    },
    demo: {
      tmuxDetected: "✓ tmux client を検出 (session=dev)",
      ghAuth: "✓ gh auth status — @conao3 でログイン済み",
      schedulerStarted: "✓ scheduler を起動 (pid 28471)",
      nextChallengeAt: (value) => `next_challenge_at = ${value}`,
      waiting: "[ scheduler waiting … coffee. ]",
      banner: ({ target, deadline }) => `[tmux-real] target=${target} grace=120s deadline=${deadline} timeout=secret gist post  skip='tmux-real skip'  stop='tmux-real stop'`,
      remaining: ({ target, seconds }) => `[tmux-real] target=${target} remaining=${seconds}s  skip='tmux-real skip'  stop='tmux-real stop'`,
      timeoutReached: ({ target }) => `[tmux-real] target=${target} timeout reached; pane を capture して secret gist を作成します…`,
      capture1: "  pane %1 (active) を capture  4823 bytes",
      capture2: "  pane %2 を capture          1102 bytes",
      capture3: "  pane %3 を capture            612 bytes",
      redact: "  redact … 2 matches replaced with [REDACTED]",
      gistCreate: "  gh gist create tmux-real-20260502-023200.txt  --secret",
      posted: "[tmux-real] posted https://gist.github.com/conao3/4f2c…91ab (demo)",
      skipMessage: "[tmux-real] current challenge を skip しました (target=dev)",
      skipFollowup: "scheduler はそのまま継続します。",
      stopMessage: "[tmux-real] target=dev の scheduler を停止しました",
      hudLabel: "⏱ tmux-real challenge — timeout で secret gist 投稿",
      postingLabel: "● secret gist を投稿中…",
      promptUser: "conao@dev",
    },
    how: {
      kicker: "// 仕組み",
      title: ["4つの状態。", "1つの scheduler。", "言い訳はなし。"],
      lede: "tmux-real の本体は Rust 製の CLI で、TPM 用 plugin はそれを呼ぶ薄いラッパーにすぎません。",
      steps: [
        {
          n: "01",
          title: "待機",
          sub: "interval 60m ± jitter 15m",
          body: "`tmux-real start` を打った client の session を target に固定し、tmux server ごとに 1 本の常駐プロセスが待機します。",
          glyph: "◷",
        },
        {
          n: "02",
          title: "challenge 発火",
          sub: "猶予 120s · 60/30/10/5..1 で通知",
          body: "target session 内の各 pane に display-message を出します。status line は触りません。猶予は 120 秒。それを過ぎると次のフェーズに進みます。",
          glyph: "◉",
        },
        {
          n: "03",
          title: "skip · stop · ignore",
          sub: "選択肢は3つ",
          body: "skip は今回だけ見逃し、scheduler は継続。stop は scheduler 全体を停止。無視した場合は次へ。",
          glyph: "⋮",
        },
        {
          n: "04",
          title: "timeout → secret gist",
          sub: "表示中の pane を capture",
          body: "対象 pane ごとに、現在見えている範囲だけを tmux capture-pane で取得します。ANSI を剥がし、regex で秘密情報を redact してから、gh 経由で secret gist に投稿します。",
          glyph: "✦",
        },
      ],
      stateMachine: "状態遷移",
      states: ["idle", "waiting", "challenge", "posting", "posted"],
    },
    commands: {
      kicker: "// コマンド",
      items: [
        ["init", "既定のオプションを書き込みます。scheduler は起動しません。"],
        ["status", "今の状態、次回発火、最後の gist URL を確認します。"],
        ["start", "target session を固定して scheduler を起動します。"],
        ["once", "その場で 1 回だけ challenge を発火します。"],
        ["skip", "進行中の challenge を 1 回だけ飛ばします。"],
        ["stop", "scheduler を停止します。投稿もしません。"],
        ["post-now", "儀式を飛ばして今すぐ gist を投稿します。"],
      ],
    },
    install: {
      kicker: "// 導入",
      title: ["3行。", "1つの binary。", "あとは scheduler を起こすだけ。"],
      lede: "TPM プラグインとして導入できますが、中身は Rust 製の CLI です。binary を 1 度入れれば動きます。",
      steps: [
        {
          number: "1.",
          title: "binary をインストールする",
          blocks: [
            { id: "cargo", prompt: "$", code: INSTALL_CMD, note: "rustc 1.74 以降と、PATH の通った `gh` が必要です" },
          ],
        },
        {
          number: "2.",
          title: <>`~/.tmux.conf` に追加する</>,
          blocks: [
            { id: "tpm", prompt: "", code: TPM_PLUGIN_LINE, note: "その後 prefix + I で TPM から取得します" },
          ],
        },
        {
          number: "3.",
          title: "gh 認証後に起動する",
          blocks: [
            { id: "gh", prompt: "$", code: "gh auth login" },
            { id: "start", prompt: "$", code: "tmux-real start", note: "実行した client の session が target になります" },
          ],
        },
      ],
      copied: "copied",
      copy: "copy",
      configKicker: "// 設定",
      configLead: () => <>tmux のグローバルオプション <code>@tmux-real-*</code> で挙動を上書きできます。</>,
      configValues: {
        sessions: "prod, staging",
      },
    },
    footer: {
      note: "",
    },
    tweaks: {
      accentSection: "Accent",
      colorLabel: "色",
      vibeSection: "見た目",
      scanlines: "CRT scanlines",
      bootBanner: "Boot banner",
      densityLabel: "密度",
      demoSection: "Demo",
      speedLabel: "速度",
      accentOptions: {
        lime: "lime",
        cyan: "cyan",
        amber: "amber",
        magenta: "mag",
      },
      densityOptions: {
        compact: "compact",
        regular: "regular",
        comfy: "comfy",
      },
      speedOptions: {
        slow: "slow",
        normal: "normal",
        fast: "fast",
      },
    },
  },
};

function HeroTerminal({ accent, scanlines, demoSpeed, copy }) {
  const [lines, setLines] = useState([]);
  const [remaining, setRemaining] = useState(120);
  const [barProgress, setBarProgress] = useState(1);
  const [stage, setStage] = useState(STAGE_PROMPT);
  const [restartKey, setRestartKey] = useState(0);
  const scrollRef = useRef(null);
  const speed = demoSpeed === "fast" ? 0.35 : demoSpeed === "slow" ? 1.2 : 0.6;

  useEffect(() => {
    let cancelled = false;
    const timers = [];
    const at = (ms, fn) => timers.push(setTimeout(() => {
      if (!cancelled) fn();
    }, ms * speed));

    setLines([]);
    setStage(STAGE_PROMPT);
    setRemaining(120);
    setBarProgress(1);

    const now = new Date();
    const deadline = new Date(now.getTime() + 120_000);
    const target = "dev";
    const push = (line) => setLines((current) => [...current, ...(Array.isArray(line) ? line : [line])]);

    at(120, () => push({ k: "prompt", text: "tmux-real start" }));
    at(380, () => push([
      { k: "ok", text: copy.demo.tmuxDetected },
      { k: "ok", text: copy.demo.ghAuth },
      { k: "ok", text: copy.demo.schedulerStarted },
      { k: "dim", text: copy.demo.nextChallengeAt(fmtRFC3339(new Date(now.getTime() + 600_000))) },
    ]));
    at(900, () => push({ k: "dim", text: copy.demo.waiting }));

    at(1500, () => {
      setStage(STAGE_CHALLENGE);
      push({ k: "banner", text: copy.demo.banner({ target, deadline: fmtRFC3339(deadline) }) });
    });

    at(1700, () => {
      const start = Date.now();
      const tick = () => {
        if (cancelled) return;
        const elapsed = (Date.now() - start) / (1500 * speed);
        const value = Math.max(30, 120 - elapsed * 90);
        setRemaining(Math.ceil(value));
        setBarProgress(value / 120);
        if (value > 30) {
          requestAnimationFrame(tick);
        } else {
          setRemaining(30);
          setBarProgress(30 / 120);
        }
      };
      tick();
    });

    at(2100, () => push({ k: "tick", text: copy.demo.remaining({ target, seconds: 60 }) }));

    at(3300, () => {
      setStage(STAGE_WARN_30);
      push({ k: "warn", text: copy.demo.remaining({ target, seconds: 30 }) });
    });

    at(3400, () => {
      const start = Date.now();
      const tick = () => {
        if (cancelled) return;
        const elapsed = (Date.now() - start) / (1100 * speed);
        const value = Math.max(10, 30 - elapsed * 20);
        setRemaining(Math.ceil(value));
        setBarProgress(value / 120);
        if (value > 10) {
          requestAnimationFrame(tick);
        } else {
          setRemaining(10);
          setBarProgress(10 / 120);
        }
      };
      tick();
    });

    at(4600, () => {
      setStage(STAGE_WARN_10);
      push({ k: "warn", text: copy.demo.remaining({ target, seconds: 10 }) });
    });

    at(4800, () => setStage(STAGE_FINAL));
    [5, 4, 3, 2, 1].forEach((seconds, index) => {
      at(5000 + index * 700, () => {
        setRemaining(seconds);
        setBarProgress(seconds / 120);
        push({ k: "warn", text: copy.demo.remaining({ target, seconds }) });
      });
    });

    at(8500, () => {
      setRemaining(0);
      setBarProgress(0);
      setStage(STAGE_TIMEOUT);
      push({ k: "alert", text: copy.demo.timeoutReached({ target }) });
    });

    at(9100, () => {
      setStage(STAGE_POSTING);
      push([
        { k: "dim", text: copy.demo.capture1 },
        { k: "dim", text: copy.demo.capture2 },
        { k: "dim", text: copy.demo.capture3 },
        { k: "dim", text: copy.demo.redact },
        { k: "dim", text: copy.demo.gistCreate },
      ]);
    });

    at(10500, () => {
      setStage(STAGE_POSTED);
      push([
        { k: "ok", text: copy.demo.posted },
        { k: "prompt", text: "" },
      ]);
    });

    at(15500, () => setRestartKey((value) => value + 1));

    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, [copy, restartKey, speed]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines]);

  const onSkip = () => {
    if (stage === STAGE_POSTING || stage === STAGE_POSTED) return;
    setLines((current) => [
      ...current,
      { k: "prompt", text: "tmux-real skip" },
      { k: "ok", text: copy.demo.skipMessage },
      { k: "dim", text: copy.demo.skipFollowup },
    ]);
    setStage(STAGE_PROMPT);
    setTimeout(() => setRestartKey((value) => value + 1), 2200);
  };

  const a = ACCENTS[accent] || ACCENTS.lime;
  const digitColor =
    stage === STAGE_TIMEOUT || stage === STAGE_POSTING || stage === STAGE_POSTED ? "#fb7185"
      : stage === STAGE_FINAL ? "#fb7185"
      : stage === STAGE_WARN_10 ? "#fbbf24"
      : stage === STAGE_WARN_30 ? "#fbbf24"
      : a.hex;

  return (
    <div className="term" data-scan={scanlines ? "on" : "off"}>
      <div className="term-chrome">
        <span className="dot" style={{ background: "#ff5f57" }}></span>
        <span className="dot" style={{ background: "#febc2e" }}></span>
        <span className="dot" style={{ background: "#28c840" }}></span>
        <span className="term-title">tmux — dev:1 — 122×34</span>
        <span className="term-meta" style={{ color: a.hex }}>● rec</span>
      </div>

      <div className="term-body">
        <div className="term-stream" ref={scrollRef}>
          {lines.map((line, index) => <TermLine key={index} line={line} accent={a} promptUser={copy.demo.promptUser} />)}
        </div>

        {(stage === STAGE_CHALLENGE || stage === STAGE_WARN_30 || stage === STAGE_WARN_10 || stage === STAGE_FINAL) && (
          <div className="hud">
            <div className="hud-label" style={{ color: a.hex }}>{copy.demo.hudLabel}</div>
            <div className="hud-row">
              <div className="hud-digits" style={{ color: digitColor, textShadow: `0 0 24px ${digitColor}55` }}>
                {String(Math.floor(remaining / 60)).padStart(2, "0")}<span className="colon">:</span>{String(remaining % 60).padStart(2, "0")}
              </div>
              <div className="hud-actions">
                <button className="hud-btn skip" onClick={onSkip}>
                  <kbd>tmux-real skip</kbd>
                </button>
                <button
                  className="hud-btn stop"
                  onClick={() => {
                    setLines((current) => [
                      ...current,
                      { k: "prompt", text: "tmux-real stop" },
                      { k: "ok", text: copy.demo.stopMessage },
                    ]);
                    setStage(STAGE_PROMPT);
                    setTimeout(() => setRestartKey((value) => value + 1), 2400);
                  }}
                >
                  <kbd>tmux-real stop</kbd>
                </button>
              </div>
            </div>
            <div className="hud-bar">
              <div
                className="hud-bar-fill"
                style={{
                  transform: `scaleX(${barProgress})`,
                  background: digitColor,
                  boxShadow: `0 0 12px ${digitColor}88`,
                }}
              />
            </div>
          </div>
        )}

        {stage === STAGE_POSTING && (
          <div className="hud posting">
            <div className="hud-label" style={{ color: "#fb7185" }}>{copy.demo.postingLabel}</div>
            <div className="hud-spinner">
              <span /><span /><span /><span /><span />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function TermLine({ line, accent, promptUser }) {
  if (line.k === "prompt") {
    return (
      <div className="ln">
        <span className="psn" style={{ color: accent.hex }}>{promptUser}</span>
        <span className="psd"> ~/code/tmux-real </span>
        <span className="pst" style={{ color: accent.hex }}>$ </span>
        <span className="cmd">{line.text}</span>
        {line.text === "" && <span className="caret" style={{ background: accent.hex }} />}
      </div>
    );
  }
  if (line.k === "ok") return <div className="ln ok">{line.text}</div>;
  if (line.k === "dim") return <div className="ln dim">{line.text}</div>;
  if (line.k === "warn") return <div className="ln warn">{line.text}</div>;
  if (line.k === "alert") return <div className="ln alert">{line.text}</div>;
  if (line.k === "tick") return <div className="ln tick" style={{ color: accent.hex }}>{line.text}</div>;
  if (line.k === "banner") {
    return (
      <div className="banner" style={{ borderColor: `${accent.hex}55`, background: accent.soft, color: accent.hex }}>
        {line.text}
      </div>
    );
  }
  return <div className="ln">{line.text}</div>;
}

function SectionHeadline({ kicker, title, lede, accent }) {
  return (
    <div className="section-head">
      <div className="kicker" style={{ color: accent.hex }}>{kicker}</div>
      <h2>
        {title[0]}
        <br />
        {title[1]}
        <br />
        {title[2]}
      </h2>
      <p className="lede">{lede}</p>
    </div>
  );
}

function HowItWorks({ accent, copy }) {
  const a = ACCENTS[accent] || ACCENTS.lime;
  return (
    <section className="hiw">
      <SectionHeadline kicker={copy.how.kicker} title={copy.how.title} lede={copy.how.lede} accent={a} />

      <ol className="hiw-grid">
        {copy.how.steps.map((step, index) => (
          <li key={step.n} className="hiw-card">
            <div className="hiw-card-top">
              <span className="hiw-num" style={{ color: a.hex }}>{step.n}</span>
              <span className="hiw-glyph" style={{ color: a.hex, textShadow: `0 0 18px ${a.glow}` }}>{step.glyph}</span>
            </div>
            <div className="hiw-title">{step.title}</div>
            <div className="hiw-sub" style={{ color: a.hex }}>{step.sub}</div>
            <p className="hiw-body">{step.body}</p>
            {index < copy.how.steps.length - 1 && <span className="hiw-arrow" style={{ color: a.hex }}>→</span>}
          </li>
        ))}
      </ol>

      <div className="state-rail">
        <div className="rail-label">{copy.how.stateMachine}</div>
        <div className="rail-track">
          {copy.how.states.map((state, index, all) => (
            <React.Fragment key={state}>
              <span
                className={`rail-node ${state === "challenge" ? "rail-active" : ""}`}
                style={state === "challenge" ? { background: a.hex, color: "#0a0a0a", boxShadow: `0 0 24px ${a.glow}` } : {}}
              >
                {state}
              </span>
              {index < all.length - 1 && <span className="rail-edge" style={{ background: `${a.hex}33` }} />}
            </React.Fragment>
          ))}
        </div>
      </div>
    </section>
  );
}

function Install({ accent, copy }) {
  const a = ACCENTS[accent] || ACCENTS.lime;
  const [copied, setCopied] = useState(null);

  const copyText = (text, key) => {
    navigator.clipboard?.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 1400);
  };

  const Block = ({ block }) => (
    <div className="cmd-block" onClick={() => copyText(block.code, block.id)}>
      <div className="cmd-line">
        {block.prompt && <span className="cmd-prompt" style={{ color: a.hex }}>{block.prompt} </span>}
        <span className="cmd-code">{block.code}</span>
      </div>
      <button className="copy-btn" aria-label={copy.install.copy}>
        {copied === block.id ? <span style={{ color: a.hex }}>{copy.install.copied}</span> : <span>{copy.install.copy}</span>}
      </button>
      {block.note && <div className="cmd-note">{block.note}</div>}
    </div>
  );

  return (
    <section className="install">
      <SectionHeadline kicker={copy.install.kicker} title={copy.install.title} lede={copy.install.lede} accent={a} />

      <div className="install-grid">
        {copy.install.steps.map((step) => (
          <div key={step.number} className="install-step">
            <div className="step-n" style={{ color: a.hex }}>{step.number}</div>
            <div className="step-h">{step.title}</div>
            {step.blocks.map((block) => <Block key={block.id} block={block} />)}
          </div>
        ))}
      </div>

      <div className="config">
        <div className="config-h">
          <span className="kicker" style={{ color: a.hex }}>{copy.install.configKicker}</span>
          <span>{copy.install.configLead()}</span>
        </div>
        <div className="config-grid">
          <ConfigRow k="@tmux-real-interval-minutes" v="60" a={a} />
          <ConfigRow k="@tmux-real-jitter-minutes" v="15" a={a} />
          <ConfigRow k="@tmux-real-grace-seconds" v="120" a={a} />
          <ConfigRow k="@tmux-real-redact-patterns" v="ghp_[A-Za-z0-9]+ || AIza[0-9A-Za-z_-]+" a={a} />
          <ConfigRow k="@tmux-real-exclude-sessions" v={copy.install.configValues.sessions} a={a} />
          <ConfigRow k="@tmux-real-exclude-panes" v="%1, %8" a={a} />
        </div>
      </div>
    </section>
  );
}

function ConfigRow({ k, v, a }) {
  return (
    <div className="cfg-row">
      <code className="cfg-k">{k}</code>
      <span className="cfg-eq" style={{ color: a.hex }}>=</span>
      <code className="cfg-v">{v}</code>
    </div>
  );
}

function CommandsStrip({ accent, copy }) {
  const a = ACCENTS[accent] || ACCENTS.lime;
  return (
    <section className="cmds">
      <div className="kicker" style={{ color: a.hex }}>{copy.commands.kicker}</div>
      <div className="cmds-grid">
        {copy.commands.items.map(([command, description]) => (
          <div className="cmd-pill" key={command}>
            <span className="cmd-pill-c" style={{ color: a.hex }}>tmux-real {command}</span>
            <span className="cmd-pill-d">{description}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function App() {
  const locale = resolveLocale();
  const copy = COPY[locale] || COPY.en;
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const a = ACCENTS[t.accent] || ACCENTS.lime;

  useEffect(() => {
    const root = document.documentElement;
    root.lang = locale;
    root.style.setProperty("--accent", a.hex);
    root.style.setProperty("--accent-soft", a.soft);
    root.style.setProperty("--accent-glow", a.glow);
    root.dataset.density = t.density;
    root.dataset.scan = t.scanlines ? "on" : "off";
    document.title = copy.meta.title;
    const metaDescription = document.querySelector('meta[name="description"]');
    if (metaDescription) {
      metaDescription.setAttribute("content", copy.meta.description);
    }
  }, [a, copy.meta.description, copy.meta.title, locale, t.density, t.scanlines]);

  return (
    <div className="page">
      {t.scanlines && <div className="scan-overlay" aria-hidden="true" />}
      <div className="grid-bg" aria-hidden="true" />

      <header className="topbar">
        <div className="brand">
          <span className="brand-glyph" style={{ color: a.hex, textShadow: `0 0 14px ${a.glow}` }}>▣</span>
          <span className="brand-name">tmux-real</span>
          <span className="brand-ver">v0.1.0 · MVP</span>
        </div>
        <nav className="nav">
          <a href="#how">{copy.nav.how}</a>
          <a href="#install">{copy.nav.install}</a>
          <a href="#commands">{copy.nav.commands}</a>
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="nav-cta"
            style={{ borderColor: `${a.hex}66`, color: a.hex }}
          >
            {copy.nav.github}
          </a>
        </nav>
      </header>

      <main>
        <section className="hero">
          <div className="hero-shell">
            <div className="hero-left">
              {t.showBootBanner && (
                <div className="boot-banner" style={{ borderColor: `${a.hex}44` }}>
                  <span style={{ color: a.hex }}>●</span>
                  <span>{copy.hero.banner}</span>
                </div>
              )}
              <h1 className="title">
                {locale === "ja" ? (
                  <>
                    {copy.hero.titleLead}
                    <br />
                    <span className="title-accent" style={{ color: a.hex, textShadow: `0 0 28px ${a.glow}` }}>{copy.hero.titleAccent}</span>
                    <br />
                    {copy.hero.titleTail}
                  </>
                ) : (
                  <>
                    {copy.hero.titleLead} <span className="title-accent" style={{ color: a.hex, textShadow: `0 0 28px ${a.glow}` }}>{copy.hero.titleAccent}</span>
                    <br />
                    {copy.hero.titleTail}
                  </>
                )}
              </h1>
              <p className="sub">{copy.hero.subtitle()}</p>
              <div className="hero-cta">
                <a
                  href={REPO_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="cta-primary"
                  style={{ background: a.hex, boxShadow: `0 0 0 1px ${a.hex}, 0 12px 40px ${a.glow}` }}
                >
                  {copy.hero.primaryCta}
                </a>
                <a href="#how" className="cta-secondary">{copy.hero.secondaryCta}</a>
              </div>
              <ul className="hero-stats">
                {copy.hero.stats.map(([value, label]) => (
                  <li key={label}>
                    <b style={{ color: a.hex }}>{value}</b>
                    <span>{label}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="hero-right">
              <HeroTerminal accent={t.accent} scanlines={t.scanlines} demoSpeed={t.demoSpeed} copy={copy} />
            </div>
          </div>
        </section>

        <section id="how"><HowItWorks accent={t.accent} copy={copy} /></section>
        <section id="commands"><CommandsStrip accent={t.accent} copy={copy} /></section>
        <section id="install"><Install accent={t.accent} copy={copy} /></section>

        <footer className="foot">
          <div className="foot-l">
            <span className="brand-glyph" style={{ color: a.hex }}>▣</span>
            <span>tmux-real</span>
            {copy.footer.note && <span className="foot-dim">{copy.footer.note}</span>}
          </div>
          <div className="foot-r">
            <a href={REPO_URL} target="_blank" rel="noreferrer" className="foot-dim">github.com/conao3/tmux-real</a>
          </div>
        </footer>
      </main>

      <TweaksPanel>
        <TweakSection label={copy.tweaks.accentSection} />
        <TweakRadio
          label={copy.tweaks.colorLabel}
          value={t.accent}
          options={[
            { value: "lime", label: copy.tweaks.accentOptions.lime },
            { value: "cyan", label: copy.tweaks.accentOptions.cyan },
            { value: "amber", label: copy.tweaks.accentOptions.amber },
            { value: "magenta", label: copy.tweaks.accentOptions.magenta },
          ]}
          onChange={(value) => setTweak("accent", value)}
        />
        <TweakSection label={copy.tweaks.vibeSection} />
        <TweakToggle label={copy.tweaks.scanlines} value={t.scanlines} onChange={(value) => setTweak("scanlines", value)} />
        <TweakToggle label={copy.tweaks.bootBanner} value={t.showBootBanner} onChange={(value) => setTweak("showBootBanner", value)} />
        <TweakRadio
          label={copy.tweaks.densityLabel}
          value={t.density}
          options={[
            { value: "compact", label: copy.tweaks.densityOptions.compact },
            { value: "regular", label: copy.tweaks.densityOptions.regular },
            { value: "comfy", label: copy.tweaks.densityOptions.comfy },
          ]}
          onChange={(value) => setTweak("density", value)}
        />
        <TweakSection label={copy.tweaks.demoSection} />
        <TweakRadio
          label={copy.tweaks.speedLabel}
          value={t.demoSpeed}
          options={[
            { value: "slow", label: copy.tweaks.speedOptions.slow },
            { value: "normal", label: copy.tweaks.speedOptions.normal },
            { value: "fast", label: copy.tweaks.speedOptions.fast },
          ]}
          onChange={(value) => setTweak("demoSpeed", value)}
        />
      </TweaksPanel>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
