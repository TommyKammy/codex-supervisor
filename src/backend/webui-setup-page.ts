import { renderSetupBrowserScript } from "./webui-setup-browser-script";

function renderSetupNavigation(): string {
  return `<nav class="side-nav-card" aria-label="setup navigation">
          <div class="side-nav-section">
            <p class="eyebrow">Flow</p>
            <a class="side-nav-link" href="#setup-progress"><span class="side-nav-icon" aria-hidden="true"><svg viewBox="0 0 16 16" focusable="false"><path d="M3 3.5h10v2H3zm0 3.5h10v2H3zm0 3.5h6v2H3z"/></svg></span><span>Progress &amp; blockers</span></a>
            <a class="side-nav-link" href="#setup-guided-config"><span class="side-nav-icon" aria-hidden="true"><svg viewBox="0 0 16 16" focusable="false"><path d="M3 2.5h10v11H3zm2 2v1h6v-1zm0 3v1h6v-1zm0 3v1h4v-1z"/></svg></span><span>Guided config</span></a>
            <a class="side-nav-link" href="#setup-diagnostics"><span class="side-nav-icon" aria-hidden="true"><svg viewBox="0 0 16 16" focusable="false"><path d="M8 2.5l5 2v4c0 2.9-2.1 4.7-5 5.5-2.9-.8-5-2.6-5-5.5v-4zm0 2.1L5 5.7v2.8c0 1.8 1.2 3.1 3 3.8 1.8-.7 3-2 3-3.8V5.7zM7.2 7h1.6v2.2H7.2zm0 2.8h1.6v1.2H7.2z"/></svg></span><span>Diagnostics</span></a>
          </div>
          <div class="side-nav-section">
            <p class="eyebrow">Steady state</p>
            <a class="side-nav-link" href="/dashboard"><span class="side-nav-icon" aria-hidden="true"><svg viewBox="0 0 16 16" focusable="false"><path d="M2.5 3h11v10h-11zm2 2v2h2V5zm0 4v2h2V9zm4-4v6h3V5z"/></svg></span><span>Operator dashboard</span></a>
          </div>
        </nav>`;
}

