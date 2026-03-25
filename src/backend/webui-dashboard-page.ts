import { renderDashboardBrowserScript } from "./webui-dashboard-browser-script";
import { type DashboardPanelDefinition, type DashboardPanelId, listDashboardPanels } from "./webui-dashboard-panel-layout";

function renderDashboardPanelSection(section: "overview" | "details"): string {
  return listDashboardPanels(section)
    .map((panel) => panel.markup)
    .join("\n");
}

function toTitleCase(value: string): string {
  return value.replace(/\b([a-z])/gu, (match) => match.toUpperCase());
}

const panelNavIcons: Record<DashboardPanelId, string> = {
  status:
    '<svg viewBox="0 0 16 16" focusable="false"><path d="M3 12h2V6H3zm4 0h2V3H7zm4 0h2V8h-2z"/></svg>',
  doctor:
    '<svg viewBox="0 0 16 16" focusable="false"><path d="M7 2h2v3h3v2H9v3H7V7H4V5h3z"/></svg>',
  "issue-details":
    '<svg viewBox="0 0 16 16" focusable="false"><path d="M3 2.5h10v11H3zm2 2v1h6v-1zm0 3v1h6v-1zm0 3v1h4v-1z"/></svg>',
  "tracked-history":
    '<svg viewBox="0 0 16 16" focusable="false"><path d="M8 2.5a5.5 5.5 0 105.5 5.5h-2A3.5 3.5 0 118 4.5V2.5zm-.5 2h1v4l2.5 1.5-.5.9L7.5 9z"/></svg>',
  "operator-actions":
    '<svg viewBox="0 0 16 16" focusable="false"><path d="M6.5 2l1 2.2L10 5l-1.8 1.7.4 2.5L6.5 8.1 4.4 9.2l.4-2.5L3 5l2.5-.8zM11 9h2v5h-2zM3 10h2v4H3z"/></svg>',
  "live-events":
    '<svg viewBox="0 0 16 16" focusable="false"><path d="M2.5 8a5.5 5.5 0 1111 0h-2a3.5 3.5 0 10-7 0z"/><circle cx="8" cy="8" r="1.5"/></svg>',
  "operator-timeline":
    '<svg viewBox="0 0 16 16" focusable="false"><path d="M4 3.5a1.5 1.5 0 110 3 1.5 1.5 0 010-3zm0 6a1.5 1.5 0 110 3 1.5 1.5 0 010-3zM7 5h6v1H7zm0 6h6v1H7z"/></svg>',
};

function renderPanelNavLink(panel: DashboardPanelDefinition): string {
  const icon = panelNavIcons[panel.id];
  return `<a id="nav-panel-${panel.id}" class="side-nav-link" href="#panel-${panel.id}" data-open-details="true"><span class="side-nav-icon" aria-hidden="true">${icon}</span><span>${toTitleCase(panel.title)}</span></a>`;
}

