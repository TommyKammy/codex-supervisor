import { renderSetupBrowserScript } from "./webui-setup-browser-script";

export function renderSupervisorSetupPage(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>codex-supervisor setup</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f6f0e6;
        --panel: rgba(255, 251, 245, 0.94);
        --border: rgba(61, 45, 29, 0.14);
        --text: #241c15;
        --muted: #6b5e4f;
        --accent: #7e5c12;
        --accent-strong: #5c420d;
        --shadow: 0 18px 50px rgba(62, 43, 18, 0.12);
        font-family: "IBM Plex Sans", "Avenir Next", "Segoe UI", sans-serif;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        min-height: 100vh;
        color: var(--text);
        background:
          radial-gradient(circle at top left, rgba(126, 92, 18, 0.14), transparent 35%),
          linear-gradient(180deg, var(--bg) 0%, #fbf7f1 100%);
      }

      .shell {
        width: min(1080px, calc(100vw - 32px));
        margin: 0 auto;
        padding: 28px 0 40px;
      }

      .hero,
      .panel {
        border: 1px solid var(--border);
        border-radius: 24px;
        background: var(--panel);
        box-shadow: var(--shadow);
      }

      .hero {
        display: grid;
        gap: 14px;
        padding: 28px;
      }

      .hero h1 {
        margin: 0;
        font-family: "Iowan Old Style", "Palatino Linotype", serif;
        font-size: clamp(2rem, 4vw, 3.2rem);
        line-height: 0.96;
        letter-spacing: -0.04em;
      }

      .hero p,
      .hint {
        margin: 0;
        color: var(--muted);
      }

      .hero a {
        color: var(--accent-strong);
      }

      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
        gap: 16px;
        margin-top: 18px;
      }

      .panel {
        overflow: hidden;
      }

      .panel-header {
        padding: 18px 20px 10px;
      }

      .panel-header h2 {
        margin: 0;
        font-size: 1rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }

      .panel-body {
        padding: 0 20px 20px;
      }

      .metric {
        font-size: 1.8rem;
        font-weight: 700;
      }

      .row {
        display: grid;
        gap: 6px;
      }

      .row + .row {
        margin-top: 14px;
      }

      .row-label {
        color: var(--muted);
        font-size: 0.85rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }

      .list {
        margin: 0;
        padding-left: 18px;
      }

      .list li + li {
        margin-top: 6px;
      }

      @media (max-width: 720px) {
        .shell {
          width: min(100vw - 20px, 1080px);
          padding-top: 20px;
        }

        .hero,
        .panel-header,
        .panel-body {
          padding-left: 16px;
          padding-right: 16px;
        }
      }
    </style>
  </head>
  <body>
    <main class="shell" data-setup-root>
      <section class="hero">
        <div>
          <h1>First-run setup</h1>
          <p>
            This setup shell is driven by the typed <code>/api/setup-readiness</code> contract so initial configuration
            guidance stays separate from the steady-state operator dashboard.
          </p>
        </div>
        <p class="hint">When setup is complete, continue to <a href="/dashboard">/dashboard</a>.</p>
      </section>

      <section class="grid" aria-label="setup-overview">
        <article class="panel">
          <div class="panel-header">
            <h2>Readiness</h2>
          </div>
          <div class="panel-body">
            <div id="setup-overall-status" class="metric">loading</div>
            <div class="row">
              <div class="row-label">Summary</div>
              <p id="setup-summary" class="hint">Loading /api/setup-readiness…</p>
            </div>
          </div>
        </article>

        <article class="panel">
          <div class="panel-header">
            <h2>Provider posture</h2>
          </div>
          <div class="panel-body">
            <p id="setup-provider-posture" class="hint">Loading typed provider posture…</p>
          </div>
        </article>

        <article class="panel">
          <div class="panel-header">
            <h2>Trust posture</h2>
          </div>
          <div class="panel-body">
            <p id="setup-trust-posture" class="hint">Loading typed trust posture…</p>
          </div>
        </article>
      </section>

      <section class="grid" aria-label="setup-details">
        <article class="panel">
          <div class="panel-header">
            <h2>Blockers</h2>
          </div>
          <div class="panel-body">
            <ul id="setup-blockers" class="list">
              <li>Loading typed blockers…</li>
            </ul>
          </div>
        </article>

        <article class="panel">
          <div class="panel-header">
            <h2>Config fields</h2>
          </div>
          <div class="panel-body">
            <ul id="setup-fields" class="list">
              <li>Loading typed field readiness…</li>
            </ul>
          </div>
        </article>

        <article class="panel">
          <div class="panel-header">
            <h2>Host checks</h2>
          </div>
          <div class="panel-body">
            <ul id="setup-host-checks" class="list">
              <li>Loading typed host checks…</li>
            </ul>
          </div>
        </article>
      </section>
    </main>
    <script>${renderSetupBrowserScript()}</script>
  </body>
</html>`;
}
