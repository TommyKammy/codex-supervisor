export type DashboardPanelId =
  | "status"
  | "doctor"
  | "issue-details"
  | "tracked-history"
  | "operator-actions"
  | "live-events"
  | "operator-timeline";

export type DashboardPanelSection = "overview" | "details";

export interface DashboardPanelDefinition {
  id: DashboardPanelId;
  section: DashboardPanelSection;
  markup: string;
}

export interface DashboardPanelLayoutState {
  order: DashboardPanelId[];
  visibility: Record<DashboardPanelId, boolean>;
}

export interface DashboardPanelLayoutInput {
  order?: readonly string[] | null;
  visibility?: Readonly<Record<string, unknown>> | null;
}

interface DashboardPanelShellOptions {
  id: DashboardPanelId;
  section: DashboardPanelSection;
  title: string;
  subtitle: string;
  iconMarkup: string;
  bodyMarkup: string;
  bodyClassName?: string;
  headerMetaMarkup?: string;
  headerActionMarkup?: string;
}

function renderPanelIcon(symbol: string): string {
  return `<span class="panel-icon" aria-hidden="true">${symbol}</span>`;
}

function renderDashboardPanelShell(options: DashboardPanelShellOptions): DashboardPanelDefinition {
  const bodyClassName = options.bodyClassName ? "panel-body " + options.bodyClassName : "panel-body";
  const headerMetaMarkup = options.headerMetaMarkup
    ? `<div class="panel-header-meta">${options.headerMetaMarkup}</div>`
    : '<div class="panel-header-meta"></div>';
  const headerActionMarkup = options.headerActionMarkup
    ? `<div class="panel-header-actions">${options.headerActionMarkup}</div>`
    : '<div class="panel-header-actions"></div>';

  return {
    id: options.id,
    section: options.section,
    markup: `
        <article id="panel-${options.id}" class="panel" data-panel-id="${options.id}" data-panel-section="${options.section}">
          <div class="panel-shell">
            <div class="panel-header">
              <div class="panel-header-main">
                ${options.iconMarkup}
                <div class="panel-heading">
                  <h2>${options.title}</h2>
                  <p class="panel-subtitle">${options.subtitle}</p>
                </div>
              </div>
              <div class="panel-header-aside">
                ${headerMetaMarkup}
                ${headerActionMarkup}
              </div>
            </div>
            <div class="${bodyClassName}">
${options.bodyMarkup}
            </div>
          </div>
        </article>`,
  };
}

