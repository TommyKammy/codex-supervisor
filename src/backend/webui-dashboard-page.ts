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
        --bg: #f4efe5;
        --bg-accent: #e7dcc8;
        --panel: rgba(255, 252, 246, 0.92);
        --panel-strong: #fffaf1;
        --border: rgba(48, 41, 30, 0.14);
        --text: #1f1a14;
        --muted: #655b4d;
        --danger: #a33a2b;
        --warn: #a06712;
        --ok: #24613d;
        --accent: #0f6c78;
        --accent-strong: #0b4d56;
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
          radial-gradient(circle at top left, rgba(15, 108, 120, 0.16), transparent 35%),
          radial-gradient(circle at top right, rgba(160, 103, 18, 0.14), transparent 32%),
          linear-gradient(180deg, var(--bg) 0%, #f8f4ec 100%);
      }

      .shell {
        width: min(1200px, calc(100vw - 32px));
        margin: 0 auto;
        padding: 28px 0 40px;
      }

      .hero {
        display: grid;
        gap: 16px;
        padding: 28px;
        border: 1px solid var(--border);
        border-radius: 24px;
        background:
          linear-gradient(135deg, rgba(255, 255, 255, 0.9), rgba(247, 239, 222, 0.92)),
          linear-gradient(135deg, rgba(15, 108, 120, 0.05), rgba(160, 103, 18, 0.06));
        box-shadow: var(--shadow);
      }

      .hero h1 {
        margin: 0;
        font-family: "Iowan Old Style", "Palatino Linotype", serif;
        font-size: clamp(2rem, 4vw, 3.5rem);
        line-height: 0.96;
        letter-spacing: -0.04em;
      }

      .hero p {
        margin: 0;
        max-width: 70ch;
        color: var(--muted);
        font-size: 1rem;
      }

      .hero-bar {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        align-items: center;
      }

      .badge {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        border-radius: 999px;
        border: 1px solid var(--border);
        background: rgba(255, 255, 255, 0.75);
        color: var(--muted);
        font-size: 0.9rem;
      }

      .badge strong {
        color: var(--text);
      }

      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
        gap: 16px;
        margin-top: 18px;
      }

      .panel {
        border: 1px solid var(--border);
        border-radius: 20px;
        background: var(--panel);
        box-shadow: var(--shadow);
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
        padding: 18px 20px 10px;
        border-bottom: 1px solid rgba(48, 41, 30, 0.08);
        background: linear-gradient(180deg, rgba(255, 255, 255, 0.42), rgba(255, 255, 255, 0));
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
        border: 1px dashed rgba(48, 41, 30, 0.18);
        background:
          linear-gradient(180deg, rgba(255, 255, 255, 0.75), rgba(231, 220, 200, 0.4)),
          repeating-linear-gradient(
            90deg,
            transparent 0,
            transparent 7px,
            rgba(48, 41, 30, 0.08) 7px,
            rgba(48, 41, 30, 0.08) 10px
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
        font-size: 1rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
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
        background: rgba(31, 26, 20, 0.94);
        color: #f5ede1;
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
        background: rgba(31, 26, 20, 0.94);
        color: #f5ede1;
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
        background: rgba(255, 255, 255, 0.76);
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
        background: rgba(255, 255, 255, 0.78);
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
        border: 1px solid var(--border);
        background: var(--panel-strong);
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
        background: rgba(255, 255, 255, 0.82);
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
        background: rgba(255, 255, 255, 0.7);
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
        background: rgba(255, 255, 255, 0.58);
        border: 1px solid rgba(48, 41, 30, 0.1);
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
        <div>
          <h1>Operator dashboard</h1>
          <p>
            Supervisor status and safe command transport backed by JSON endpoints and the live SSE stream.
            The command surface stays limited to existing operator-safe mutations.
          </p>
        </div>
        <div class="hero-bar">
          <div class="badge">connection <strong id="connection-state">connecting</strong></div>
          <div class="badge">freshness <strong id="freshness-state">awaiting refresh</strong></div>
          <div class="badge">refresh <strong id="refresh-state">idle</strong></div>
          <div class="badge">selected issue <strong id="selected-issue-badge">none</strong></div>
          <div class="badge">last refresh <strong id="last-refresh-badge">never</strong></div>
        </div>
      </section>

      <section class="grid" aria-label="overview">
${renderDashboardPanelSection("overview")}
      </section>

      <section class="grid" aria-label="details">
${renderDashboardPanelSection("details")}
      </section>
    </main>

    <script>${renderDashboardBrowserScript()}
    </script>
  </body>
</html>`;
}
