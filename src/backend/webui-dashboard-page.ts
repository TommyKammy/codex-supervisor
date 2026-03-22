import { renderDashboardBrowserScript } from "./webui-dashboard-browser-script";
import { listDashboardPanels } from "./webui-dashboard-panel-layout";

function renderDashboardPanelSection(section: "overview" | "details"): string {
  return listDashboardPanels(section)
    .map((panel) => panel.markup)
    .join("\n");
}

export function renderSupervisorDashboardPage(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>codex-supervisor operator dashboard</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f7f5f2;
        --bg-accent: #ece7df;
        --surface: rgba(255, 255, 255, 0.94);
        --surface-muted: #fbfaf8;
        --surface-strong: #ffffff;
        --border: rgba(40, 35, 28, 0.1);
        --border-strong: rgba(40, 35, 28, 0.16);
        --text: #1f1a17;
        --muted: #6a6156;
        --danger: #a33a2b;
        --warn: #a06712;
        --ok: #24613d;
        --accent: #1d6a74;
        --accent-strong: #154c53;
        --shadow: 0 18px 40px rgba(58, 49, 39, 0.06);
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
          radial-gradient(circle at top left, rgba(29, 106, 116, 0.08), transparent 34%),
          radial-gradient(circle at top right, rgba(160, 103, 18, 0.08), transparent 28%),
          linear-gradient(180deg, var(--bg) 0%, #f3efea 100%);
      }

      .shell {
        width: min(1180px, calc(100vw - 32px));
        margin: 0 auto;
        padding: 24px 0 40px;
      }

      .hero {
        display: grid;
        gap: 20px;
        padding: 28px;
        border: 1px solid var(--border);
        border-radius: 28px;
        background:
          linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(248, 244, 238, 0.98)),
          linear-gradient(135deg, rgba(29, 106, 116, 0.04), rgba(160, 103, 18, 0.04));
        box-shadow: var(--shadow);
      }

      .hero-body {
        display: grid;
        grid-template-columns: minmax(0, 1.35fr) minmax(280px, 0.9fr);
        gap: 20px;
        align-items: start;
      }

      .hero-copy {
        display: grid;
        gap: 12px;
      }

      .hero-eyebrow {
        color: var(--accent);
        font-size: 0.8rem;
        font-weight: 700;
        letter-spacing: 0.12em;
        text-transform: uppercase;
      }

      .hero h1 {
        margin: 0;
        font-family: "Iowan Old Style", "Palatino Linotype", serif;
        font-size: clamp(2.2rem, 4vw, 3.4rem);
        line-height: 0.94;
        letter-spacing: -0.04em;
      }

      .hero p {
        margin: 0;
        max-width: 64ch;
        color: var(--muted);
        font-size: 1rem;
        line-height: 1.6;
      }

      .hero-summary {
        display: grid;
        gap: 12px;
        padding: 18px;
        border: 1px solid var(--border);
        border-radius: 22px;
        background:
          linear-gradient(180deg, rgba(252, 250, 247, 0.98), rgba(247, 243, 237, 0.96));
      }

      .hero-summary-label {
        margin: 0;
        color: var(--muted);
        font-size: 0.76rem;
        font-weight: 700;
        letter-spacing: 0.12em;
        text-transform: uppercase;
      }

      .hero-bar {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
        gap: 10px;
      }

      .badge {
        display: grid;
        gap: 6px;
        min-height: 88px;
        padding: 14px 16px;
        border-radius: 18px;
        border: 1px solid var(--border);
        background: var(--surface-strong);
        color: var(--muted);
        font-size: 0.8rem;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      .badge strong {
        color: var(--text);
        font-size: 1.05rem;
        letter-spacing: -0.01em;
        text-transform: none;
      }

      .dashboard-section {
        display: grid;
        gap: 16px;
        margin-top: 24px;
      }

      .section-header {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        align-items: end;
        justify-content: space-between;
      }

      .section-heading {
        display: grid;
        gap: 6px;
      }

      .section-kicker {
        margin: 0;
        color: var(--accent);
        font-size: 0.8rem;
        font-weight: 700;
        letter-spacing: 0.12em;
        text-transform: uppercase;
      }

      .section-header h2 {
        margin: 0;
        font-size: 1.45rem;
        letter-spacing: -0.03em;
      }

      .section-lead {
        margin: 0;
        max-width: 70ch;
        color: var(--muted);
        font-size: 0.95rem;
        line-height: 1.5;
      }

      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
        gap: 16px;
      }

      .panel {
        border: 1px solid var(--border);
        border-radius: 20px;
        background: var(--surface);
        box-shadow: 0 8px 20px rgba(58, 49, 39, 0.04);
        overflow: hidden;
      }

      .panel-shell {
        display: grid;
        gap: 0;
      }

      .panel-header {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        gap: 12px;
        align-items: flex-start;
        padding: 18px 20px 12px;
        border-bottom: 1px solid rgba(40, 35, 28, 0.08);
        background: linear-gradient(180deg, rgba(250, 247, 242, 0.88), rgba(250, 247, 242, 0.4));
      }

      .panel-header-main {
        display: flex;
        align-items: flex-start;
        gap: 12px;
        min-width: min(320px, 100%);
        flex: 1 1 320px;
      }

      .panel-drag-slot {
        width: 36px;
        min-width: 36px;
        height: 36px;
        border-radius: 12px;
        border: 1px dashed rgba(40, 35, 28, 0.14);
        background:
          linear-gradient(180deg, rgba(255, 255, 255, 0.88), rgba(236, 231, 223, 0.8)),
          repeating-linear-gradient(
            90deg,
            transparent 0,
            transparent 7px,
            rgba(40, 35, 28, 0.07) 7px,
            rgba(40, 35, 28, 0.07) 10px
          );
      }

      .panel-heading {
        display: grid;
        gap: 4px;
      }

      .panel-subtitle {
        margin: 0;
        color: var(--muted);
        font-size: 0.92rem;
        line-height: 1.45;
      }

      .panel-header-aside {
        display: grid;
        gap: 10px;
        justify-items: end;
        flex: 0 1 auto;
        min-width: 0;
      }

      .panel-header-meta,
      .panel-header-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        justify-content: flex-end;
      }

      .panel-header h2 {
        margin: 0;
        font-size: 0.9rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.1em;
      }

      .panel-body {
        padding: 0 20px 20px;
      }

      .panel-empty-state {
        color: var(--muted);
      }

      .metric {
        font-size: 1.8rem;
        font-weight: 700;
      }

      .metric.ok {
        color: var(--ok);
      }

      .metric.warn {
        color: var(--warn);
      }

      .metric.fail {
        color: var(--danger);
      }

      .stack {
        display: grid;
        gap: 10px;
      }

      .row {
        display: grid;
        gap: 6px;
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

      .code,
      pre {
        margin: 0;
        border-radius: 14px;
        padding: 14px;
        background: #1f1d1a;
        color: #f5f1ea;
        overflow: auto;
        font: 0.87rem/1.55 "Iosevka Term", "SFMono-Regular", monospace;
      }

      .toolbar {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        align-items: center;
      }

      .shortcut-list {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 10px;
      }

      .detail-stack {
        display: grid;
        gap: 10px;
      }

      .detail-empty {
        margin: 0;
        border-radius: 14px;
        padding: 14px;
        background: #1f1d1a;
        color: #f5f1ea;
        font: 0.87rem/1.55 "Iosevka Term", "SFMono-Regular", monospace;
      }

      .detail-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 10px;
      }

      .detail-card {
        display: grid;
        gap: 8px;
        padding: 14px;
        border-radius: 16px;
        border: 1px solid var(--border);
        background: var(--surface-strong);
      }

      .detail-card h3 {
        margin: 0;
        font-size: 0.95rem;
      }

      .detail-list {
        display: grid;
        gap: 6px;
      }

      .detail-item {
        color: var(--muted);
        font-size: 0.9rem;
        line-height: 1.45;
      }

      .detail-item strong {
        color: var(--text);
      }

      .shortcut-button {
        width: 100%;
        padding: 12px 14px;
        border-radius: 14px;
        border: 1px solid var(--border);
        background: var(--surface-strong);
        color: var(--text);
        font: inherit;
        text-align: left;
        cursor: pointer;
      }

      .shortcut-button:hover {
        border-color: rgba(15, 108, 120, 0.35);
        background: rgba(255, 255, 255, 0.92);
      }

      .toolbar input {
        min-width: 180px;
        padding: 12px 14px;
        border-radius: 12px;
        border: 1px solid var(--border-strong);
        background: var(--surface-strong);
        color: var(--text);
        font: inherit;
      }

      .toolbar button {
        padding: 12px 16px;
        border: 0;
        border-radius: 12px;
        background: linear-gradient(135deg, var(--accent), var(--accent-strong));
        color: white;
        font: inherit;
        cursor: pointer;
      }

      .toolbar button:hover {
        filter: brightness(1.04);
      }

      .toolbar button:disabled {
        cursor: not-allowed;
        filter: grayscale(0.2);
        opacity: 0.6;
      }

      .panel-header button {
        padding: 10px 14px;
        border: 1px solid var(--border);
        border-radius: 999px;
        background: var(--surface-strong);
        color: var(--text);
        font: inherit;
        cursor: pointer;
      }

      .panel-header button:hover {
        border-color: rgba(15, 108, 120, 0.35);
        background: rgba(255, 255, 255, 0.94);
      }

      .action-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 12px;
      }

      .action-card {
        display: grid;
        gap: 8px;
        padding: 14px;
        border-radius: 16px;
        border: 1px solid var(--border);
        background: var(--surface-muted);
      }

      .action-card strong {
        font-size: 1rem;
      }

      .action-card p {
        margin: 0;
        color: var(--muted);
        font-size: 0.92rem;
      }

      .action-card button {
        justify-self: start;
      }

      .event-list {
        display: grid;
        gap: 10px;
      }

      .event-item {
        padding: 12px 14px;
        border-radius: 14px;
        background: var(--surface-muted);
        border: 1px solid rgba(40, 35, 28, 0.08);
      }

      .event-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        color: var(--muted);
        font-size: 0.82rem;
        margin-bottom: 6px;
      }

      .hint {
        color: var(--muted);
      }

      .danger {
        color: var(--danger);
      }

      @media (max-width: 720px) {
        .shell {
          width: min(100vw - 20px, 1200px);
          padding-top: 20px;
        }

        .hero {
          padding: 22px;
        }

        .hero-body {
          grid-template-columns: 1fr;
        }

        .panel-header,
        .panel-body {
          padding-left: 16px;
          padding-right: 16px;
        }

        .panel-header-aside,
        .panel-header-meta,
        .panel-header-actions {
          justify-items: start;
          justify-content: flex-start;
        }
      }
    </style>
  </head>
  <body>
    <main class="shell" data-dashboard-root>
      <section class="hero">
        <div class="hero-body">
          <div class="hero-copy">
            <p class="hero-eyebrow">Supervisor workspace</p>
            <h1>Operator dashboard</h1>
            <p>
              Supervisor status and safe command transport backed by JSON endpoints and the live SSE stream.
              The command surface stays limited to existing operator-safe mutations.
            </p>
          </div>
          <div class="hero-summary">
            <p class="hero-summary-label">Live operator summary</p>
            <p>
              Read the overview lane first for selection and environment health, then move into operator details
              for issue context, safe commands, and recent events.
            </p>
          </div>
        </div>
        <div class="hero-bar">
          <div class="badge">connection <strong id="connection-state">connecting</strong></div>
          <div class="badge">freshness <strong id="freshness-state">awaiting refresh</strong></div>
          <div class="badge">refresh <strong id="refresh-state">idle</strong></div>
          <div class="badge">selected issue <strong id="selected-issue-badge">none</strong></div>
          <div class="badge">last refresh <strong id="last-refresh-badge">never</strong></div>
        </div>
      </section>

      <section class="dashboard-section" aria-labelledby="overview-heading">
        <div class="section-header">
          <div class="section-heading">
            <p class="section-kicker">Dashboard lane</p>
            <h2 id="overview-heading">Overview</h2>
            <p class="section-lead">Top-level supervisor state, readiness, and environment checks in a compact lane.</p>
          </div>
        </div>
        <div class="grid" aria-label="overview">
${renderDashboardPanelSection("overview")}
        </div>
      </section>

      <section class="dashboard-section" aria-labelledby="details-heading">
        <div class="section-header">
          <div class="section-heading">
            <p class="section-kicker">Dashboard lane</p>
            <h2 id="details-heading">Operator details</h2>
            <p class="section-lead">Issue context, action controls, and event feeds remain intact with cleaner framing.</p>
          </div>
        </div>
        <div class="grid" aria-label="details">
${renderDashboardPanelSection("details")}
        </div>
      </section>
    </main>

    <script>${renderDashboardBrowserScript()}
    </script>
  </body>
</html>`;
}