export const DASHBOARD_PANEL_REGISTRY = [
  renderDashboardPanelShell({
    id: "status",
    section: "overview",
    title: "Queue details",
    subtitle: "Advanced queue signals, workflow state, and supervisor reasoning.",
    iconMarkup: renderPanelIcon("◔"),
    headerMetaMarkup: '<span id="status-warning" class="hint"></span>',
    bodyClassName: "stack",
    bodyMarkup: `              <div class="status-hero">
                <div>
                  <div class="row-label">Reconciliation</div>
                  <div class="metric" id="status-reconciliation">loading</div>
                </div>
                <div class="chip-row">
                  <span class="chip info">web mode</span>
                  <span id="status-loop-chip" class="chip info">loop status pending</span>
                </div>
              </div>
              <div id="status-metrics" class="metric-grid">
                <div class="metric-tile panel-empty-state">Loading summary metrics…</div>
              </div>
              <div class="row">
                <div class="row-label">Workflow position</div>
                <div id="status-workflow" class="workflow-rail">
                  <div class="workflow-step current">
                    <span class="workflow-dot"></span>
                    <div class="workflow-copy">
                      <strong>Assess</strong>
                      <span>Loading supervisor workflow…</span>
                    </div>
                  </div>
                </div>
              </div>
              <div class="row">
                <div class="row-label">Focus lines</div>
                <div id="status-lines" class="status-list">
                  <div class="status-line panel-empty-state">Loading /api/status?why=true…</div>
                </div>
              </div>`,
  }),
  renderDashboardPanelShell({
    id: "doctor",
    section: "overview",
    title: "Environment checks",
    subtitle: "Detailed diagnostics for dependencies that gate safe execution.",
    iconMarkup: renderPanelIcon("✚"),
    headerMetaMarkup: '<span id="doctor-overall" class="metric">…</span>',
    bodyClassName: "stack",
    bodyMarkup: `              <div class="row">
                <div class="row-label">Checks</div>
                <ul id="doctor-checks" class="list">
                  <li class="panel-empty-state">Loading /api/doctor…</li>
                </ul>
              </div>`,
  }),
  renderDashboardPanelShell({
    id: "issue-details",
    section: "details",
    title: "Issue details",
    subtitle: "Typed issue context and issue checks for a selected issue.",
    iconMarkup: renderPanelIcon("#"),
    headerMetaMarkup: '<span id="issue-summary" class="hint">No issue loaded.</span>',
    bodyClassName: "stack",
    bodyMarkup: `              <div class="row">
                <div class="row-label">Typed issue shortcuts</div>
                <div id="issue-shortcuts" class="shortcut-list">
                  <div class="panel-empty-state hint">Waiting for typed issue context…</div>
                </div>
              </div>
              <form id="issue-form" class="toolbar">
                <input id="issue-number-input" type="number" min="1" step="1" inputmode="numeric" placeholder="Issue number">
                <button type="submit">Load issue details</button>
              </form>
              <div id="issue-metrics" class="metric-grid">
                <div class="metric-tile panel-empty-state">Select an issue to load metrics.</div>
              </div>
              <div class="row">
                <div class="row-label">Explain focus</div>
                <div id="issue-explain" class="detail-stack">
                  <div class="panel-empty-state detail-empty">Choose an issue number to load /api/issues/:issueNumber/explain.</div>
                </div>
              </div>
              <div class="row">
                <div class="row-label">Lint posture</div>
                <div id="issue-lint" class="lint-grid">
                  <div class="metric-tile panel-empty-state">Issue lint appears here after a selection.</div>
                </div>
              </div>`,
  }),
  renderDashboardPanelShell({
    id: "tracked-history",
    section: "details",
    title: "Queue",
    subtitle: "Tracked issues and optional done history from the supervisor queue.",
    iconMarkup: renderPanelIcon("◎"),
    headerMetaMarkup: '<span id="tracked-history-summary" class="hint">Waiting for tracked history…</span>',
    headerActionMarkup: '<button type="button" id="tracked-history-toggle">Show done issues</button>',
    bodyClassName: "stack",
    bodyMarkup: `              <div class="row">
                <div class="row-label">Tracked issues</div>
                <div id="tracked-history-lines" class="history-list">
                  <div class="history-card panel-empty-state">Loading tracked history…</div>
                </div>
              </div>`,
  }),
  renderDashboardPanelShell({
    id: "operator-actions",
    section: "details",
    title: "Secondary actions",
    subtitle: "Requeue and maintenance actions that should stay out of the default view.",
    iconMarkup: renderPanelIcon("⌘"),
    headerMetaMarkup: '<span id="command-status" class="hint">No command run yet.</span>',
    bodyClassName: "stack",
    bodyMarkup: `              <div class="action-grid action-grid-large">
                <div class="action-card action-card-large">
                  <span class="action-icon" aria-hidden="true">▶</span>
                  <span class="action-kicker">Testing</span>
                  <strong>Run once</strong>
                  <p>Use a single safe cycle for testing or a manual check when loop mode is not running.</p>
                  <button type="button" id="run-once-button">Run once</button>
                </div>
                <div class="action-card action-card-large">
                  <span class="action-icon" aria-hidden="true">↺</span>
                  <span class="action-kicker">Issue</span>
                  <strong>Requeue issue</strong>
                  <p>Requeue the selected issue after you confirm the issue details in this section.</p>
                  <button type="button" id="requeue-button">Requeue selected issue</button>
                </div>
                <div class="action-card action-card-large">
                  <span class="action-icon" aria-hidden="true">✦</span>
                  <span class="action-kicker">Maintenance</span>
                  <strong>Prune orphaned workspaces</strong>
                  <p>Requires confirmation before calling <code>/api/commands/prune-orphaned-workspaces</code>.</p>
                  <button type="button" id="prune-workspaces-button">Confirm and prune</button>
                </div>
                <div class="action-card action-card-large">
                  <span class="action-icon" aria-hidden="true">⌁</span>
                  <span class="action-kicker">Recovery</span>
                  <strong>Reset corrupt JSON state</strong>
                  <p>Requires confirmation before calling <code>/api/commands/reset-corrupt-json-state</code>.</p>
                  <button type="button" id="reset-json-state-button">Confirm and reset</button>
                </div>
              </div>
              <div class="row">
                <div class="row-label">Command result JSON</div>
                <pre id="command-result" class="code">Structured command result JSON appears here.</pre>
              </div>`,
  }),
  renderDashboardPanelShell({
    id: "live-events",
    section: "details",
    title: "Live events",
    subtitle: "Supervisor SSE activity streamed from the existing /api/events endpoint.",
    iconMarkup: renderPanelIcon("◉"),
    headerMetaMarkup: '<span class="hint">SSE from /api/events</span>',
    bodyMarkup: `              <div id="event-list" class="event-list">
                <div class="panel-empty-state event-item">Waiting for live events…</div>
              </div>`,
  }),
  renderDashboardPanelShell({
    id: "operator-timeline",
    section: "details",
    title: "Operator timeline",
    subtitle: "Recent commands, refreshes, and correlated live events in one feed.",
    iconMarkup: renderPanelIcon("↗"),
    headerMetaMarkup: '<span class="hint">Recent commands, refreshes, and correlated live events</span>',
    bodyMarkup: `              <div id="operator-timeline" class="event-list">
                <div class="panel-empty-state event-item">Waiting for operator activity…</div>
              </div>`,
  }),
] satisfies DashboardPanelDefinition[];

