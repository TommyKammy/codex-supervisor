export interface DashboardPageLayoutInput {
  repoSlugMarkup: string;
  detailsMenuMarkup: string;
  overviewPanelsMarkup: string;
  detailPanelsMarkup: string;
  footerMarkup: string;
  browserScript: string;
}

export function renderDashboardPageLayout({
  repoSlugMarkup,
  detailsMenuMarkup,
  overviewPanelsMarkup,
  detailPanelsMarkup,
  footerMarkup,
  browserScript,
}: DashboardPageLayoutInput): string {
  const safeBrowserScript = browserScript.replace(/<\/script/giu, "<\\/script");
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>codex-supervisor operator dashboard</title>
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

      body {
        margin: 0;
        min-height: 100vh;
        color: var(--text);
        background:
          radial-gradient(circle at top right, rgba(26, 187, 156, 0.08), transparent 24%),
          linear-gradient(180deg, #f8fbfd 0%, var(--bg) 100%);
      }

      .page-shell {
        min-height: 100vh;
      }

      .app-layout {
        display: grid;
        grid-template-columns: var(--sidebar-width) minmax(0, 1fr);
        gap: 0;
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
        border: 0;
        border-right: 1px solid rgba(200, 211, 223, 0.72);
        border-radius: 0;
        background: rgba(255, 255, 255, 0.84);
        box-shadow: none;
        backdrop-filter: blur(14px);
      }

      .side-nav-section {
        display: grid;
        gap: 8px;
      }

      .side-nav-link {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 12px;
        border: 1px solid transparent;
        border-radius: 10px;
        color: var(--text);
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

      .page-stack,
      .masthead,
      .summary-card,
      .panel-shell,
      .panel-heading,
      .stack,
      .row,
      .detail-stack,
      .detail-list,
      .event-list,
      .section-block,
      .issue-summary-copy,
      .summary-list,
      .summary-banner {
        display: grid;
        gap: 12px;
      }

      .eyebrow,
      .section-kicker,
      .row-label,
      .panel-header h2,
      .metric-tile-label,
      .action-kicker {
        margin: 0;
        font-size: 0.72rem;
        font-weight: 700;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: var(--muted);
      }

      .masthead {
        position: sticky;
        top: 0;
        z-index: 40;
        border-bottom: 1px solid rgba(200, 211, 223, 0.72);
        background: rgba(248, 251, 253, 0.92);
        backdrop-filter: blur(14px);
      }

      .repo-context-card {
        display: none;
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

      .masthead-bar,
      .summary-card,
      .panel,
      .details-disclosure {
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

      .masthead-copy h1,
      .section-header h2,
      .focus-hero h2 {
        margin: 0;
        letter-spacing: -0.03em;
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

      .masthead-copy p,
      .section-lead,
      .panel-subtitle,
      .summary-detail,
      .action-copy p,
      .issue-summary-copy p,
      .detail-item,
      .history-meta,
      .event-detail {
        margin: 0;
        color: var(--muted);
        line-height: 1.55;
      }

      .masthead-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
      }

      .page-stack {
        min-width: 0;
        padding: 34px 36px 40px;
      }

      .focus-hero {
        display: grid;
        gap: 20px;
        margin-bottom: 12px;
        padding: 2px 0 0;
      }

      .hero-breadcrumb {
        margin: 0;
        color: var(--muted);
        font-size: 0.88rem;
      }

      .focus-hero-copy {
        display: grid;
        gap: 10px;
        max-width: 980px;
      }

      .focus-hero h2 {
        font-size: clamp(2rem, 3.5vw, 3rem);
        line-height: 1.05;
      }

      .hero-reason {
        margin: 0;
        color: var(--text);
        font-size: 0.98rem;
        line-height: 1.6;
      }

      .hero-badge-row {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        max-width: 960px;
      }

      .hero-action-row {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        align-items: center;
      }

      .hero-primary-button,
      .hero-secondary-button,
      .hero-tertiary-button {
        font: inherit;
        cursor: pointer;
      }

      .hero-primary-button {
        padding: 12px 20px;
        border: 0;
        border-radius: 999px;
        background: linear-gradient(135deg, var(--accent), var(--accent-strong));
        color: #fff;
        box-shadow: 0 12px 24px rgba(26, 187, 156, 0.2);
      }

      .hero-primary-button:hover,
      .hero-secondary-button:hover,
      .hero-tertiary-button:hover {
        filter: brightness(1.03);
      }

      .hero-secondary-button,
      .hero-tertiary-button {
        padding: 12px 16px;
        border: 1px solid var(--border);
        border-radius: 999px;
        background: #fff;
        color: var(--text);
      }

      .hero-secondary-button.is-hidden {
        display: none;
      }

      .hero-warning {
        margin: 0;
        color: var(--muted);
        line-height: 1.5;
        max-width: 920px;
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

      .sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border: 0;
      }

      .topbar-pill,
      .summary-pill,
      .chip {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        border-radius: 999px;
        border: 1px solid var(--border);
        background: var(--surface-soft);
        color: var(--text);
        font-size: 0.86rem;
      }

      .summary-headline {
        margin: 0;
        font-size: clamp(1.5rem, 2.4vw, 2.1rem);
        line-height: 1.08;
        letter-spacing: -0.04em;
      }

      .summary-detail,
      .summary-pills,
      .summary-list,
      .action-copy,
      .action-note {
        display: none;
      }

      .action-copy strong,
      .issue-summary-copy strong,
      .detail-card h3,
      .action-card strong {
        margin: 0;
        font-size: 1.05rem;
      }

      .toolbar button,
      .action-card button {
        font: inherit;
      }

      .toolbar button,
      .action-card button {
        padding: 11px 15px;
        border: 0;
        border-radius: 999px;
        background: linear-gradient(135deg, var(--accent), var(--accent-strong));
        color: #fff;
        cursor: pointer;
      }

      .toolbar button:hover,
      .action-card button:hover {
        filter: brightness(1.04);
      }

      .toolbar button:disabled,
      .action-card button:disabled {
        cursor: not-allowed;
        opacity: 0.64;
        filter: grayscale(0.2);
      }

      .summary-inline {
        display: flex;
        flex-wrap: wrap;
        gap: 10px 12px;
      }

      .summary-inline-block {
        display: grid;
        gap: 4px;
        min-width: 116px;
      }

      .summary-inline-block strong {
        font-size: 1rem;
      }

      .live-value.ok,
      .metric.ok,
      .metric-tile-value.ok,
      .summary-headline.ok,
      .tone-ok {
        color: var(--ok);
      }

      .live-value.warn,
      .metric.warn,
      .metric-tile-value.warn,
      .summary-headline.warn,
      .tone-warn {
        color: var(--warn);
      }

      .live-value.fail,
      .metric.fail,
      .metric-tile-value.fail,
      .summary-headline.fail,
      .danger,
      .tone-fail {
        color: var(--danger);
      }

      .hint,
      .panel-empty-state {
        color: var(--muted);
      }

      .issue-summary-card {
        display: grid;
        gap: 16px;
        padding: 20px 22px;
        margin-bottom: 16px;
        border: 1px solid var(--border);
        border-radius: var(--radius-md);
        background: var(--surface);
        box-shadow: var(--shadow-sm);
      }

      .issue-summary-grid {
        display: grid;
        grid-template-columns: minmax(0, 1.2fr) minmax(0, 0.8fr);
        gap: 16px;
      }

      .metric-grid,
      .lint-grid,
      .detail-grid,
      .shortcut-list,
      .action-grid,
      .history-list,
      .status-list,
      .workflow-rail {
        display: grid;
        gap: 10px;
      }

      .metric-grid {
        grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      }

      .lint-grid {
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      }

      .detail-grid,
      .action-grid {
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      }

      .shortcut-list {
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      }

      .metric-tile,
      .detail-card,
      .action-card,
      .event-item,
      .history-card,
      .status-line {
        border: 1px solid var(--border);
        border-radius: var(--radius-sm);
        background: var(--surface-soft);
      }

      .metric-tile {
        display: grid;
        gap: 6px;
        padding: 12px 14px;
      }

      .metric-tile-value {
        font-size: 1.2rem;
        font-weight: 700;
        letter-spacing: -0.03em;
      }

      .metric-tile-detail {
        color: var(--muted);
        font-size: 0.82rem;
        line-height: 1.45;
      }

      .detail-card,
      .action-card {
        padding: 14px;
      }

      .detail-item {
        font-size: 0.92rem;
      }

      .details-disclosure {
        overflow: hidden;
        border-radius: 18px;
        box-shadow: none;
      }

      .details-disclosure summary {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
        padding: 16px 18px;
        cursor: pointer;
        list-style: none;
        font-weight: 700;
      }

      .details-disclosure summary::-webkit-details-marker {
        display: none;
      }

      .details-disclosure[open] summary {
        border-bottom: 1px solid var(--border);
        background: linear-gradient(180deg, #ffffff, #fbfcfe);
      }

      .details-body {
        display: grid;
        gap: 18px;
        padding: 18px;
        background: rgba(255, 255, 255, 0.92);
      }

      .section-header {
        display: grid;
        gap: 6px;
      }

      .overview-grid {
        display: grid;
        grid-template-columns: minmax(0, 1.45fr) minmax(300px, 1fr);
        gap: 16px;
      }

      .details-grid {
        display: grid;
        grid-template-columns: repeat(12, minmax(0, 1fr));
        gap: 16px;
      }

      .panel {
        min-width: 0;
        overflow: hidden;
        box-shadow: none;
      }

      .panel-shell {
        gap: 0;
      }

      .panel-header {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        gap: 12px;
        align-items: start;
        padding: 16px 18px 14px;
        border-bottom: 1px solid var(--border);
        background: linear-gradient(180deg, #ffffff, #fbfcfe);
      }

      .panel-header-main,
      .panel-header-aside,
      .panel-header-meta,
      .panel-header-actions,
      .chip-row,
      .status-hero,
      .history-card-header,
      .toolbar {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
      }

      .panel-header-main {
        align-items: flex-start;
      }

      .panel-header-aside,
      .panel-header-meta,
      .panel-header-actions {
        justify-content: flex-end;
      }

      .panel-icon,
      .action-icon,
      .empty-icon,
      .stat-icon {
        display: inline-grid;
        place-items: center;
        border-radius: 12px;
        background: rgba(26, 187, 156, 0.12);
        color: var(--accent-strong);
        font-weight: 700;
      }

      .panel-icon {
        width: 34px;
        height: 34px;
        margin-right: 10px;
      }

      .action-icon {
        width: 42px;
        height: 42px;
        border-radius: 14px;
        font-size: 1.15rem;
      }

      .panel-body {
        padding: 18px;
      }

      #panel-issue-details {
        grid-column: span 7;
      }

      #panel-tracked-history {
        grid-column: span 5;
      }

      #panel-operator-actions,
      #panel-live-events,
      #panel-operator-timeline {
        grid-column: span 4;
      }

      .metric {
        font-size: 2rem;
        line-height: 1;
        font-weight: 700;
        letter-spacing: -0.04em;
      }

      .loop-off-pill {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        border-radius: 999px;
        background: rgba(26, 187, 156, 0.12);
        color: var(--accent-strong);
        font-size: 0.82rem;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      .empty-state {
        display: grid;
        gap: 8px;
        padding: 14px;
        border: 1px dashed var(--border-strong);
        border-radius: var(--radius-sm);
        background: var(--surface-soft);
      }

      .empty-icon {
        width: 30px;
        height: 30px;
        border-radius: 999px;
      }

      .code,
      pre,
      .detail-empty {
        margin: 0;
        padding: 14px 16px;
        border: 0;
        border-radius: var(--radius-sm);
        background: #1f3042;
        color: #edf3f9;
        overflow: auto;
        font: 0.86rem/1.55 "Consolas", "SFMono-Regular", monospace;
      }

      .toolbar {
        align-items: center;
      }

      .toolbar input {
        min-width: 180px;
        padding: 11px 13px;
        border: 1px solid var(--border-strong);
        border-radius: 8px;
        background: #fff;
        color: var(--text);
        font: inherit;
      }

      .panel-header button,
      .shortcut-button {
        border: 1px solid var(--border);
        border-radius: 8px;
        background: #fff;
        color: var(--text);
        cursor: pointer;
        font: inherit;
      }

      .panel-header button {
        padding: 8px 12px;
      }

      .panel-header button:hover,
      .shortcut-button:hover {
        border-color: var(--border-strong);
        background: var(--surface-soft);
      }

      .shortcut-button {
        width: 100%;
        padding: 12px 13px;
        text-align: left;
      }

      .shortcut-button strong {
        display: block;
        margin-bottom: 4px;
      }

      .chip {
        gap: 6px;
        line-height: 1;
      }

      .chip::before,
      .summary-pill::before,
      .topbar-pill::before {
        content: "";
        width: 8px;
        height: 8px;
        border-radius: 999px;
        background: var(--border-strong);
      }

      .chip.ok::before,
      .summary-pill.ok::before,
      .topbar-pill.ok::before {
        background: var(--ok);
      }

      .chip.warn::before,
      .summary-pill.warn::before,
      .topbar-pill.warn::before {
        background: var(--warn);
      }

      .chip.fail::before,
      .summary-pill.fail::before,
      .topbar-pill.fail::before {
        background: var(--danger);
      }

      .chip.info::before,
      .summary-pill.info::before,
      .topbar-pill.info::before {
        background: var(--accent);
      }

      .action-card-large {
        display: grid;
        gap: 12px;
        min-height: 196px;
        align-content: start;
        padding: 18px;
        background: linear-gradient(180deg, #ffffff, #f7fafc);
      }

      .action-card button {
        justify-self: start;
      }

      .status-hero {
        align-items: end;
        justify-content: space-between;
      }

      .status-line,
      .history-card,
      .event-item {
        padding: 13px 14px;
      }

      .workflow-rail {
        grid-template-columns: repeat(5, minmax(0, 1fr));
        align-items: stretch;
      }

      .workflow-step {
        position: relative;
        display: grid;
        gap: 8px;
        padding: 14px 14px 14px 18px;
        border: 1px solid var(--border);
        border-radius: var(--radius-sm);
        background: var(--surface-soft);
      }

      .workflow-step::after {
        content: "";
        position: absolute;
        top: 26px;
        left: calc(100% - 6px);
        width: 12px;
        height: 2px;
        background: #cfd9e4;
      }

      .workflow-step:last-child::after {
        display: none;
      }

      .workflow-step.done {
        background: linear-gradient(180deg, #f1fbf8, #ffffff);
      }

      .workflow-step.current {
        border-color: rgba(26, 187, 156, 0.38);
        box-shadow: 0 10px 24px rgba(26, 187, 156, 0.12);
      }

      .workflow-step.idle {
        opacity: 0.78;
      }

      .workflow-copy {
        display: grid;
        gap: 4px;
      }

      .workflow-copy span {
        color: var(--muted);
        font-size: 0.82rem;
        line-height: 1.45;
      }

      .workflow-dot {
        width: 12px;
        height: 12px;
        border-radius: 999px;
        background: #cfd9e4;
      }

      .workflow-step.done .workflow-dot {
        background: var(--ok);
      }

      .workflow-step.current .workflow-dot {
        background: var(--accent);
        box-shadow: 0 0 0 6px rgba(26, 187, 156, 0.14);
      }

      .workflow-step.warn .workflow-dot {
        background: var(--warn);
      }

      .event-item.timeline-item {
        position: relative;
        padding-left: 42px;
      }

      .event-item.timeline-item::before {
        content: "";
        position: absolute;
        top: 18px;
        left: 20px;
        bottom: -18px;
        width: 2px;
        background: #d6dde8;
      }

      .event-item.timeline-item:last-child::before {
        display: none;
      }

      .timeline-dot {
        position: absolute;
        top: 16px;
        left: 12px;
        display: inline-grid;
        place-items: center;
        width: 18px;
        height: 18px;
        border-radius: 999px;
        color: #fff;
        font-size: 0.68rem;
        font-weight: 700;
      }

      .timeline-dot.command {
        background: var(--accent);
      }

      .timeline-dot.refresh {
        background: var(--warn);
      }

      .timeline-dot.event {
        background: var(--ok);
      }

      .event-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-bottom: 6px;
        color: var(--muted);
        font-size: 0.82rem;
      }

      .event-summary {
        margin: 0 0 6px;
        font-weight: 600;
        line-height: 1.45;
      }

      @media (max-width: 1220px) {
        .issue-summary-grid,
        .overview-grid,
        .details-grid {
          grid-template-columns: 1fr;
        }

        .workflow-rail {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }

        #panel-issue-details,
        #panel-tracked-history,
        #panel-operator-actions,
        #panel-live-events,
        #panel-operator-timeline {
          grid-column: span 6;
        }
      }

      @media (max-width: 980px) {
        .page-shell {
          width: 100%;
        }

        .app-layout {
          grid-template-columns: 1fr;
        }

        .side-nav {
          position: static;
          height: auto;
        }

        .details-grid,
        .workflow-rail {
          grid-template-columns: 1fr;
        }

        .masthead-bar {
          padding-inline: 18px;
        }

        .page-stack {
          padding: 24px 18px 28px;
        }

        #panel-issue-details,
        #panel-tracked-history,
        #panel-operator-actions,
        #panel-live-events,
        #panel-operator-timeline {
          grid-column: auto;
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
    <main class="page-shell" data-dashboard-root>
      <header class="masthead">
        <div id="summary-top" class="masthead-bar">
          <div class="masthead-brand">
            <span class="masthead-brand-icon" aria-hidden="true">C</span>
            <span class="masthead-brand-name">codex-supervisor</span>
            <span class="masthead-divider" aria-hidden="true">|</span>
            <strong id="repo-slug-value" class="masthead-repo">${repoSlugMarkup}</strong>
          </div>
          <div class="masthead-meta">
            <div id="connection-state-pill" class="topbar-pill info">Connection: connecting</div>
            <div id="loop-mode-badge" class="topbar-pill info">Mode: local WebUI</div>
            <div id="last-refresh-pill" class="topbar-pill info">Last updated: never</div>
          </div>
        </div>
      </header>
      <div class="app-layout">
        <aside class="side-nav">
${detailsMenuMarkup}
        </aside>
        <div class="page-stack">
        <section class="focus-hero" aria-labelledby="selected-issue-heading">
          <p id="focus-breadcrumb" class="hero-breadcrumb">Current Focus &gt; Waiting for an issue</p>
          <div class="focus-hero-copy">
            <h2 id="selected-issue-heading">No issue loaded</h2>
            <p id="selected-issue-detail" class="section-lead">The selected or next runnable issue will appear here with a short summary.</p>
            <p id="hero-reason" class="hero-reason">Reason: No immediate attention items are reported.</p>
          </div>
          <div id="hero-badge-row" class="hero-badge-row">
            <span class="summary-pill info">Issue state is loading</span>
          </div>
          <div class="hero-action-row">
            <button type="button" id="hero-primary-button" class="hero-primary-button">Refresh Dashboard</button>
            <button type="button" id="hero-secondary-button" class="hero-secondary-button"></button>
            <button type="button" id="hero-tertiary-button" class="hero-tertiary-button">More Actions</button>
          </div>
          <p id="overview-warning" class="hero-warning hint"></p>
          <div class="sr-only">
            <strong id="overview-headline" class="summary-headline">Loading supervisor status</strong>
            <p id="overview-detail" class="summary-detail">The dashboard is collecting the latest state. This may take a few seconds.</p>
            <span id="loop-state-summary" class="summary-pill info">Loop status is loading</span>
            <span id="freshness-state" class="summary-pill info">awaiting refresh</span>
            <span id="refresh-state" class="summary-pill info">idle</span>
            <strong id="primary-action-title">Observe and refresh</strong>
            <p id="primary-action-detail">The queue is quiet right now, so the next supervisor state is observation and refresh.</p>
            <strong id="selected-issue-badge">none</strong>
            <p id="next-issue-title">No issue is selected yet.</p>
            <p id="next-issue-detail">When the supervisor surfaces a selected or runnable issue, it will appear here first.</p>
            <ul id="attention-list" class="summary-list">
              <li>No immediate attention items are reported.</li>
            </ul>
          </div>
          <div id="selected-issue-summary-metrics" class="sr-only">
            <div class="metric-tile panel-empty-state">Load an issue or wait for the selected issue summary.</div>
          </div>
          <div id="selected-issue-summary-notes" class="sr-only">
            <div class="detail-card">
              <h3>What to expect</h3>
              <div class="detail-list">
                <div class="detail-item">This area highlights the selected issue, readiness, blockers, and recent context.</div>
              </div>
            </div>
          </div>
          <div class="sr-only">
            <span class="eyebrow">Connection</span>
            <strong id="connection-state" class="live-value">connecting</strong>
            <span class="eyebrow">Last updated</span>
            <strong id="last-refresh-badge">never</strong>
          </div>
        </section>

        <details id="details-disclosure" class="details-disclosure">
          <summary>
            <span>Details &amp; Diagnostics</span>
            <span class="hint">Queue, diagnostics, issue loading, and maintenance actions</span>
          </summary>
          <div class="details-body">
            <section class="section-block" aria-labelledby="overview-heading">
              <div class="section-header">
                <p class="section-kicker">Queue and diagnostics</p>
                <h2 id="overview-heading">Advanced queue context</h2>
                <p class="section-lead">Open this section when you want the full supervisor reasoning, queue details, and environment diagnostics.</p>
              </div>
              <div id="overview-grid" class="overview-grid" aria-label="overview" data-panel-grid="overview">
${overviewPanelsMarkup}
              </div>
            </section>

            <section class="section-block" aria-labelledby="details-heading">
              <div class="section-header">
                <p class="section-kicker">Issue and activity details</p>
                <h2 id="details-heading">Detailed operator view</h2>
                <p class="section-lead">Use these panels for issue inspection, queue history, live events, and maintenance actions.</p>
              </div>
              <div id="details-grid" class="details-grid" aria-label="details" data-panel-grid="details">
${detailPanelsMarkup}
              </div>
            </section>
          </div>
        </details>

${footerMarkup}
        </div>
      </div>
    </main>

    <script>${safeBrowserScript}
    </script>
  </body>
</html>`;
}