function renderDetailsMenu(): string {
  return `<nav class="side-nav-card" aria-label="dashboard navigation">
          <div class="side-nav-section">
            <p class="eyebrow">Overview</p>
            <a id="nav-summary-top" class="side-nav-link" href="#summary-top"><span class="side-nav-icon" aria-hidden="true"><svg viewBox="0 0 16 16" focusable="false"><path d="M3 3.5h10v2H3zm0 3.5h10v2H3zm0 3.5h6v2H3z"/></svg></span><span>Current Status</span></a>
            <a id="nav-issue-summary" class="side-nav-link" href="#selected-issue-heading"><span class="side-nav-icon" aria-hidden="true"><svg viewBox="0 0 16 16" focusable="false"><path d="M3 2.5h10v11H3zm2 2v1h6v-1zm0 3v1h6v-1zm0 3v1h4v-1z"/></svg></span><span>Issue Summary</span></a>
          </div>
          <div class="side-nav-section">
            <p class="eyebrow">Details</p>
            <a id="nav-overview-heading" class="side-nav-link" href="#overview-heading" data-open-details="true"><span class="side-nav-icon" aria-hidden="true"><svg viewBox="0 0 16 16" focusable="false"><path d="M8 2.5l5 2v4c0 2.9-2.1 4.7-5 5.5-2.9-.8-5-2.6-5-5.5v-4zm0 2.1L5 5.7v2.8c0 1.8 1.2 3.1 3 3.8 1.8-.7 3-2 3-3.8V5.7zM7.2 7h1.6v2.2H7.2zm0 2.8h1.6v1.2H7.2z"/></svg></span><span>Queue Diagnostics</span></a>
${listDashboardPanels("overview")
  .map((panel) => "            " + renderPanelNavLink(panel))
  .join("\n")}
${listDashboardPanels("details")
  .map((panel) => "            " + renderPanelNavLink(panel))
  .join("\n")}
          </div>
        </nav>`;
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
        width: min(1380px, calc(100vw - 32px));
        margin: 0 auto;
        padding: 24px 0 40px;
      }

      .app-layout {
        display: grid;
        grid-template-columns: 220px minmax(0, 1fr);
        gap: 20px;
        align-items: start;
      }

      .side-nav {
        position: sticky;
        top: 24px;
      }

      .side-nav-card {
        display: grid;
        gap: 16px;
        padding: 18px 16px;
        border: 1px solid var(--border);
        border-radius: var(--radius-md);
        background: rgba(255, 255, 255, 0.92);
        box-shadow: var(--shadow-sm);
        backdrop-filter: blur(10px);
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
        gap: 14px;
        margin-bottom: 18px;
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
        align-items: end;
        gap: 14px;
        padding: 20px 22px;
      }

      .masthead-copy {
        display: grid;
        gap: 6px;
      }

      .masthead-copy h1,
      .section-header h2,
      .issue-summary-card h2 {
        margin: 0;
        letter-spacing: -0.03em;
      }

      .masthead-copy h1 {
        font-size: clamp(2rem, 4vw, 2.7rem);
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

      .summary-grid {
        display: grid;
        grid-template-columns: minmax(0, 1.3fr) repeat(3, minmax(0, 1fr));
        gap: 16px;
        margin-bottom: 16px;
      }

      .summary-card {
        min-width: 0;
        padding: 20px;
      }

      .summary-card-primary {
        background:
          linear-gradient(180deg, rgba(26, 187, 156, 0.08), rgba(26, 187, 156, 0)),
          var(--surface);
      }

      .summary-headline {
        margin: 0;
        font-size: clamp(1.5rem, 2.4vw, 2.1rem);
        line-height: 1.08;
        letter-spacing: -0.04em;
      }

      .summary-detail {
        font-size: 0.98rem;
      }

      .summary-banner {
        gap: 10px;
      }

      .summary-pills {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }

      .summary-list {
        gap: 10px;
        margin: 0;
        padding-left: 18px;
      }

      .summary-list li {
        color: var(--text);
        line-height: 1.45;
      }

      .summary-list li::marker {
        color: var(--accent);
      }

      .action-copy {
        display: grid;
        gap: 8px;
      }

      .action-note {
        padding: 12px 14px;
        border: 1px dashed var(--border-strong);
        border-radius: var(--radius-sm);
        background: var(--surface-soft);
        color: var(--muted);
        line-height: 1.5;
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
        .summary-grid,
        .issue-summary-grid,
        .overview-grid {
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
          width: min(100vw - 24px, 100%);
          padding-top: 16px;
        }

        .app-layout {
          grid-template-columns: 1fr;
        }

        .side-nav {
          position: static;
        }

        .summary-grid,
        .details-grid,
        .workflow-rail {
          grid-template-columns: 1fr;
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
      <div class="app-layout">
        <aside class="side-nav">
${renderDetailsMenu()}
        </aside>
        <div class="page-stack">
        <header class="masthead">
          <div id="summary-top" class="masthead-bar">
            <div class="masthead-copy">
              <p class="eyebrow">codex-supervisor</p>
              <h1>Operator dashboard</h1>
              <p>See the current supervisor state first, then open details only when you need them.</p>
            </div>
            <div class="masthead-meta">
              <div id="loop-mode-badge" class="topbar-pill info">Mode: local WebUI</div>
              <div id="connection-state-pill" class="topbar-pill info">Connection: connecting</div>
              <div id="last-refresh-pill" class="topbar-pill info">Last updated: never</div>
            </div>
          </div>
        </header>

        <section class="summary-grid" aria-label="summary">
          <article class="summary-card summary-card-primary">
            <p class="section-kicker">Current status</p>
            <div class="summary-banner">
              <h2 id="overview-headline" class="summary-headline">Loading supervisor status</h2>
              <p id="overview-detail" class="summary-detail">The dashboard is collecting the latest state. This may take a few seconds.</p>
            </div>
            <div class="summary-pills">
              <span id="loop-state-summary" class="summary-pill info">Loop status is loading</span>
              <span id="freshness-state" class="summary-pill info">awaiting refresh</span>
              <span id="refresh-state" class="summary-pill info">idle</span>
            </div>
            <div class="summary-inline">
              <div class="summary-inline-block">
                <span class="eyebrow">Connection</span>
                <strong id="connection-state" class="live-value">connecting</strong>
              </div>
              <div class="summary-inline-block">
                <span class="eyebrow">Last updated</span>
                <strong id="last-refresh-badge">never</strong>
              </div>
            </div>
            <div id="status-warning" class="hint"></div>
          </article>

          <article class="summary-card">
            <p class="section-kicker">Next state</p>
            <div class="action-copy">
              <strong id="primary-action-title">Observe and refresh</strong>
              <p id="primary-action-detail">The queue is quiet right now, so the next supervisor state is observation and refresh.</p>
            </div>
          </article>

          <article class="summary-card">
            <p class="section-kicker">Next issue</p>
            <div class="issue-summary-copy">
              <strong id="selected-issue-badge">none</strong>
              <p id="next-issue-title">No issue is selected yet.</p>
              <p id="next-issue-detail">When the supervisor surfaces a selected or runnable issue, it will appear here first.</p>
            </div>
          </article>

          <article class="summary-card">
            <p class="section-kicker">Why this state</p>
            <ul id="attention-list" class="summary-list">
              <li>No immediate attention items are reported.</li>
            </ul>
          </article>
        </section>

        <section class="issue-summary-card" aria-labelledby="selected-issue-heading">
          <div class="section-header">
            <p class="section-kicker">Issue summary</p>
            <h2 id="selected-issue-heading">No issue loaded</h2>
            <p id="selected-issue-detail" class="section-lead">The selected or next runnable issue will appear here with a short summary.</p>
          </div>
          <div class="issue-summary-grid">
            <div id="selected-issue-summary-metrics" class="metric-grid">
              <div class="metric-tile panel-empty-state">Load an issue or wait for the selected issue summary.</div>
            </div>
            <div id="selected-issue-summary-notes" class="detail-grid">
              <div class="detail-card">
                <h3>What to expect</h3>
                <div class="detail-list">
                  <div class="detail-item">This area highlights the selected issue, readiness, blockers, and recent context.</div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <details id="details-disclosure" class="details-disclosure">
          <summary>
            <span>Open details</span>
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
${renderDashboardPanelSection("overview")}
              </div>
            </section>

            <section class="section-block" aria-labelledby="details-heading">
              <div class="section-header">
                <p class="section-kicker">Issue and activity details</p>
                <h2 id="details-heading">Detailed operator view</h2>
                <p class="section-lead">Use these panels for issue inspection, queue history, live events, and maintenance actions.</p>
              </div>
              <div id="details-grid" class="details-grid" aria-label="details" data-panel-grid="details">
${renderDashboardPanelSection("details")}
              </div>
            </section>
          </div>
        </details>
        </div>
      </div>
    </main>

    <script>${renderDashboardBrowserScript()}
    </script>
  </body>
</html>`;
}