export const DASHBOARD_PANEL_IDS = DASHBOARD_PANEL_REGISTRY.map((panel) => panel.id);

const defaultOrder = Object.freeze([...DASHBOARD_PANEL_IDS] as DashboardPanelId[]);

const defaultVisibility = Object.freeze(
  DASHBOARD_PANEL_REGISTRY.reduce<Record<DashboardPanelId, boolean>>((accumulator, panel) => {
    accumulator[panel.id] = true;
    return accumulator;
  }, {} as Record<DashboardPanelId, boolean>),
);

export const DEFAULT_DASHBOARD_PANEL_LAYOUT = Object.freeze({
  order: defaultOrder,
  visibility: defaultVisibility,
});

function isDashboardPanelId(value: string): value is DashboardPanelId {
  return DASHBOARD_PANEL_IDS.includes(value as DashboardPanelId);
}

export function resolveDashboardPanelLayout(
  layout: DashboardPanelLayoutInput | null | undefined,
): DashboardPanelLayoutState {
  const requestedOrder = Array.isArray(layout?.order) ? layout.order.filter(isDashboardPanelId) : [];
  const seen = new Set<DashboardPanelId>();
  const normalizedOrder: DashboardPanelId[] = [];

  for (const panelId of requestedOrder) {
    if (seen.has(panelId)) {
      continue;
    }
    seen.add(panelId);
    normalizedOrder.push(panelId);
  }

  for (const panelId of DASHBOARD_PANEL_IDS) {
    if (!seen.has(panelId)) {
      normalizedOrder.push(panelId);
    }
  }

  const requestedVisibility = layout?.visibility ?? {};
  const visibility = DASHBOARD_PANEL_REGISTRY.reduce<Record<DashboardPanelId, boolean>>((accumulator, panel) => {
    const requestedPanelVisibility = requestedVisibility[panel.id];
    accumulator[panel.id] =
      typeof requestedPanelVisibility === "boolean"
        ? requestedPanelVisibility
        : DEFAULT_DASHBOARD_PANEL_LAYOUT.visibility[panel.id];
    return accumulator;
  }, {} as Record<DashboardPanelId, boolean>);

  return {
    order: normalizedOrder,
    visibility,
  };
}

export function listDashboardPanels(
  section: DashboardPanelSection,
  layout: DashboardPanelLayoutInput | null | undefined = DEFAULT_DASHBOARD_PANEL_LAYOUT,
): DashboardPanelDefinition[] {
  const resolvedLayout = resolveDashboardPanelLayout(layout);
  const panelsById = DASHBOARD_PANEL_REGISTRY.reduce<Record<DashboardPanelId, DashboardPanelDefinition>>(
    (accumulator, panel) => {
      accumulator[panel.id] = panel;
      return accumulator;
    },
    {} as Record<DashboardPanelId, DashboardPanelDefinition>,
  );
  return resolvedLayout.order
    .filter((panelId) => {
      if (!resolvedLayout.visibility[panelId]) {
        return false;
      }
      return panelsById[panelId].section === section;
    })
    .map((panelId) => panelsById[panelId]);
}