function renderSetupFooter(): string {
  return `<footer class="dashboard-footer">
          <div class="footer-path-group">
            <span class="eyebrow">Local path</span>
            <code id="repo-path-value" class="context-path">Not configured yet</code>
          </div>
          <div class="footer-path-group">
            <span class="eyebrow">Workspace root</span>
            <code id="workspace-root-value" class="context-path">Not configured yet</code>
          </div>
        </footer>`;
}

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
        --frame-header-height: 74px;
        --sidebar-width: 236px;
        --bg: #f3f5f8;
        --surface: #ffffff;
        --surface-soft: #f7fafc;
        --surface-muted: #eef3f7;
        --border: #dfe6ee;
        --border-strong: #c8d3df;
        --text: #233647;
        --muted: #5f7288;
        --accent: #1abb9c;
        --accent-strong: #169f84;
        --ok: #1d8f74;
        --warn: #c58b1a;
        --danger: #d9534f;
        --shadow-sm: 0 1px 3px rgba(15, 23, 42, 0.06);
        --shadow-md: 0 12px 28px rgba(15, 23, 42, 0.08);
        --radius-lg: 22px;
        --radius-md: 16px;
        --radius-sm: 12px;
        font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif;
      }

      * {
        box-sizing: border-box;
      }

      html {
        scroll-behavior: smooth;
      }

      body {
        margin: 0;
        min-height: 100vh;
        color: var(--text);
        background:
          radial-gradient(circle at top right, rgba(26, 187, 156, 0.08), transparent 24%),
          linear-gradient(180deg, #f8fbfd 0%, var(--bg) 100%);
      }

      a {
        color: inherit;
      }

      .page-shell {
        min-height: 100vh;
      }

      .app-layout {
        display: grid;
        grid-template-columns: var(--sidebar-width) minmax(0, 1fr);
        align-items: start;
        min-height: calc(100vh - var(--frame-header-height));
      }

      .side-nav {
        position: sticky;
        top: var(--frame-header-height);
        align-self: start;
        height: calc(100vh - var(--frame-header-height));
      }

      .side-nav-card {
        display: grid;
        gap: 16px;
        height: 100%;
        padding: 24px 20px 28px;
        border-right: 1px solid rgba(200, 211, 223, 0.72);
        background: rgba(255, 255, 255, 0.84);
        backdrop-filter: blur(14px);
      }

      .side-nav-section,
      .page-stack,
      .section-block,
      .section-header,
      .panel-shell,
      .panel-body,
      .row,
      .stack,
      .detail-stack,
      .hero-copy,
      .hero-meta,
      .checklist-grid,
      .field-editor {
        display: grid;
        gap: 12px;
      }

      .side-nav-link {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 12px;
        border: 1px solid transparent;
        border-radius: 10px;
        text-decoration: none;
        background: transparent;
      }

      .side-nav-link:hover {
        border-color: var(--border);
        background: var(--surface-soft);
      }

      .side-nav-icon {
        display: inline-grid;
        place-items: center;
        width: 18px;
        height: 18px;
        color: var(--muted);
        flex: 0 0 auto;
      }

      .side-nav-icon svg {
        width: 16px;
        height: 16px;
        fill: currentColor;
      }

      .masthead {
        position: sticky;
        top: 0;
        z-index: 40;
        border-bottom: 1px solid rgba(200, 211, 223, 0.72);
        background: rgba(248, 251, 253, 0.92);
        backdrop-filter: blur(14px);
      }

      .masthead-bar,
      .panel,
      .hero-panel {
        border: 1px solid var(--border);
        border-radius: var(--radius-md);
        background: var(--surface);
        box-shadow: var(--shadow-sm);
      }

      .masthead-bar {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        align-items: center;
        gap: 14px;
        min-height: var(--frame-header-height);
        padding: 14px 28px;
        border: 0;
        border-radius: 0;
        box-shadow: none;
        background: transparent;
      }

      .masthead-brand {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 10px;
      }

      .masthead-brand-icon {
        display: inline-grid;
        place-items: center;
        width: 30px;
        height: 30px;
        border-radius: 10px;
        background: rgba(26, 187, 156, 0.12);
        color: var(--accent-strong);
        font-weight: 700;
      }

      .masthead-brand-name {
        font-size: 1rem;
        font-weight: 700;
        letter-spacing: -0.02em;
      }

      .masthead-divider {
        color: var(--border-strong);
      }

      .masthead-repo {
        font-size: 0.98rem;
        font-weight: 700;
      }

      .masthead-meta,
      .hero-chip-row,
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        align-items: center;
      }

      .page-stack {
        min-width: 0;
        padding: 34px 36px 40px;
      }

      .hero-panel {
        padding: 28px;
        background:
          linear-gradient(135deg, rgba(255, 255, 255, 0.98), rgba(247, 250, 252, 0.94)),
          radial-gradient(circle at top right, rgba(26, 187, 156, 0.12), transparent 32%);
      }

      .hero-layout {
        display: grid;
        grid-template-columns: minmax(0, 1.6fr) minmax(260px, 0.9fr);
        gap: 22px;
        align-items: start;
      }

      .hero-copy h1,
      .section-header h2 {
        margin: 0;
        letter-spacing: -0.03em;
      }

      .hero-copy h1 {
        font-size: clamp(2rem, 3.6vw, 3rem);
        line-height: 1.04;
      }

      .hero-copy p,
      .section-lead,
      .hint,
      .panel-subtitle,
      .status-note,
      .checklist-item__meta,
      .checklist-item__note,
      .field-editor__hint {
        margin: 0;
        color: var(--muted);
        line-height: 1.55;
      }

      .hero-meta {
        align-content: start;
      }

      .hero-note {
        padding: 14px 16px;
        border: 1px solid var(--border);
        border-radius: var(--radius-sm);
        background: var(--surface-soft);
      }

      .eyebrow,
      .section-kicker,
      .row-label,
      .panel-header h2 {
        margin: 0;
        font-size: 0.72rem;
        font-weight: 700;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: var(--muted);
      }

      .topbar-pill,
      .status-chip {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        border: 1px solid var(--border);
        border-radius: 999px;
        background: var(--surface-soft);
        color: var(--text);
        font-size: 0.86rem;
      }

      .status-chip--danger {
        border-color: rgba(217, 83, 79, 0.2);
        background: rgba(217, 83, 79, 0.1);
        color: #9f352f;
      }

      .status-chip--ok {
        border-color: rgba(29, 143, 116, 0.18);
        background: rgba(29, 143, 116, 0.1);
        color: #176f5a;
      }

      .section-block {
        scroll-margin-top: calc(var(--frame-header-height) + 18px);
      }

      .section-header {
        margin-bottom: 4px;
      }

      .workflow-grid,
      .diagnostics-grid {
        display: grid;
        grid-template-columns: repeat(12, minmax(0, 1fr));
        gap: 16px;
      }

      .panel {
        overflow: hidden;
      }

      .panel-shell {
        padding: 20px;
      }

      .panel--critical {
        border-color: rgba(217, 83, 79, 0.18);
        background:
          linear-gradient(180deg, rgba(255, 245, 245, 0.98), rgba(255, 255, 255, 0.98)),
          var(--surface);
      }

      .panel-header {
        display: grid;
        gap: 6px;
      }

      .panel-header p {
        margin: 0;
      }

      .metric {
        font-size: clamp(1.9rem, 4vw, 2.5rem);
        font-weight: 700;
        letter-spacing: -0.04em;
      }

      .metric-caption {
        margin: 0;
        color: var(--muted);
        line-height: 1.5;
      }

      .summary-card {
        grid-column: span 4;
      }

      .blockers-card {
        grid-column: span 8;
      }

      .config-card,
      .fields-card {
        grid-column: span 6;
      }

      .diagnostic-card {
        grid-column: span 4;
      }

      .list {
        margin: 0;
        padding-left: 18px;
      }

      .list--plain {
        list-style: none;
        padding-left: 0;
      }

      .list li + li {
        margin-top: 8px;
      }

      .checklist-item {
        border: 1px solid rgba(200, 211, 223, 0.8);
        border-radius: var(--radius-sm);
        padding: 12px 14px;
        background: var(--surface-soft);
      }

      .checklist-item--blocker {
        border-color: rgba(217, 83, 79, 0.18);
        background: rgba(255, 245, 245, 0.92);
      }

      .checklist-item__title,
      .field-editor__label {
        font-weight: 700;
      }

      .form-grid {
        display: grid;
        gap: 12px;
      }

      .field-editor {
        padding: 14px;
        border: 1px solid rgba(200, 211, 223, 0.86);
        border-radius: var(--radius-sm);
        background: var(--surface-soft);
      }

      .field-editor__input {
        width: 100%;
        border: 1px solid var(--border-strong);
        border-radius: 12px;
        padding: 10px 12px;
        font: inherit;
        color: var(--text);
        background: #fff;
      }

      .field-editor__input:disabled {
        opacity: 0.7;
      }

      .button {
        border: 0;
        border-radius: 999px;
        padding: 12px 18px;
        font: inherit;
        font-weight: 700;
        cursor: pointer;
        color: #fff;
        background: linear-gradient(135deg, var(--accent), var(--accent-strong));
        box-shadow: 0 12px 24px rgba(26, 187, 156, 0.2);
      }

      .button:disabled {
        cursor: progress;
        opacity: 0.72;
      }

      .context-path {
        margin: 0;
        padding: 0;
        border: 0;
        background: transparent;
        color: var(--text);
        font: 0.86rem/1.55 "Consolas", "SFMono-Regular", monospace;
        white-space: pre-wrap;
        word-break: break-word;
      }

      .dashboard-footer {
        display: flex;
        flex-wrap: wrap;
        gap: 18px;
        margin-top: 20px;
        padding-top: 14px;
        border-top: 1px solid var(--border);
        color: var(--muted);
      }

      .footer-path-group {
        display: grid;
        gap: 6px;
        min-width: min(320px, 100%);
      }

      @media (max-width: 1160px) {
        .summary-card,
        .blockers-card,
        .config-card,
        .fields-card,
        .diagnostic-card {
          grid-column: span 12;
        }
      }

      @media (max-width: 980px) {
        .app-layout {
          grid-template-columns: 1fr;
        }

        .side-nav {
          position: static;
          height: auto;
        }

        .masthead-bar {
          padding-inline: 18px;
        }

        .page-stack {
          padding: 24px 18px 28px;
        }

        .hero-layout,
        .workflow-grid,
        .diagnostics-grid {
          grid-template-columns: 1fr;
        }
      }

      @media (prefers-reduced-motion: reduce) {
        *,
        *::before,
        *::after {
          animation-duration: 0.01ms !important;
          animation-iteration-count: 1 !important;
          scroll-behavior: auto !important;
          transition-duration: 0.01ms !important;
        }
      }
    </style>
  </head>
  <body>
    <main class="page-shell" data-setup-root>
      <header class="masthead">
        <div class="masthead-bar">
          <div class="masthead-brand">
            <span class="masthead-brand-icon" aria-hidden="true">C</span>
            <span class="masthead-brand-name">codex-supervisor</span>
            <span class="masthead-divider" aria-hidden="true">|</span>
            <strong class="masthead-repo">First-run setup</strong>
          </div>
          <div class="masthead-meta">
            <div class="topbar-pill">Mode: setup shell</div>
            <div class="topbar-pill">Source: /api/setup-readiness</div>
            <div class="topbar-pill">Destination: /dashboard</div>
          </div>
        </div>
      </header>
      <div class="app-layout">
        <aside class="side-nav">
${renderSetupNavigation()}
        </aside>
        <div class="page-stack">
          <section class="hero-panel" aria-labelledby="setup-page-title">
            <div class="hero-layout">
              <div class="hero-copy">
                <p class="eyebrow">Operator onboarding</p>
                <h1 id="setup-page-title">First-run setup</h1>
                <p>
                  This setup shell uses the same admin frame as the operator dashboard while keeping first-run
                  configuration, blockers, and diagnostics on the typed <code>/api/setup-readiness</code> contract.
                </p>
                <div class="hero-chip-row">
                  <span class="status-chip">1. Review readiness</span>
                  <span class="status-chip">2. Save guided config</span>
                  <span class="status-chip">3. Check diagnostics</span>
                </div>
              </div>
              <div class="hero-meta">
                <div class="hero-note">
                  <p class="eyebrow">Operator handoff</p>
                  <p class="hint">When required setup blockers are gone, continue to <a href="/dashboard">/dashboard</a> for steady-state supervision.</p>
                </div>
                <div class="hero-note">
                  <p class="eyebrow">Write boundary</p>
                  <p class="hint">This page only saves through the narrow setup config API and then revalidates readiness.</p>
                </div>
              </div>
            </div>
          </section>

          <section id="setup-progress" class="section-block" aria-labelledby="setup-progress-heading">
            <div class="section-header">
              <p class="section-kicker">Progress and blockers</p>
              <h2 id="setup-progress-heading">Current setup state</h2>
              <p class="section-lead">Start here to see whether setup is blocked, what is already configured, and what needs attention before the dashboard becomes the primary operator surface.</p>
            </div>
            <div class="workflow-grid">
              <article id="setup-readiness-card" class="panel summary-card">
                <div class="panel-shell">
                  <div class="panel-header">
                    <h2>Readiness</h2>
                    <p class="panel-subtitle">Typed setup summary from the current config.</p>
                  </div>
                  <div class="panel-body">
                    <div id="setup-overall-status" class="metric">loading</div>
                    <p id="setup-overall-caption" class="metric-caption">Loading typed readiness state…</p>
                    <div class="row">
                      <div class="row-label">Summary</div>
                      <p id="setup-summary" class="hint">Loading /api/setup-readiness…</p>
                    </div>
                  </div>
                </div>
              </article>

              <article id="setup-blockers-card" class="panel panel--critical blockers-card">
                <div class="panel-shell">
                  <div class="panel-header">
                    <h2>Blocking setup actions</h2>
                    <p class="panel-subtitle">Required conditions that still keep first-run setup from being complete.</p>
                  </div>
                  <div class="panel-body">
                    <p id="setup-blocker-summary" class="hint">Loading typed blocker summary…</p>
                    <ul id="setup-blockers" class="list list--plain checklist-grid">
                      <li>Loading typed blockers…</li>
                    </ul>
                  </div>
                </div>
              </article>
            </div>
          </section>

          <section id="setup-guided-config" class="section-block" aria-labelledby="setup-guided-config-heading">
            <div class="section-header">
              <p class="section-kicker">Guided config</p>
              <h2 id="setup-guided-config-heading">Edit typed setup inputs</h2>
              <p class="section-lead">Make changes through the narrow setup config API, then compare the editable form against the full field inventory.</p>
            </div>
            <div class="workflow-grid">
              <article class="panel config-card">
                <div class="panel-shell">
                  <div class="panel-header">
                    <h2>Guided config</h2>
                    <p id="setup-form-summary" class="panel-subtitle">Loading typed setup fields…</p>
                  </div>
                  <div class="panel-body">
                    <form id="setup-form">
                      <div id="setup-editors" class="form-grid">
                        <div class="field-editor">
                          <div class="field-editor__label">Loading setup editor…</div>
                        </div>
                      </div>
                      <div class="actions">
                        <button id="setup-save-button" class="button" type="submit">Save setup changes</button>
                        <p id="setup-save-status" class="status-note">Waiting for setup readiness…</p>
                      </div>
                    </form>
                  </div>
                </div>
              </article>

              <article class="panel fields-card">
                <div class="panel-shell">
                  <div class="panel-header">
                    <h2>Post-save status</h2>
                    <p class="panel-subtitle">What changed, whether it is already effective, and what the operator should do next.</p>
                  </div>
                  <div class="panel-body">
                    <div id="setup-restart-status" class="metric">No recent save</div>
                    <p id="setup-restart-details" class="hint">Save typed setup changes to see whether they take effect immediately or require a supervisor restart.</p>
                    <div class="actions">
                      <button id="setup-restart-button" class="button" type="button" disabled>Restart now</button>
                      <p id="setup-restart-guidance" class="status-note">Managed restart becomes available only when this WebUI is running under explicit launcher-backed restart support.</p>
                    </div>
                  </div>
                </div>
              </article>

              <article class="panel fields-card">
                <div class="panel-shell">
                  <div class="panel-header">
                    <h2>Config fields</h2>
                    <p class="panel-subtitle">Full typed field inventory, including optional and non-editable values.</p>
                  </div>
                  <div class="panel-body">
                    <p id="setup-field-summary" class="hint">Loading typed field readiness…</p>
                    <ul id="setup-fields" class="list list--plain checklist-grid">
                      <li>Loading typed field readiness…</li>
                    </ul>
                  </div>
                </div>
              </article>
            </div>
          </section>

          <section id="setup-diagnostics" class="section-block" aria-labelledby="setup-diagnostics-heading">
            <div class="section-header">
              <p class="section-kicker">Diagnostics and posture</p>
              <h2 id="setup-diagnostics-heading">Environment and policy details</h2>
              <p class="section-lead">Review host checks, provider posture, trust posture, and the repo-owned local CI contract after the main blocking config is in place.</p>
            </div>
            <div class="diagnostics-grid">
              <article id="setup-host-checks-card" class="panel diagnostic-card">
                <div class="panel-shell">
                  <div class="panel-header">
                    <h2>Host checks</h2>
                    <p class="panel-subtitle">Environment readiness that affects first-run operation.</p>
                  </div>
                  <div class="panel-body">
                    <p id="setup-host-summary" class="hint">Loading typed host readiness…</p>
                    <ul id="setup-host-checks" class="list list--plain checklist-grid">
                      <li>Loading typed host checks…</li>
                    </ul>
                  </div>
                </div>
              </article>

              <article class="panel diagnostic-card">
                <div class="panel-shell">
                  <div class="panel-header">
                    <h2>Provider posture</h2>
                    <p class="panel-subtitle">Review delivery and configured reviewer state.</p>
                  </div>
                  <div class="panel-body">
                    <p id="setup-provider-posture" class="hint">Loading typed provider posture…</p>
                    <ul id="setup-provider-details" class="list list--plain checklist-grid">
                      <li>Loading provider posture details…</li>
                    </ul>
                  </div>
                </div>
              </article>

              <article class="panel diagnostic-card">
                <div class="panel-shell">
                  <div class="panel-header">
                    <h2>Trust posture</h2>
                    <p class="panel-subtitle">Execution trust mode and safety assumptions.</p>
                  </div>
                  <div class="panel-body">
                    <p id="setup-trust-posture" class="hint">Loading typed trust posture…</p>
                    <ul id="setup-trust-details" class="list list--plain checklist-grid">
                      <li>Loading trust posture details…</li>
                    </ul>
                  </div>
                </div>
              </article>

              <article class="panel diagnostic-card">
                <div class="panel-shell">
                  <div class="panel-header">
                    <h2>Local CI contract</h2>
                    <p class="panel-subtitle">Repo-owned verification contract used before publish or promotion actions.</p>
                  </div>
                  <div class="panel-body">
                    <p id="setup-local-ci-summary" class="hint">Loading typed local CI contract…</p>
                    <div id="setup-local-ci-actions" class="actions">
                      <button id="setup-local-ci-adopt-recommended" class="button" type="button" hidden disabled>Use recommended command</button>
                    </div>
                    <ul id="setup-local-ci-details" class="list list--plain checklist-grid">
                      <li>Loading local CI contract details…</li>
                    </ul>
                  </div>
                </div>
              </article>
            </div>
          </section>

${renderSetupFooter()}
        </div>
      </div>
    </main>
    <script>${renderSetupBrowserScript()}</script>
  </body>
</html>`;
}
