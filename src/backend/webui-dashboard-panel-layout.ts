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

export const DASHBOARD_PANEL_REGISTRY = [
  {
    id: "status",
    section: "overview",
    markup: `
        <article class="panel" data-panel-id="status">
          <div class="panel-header">
            <h2>Status</h2>
            <span id="status-warning" class="hint"></span>
          </div>
          <div class="panel-body stack">
            <div class="metric" id="status-reconciliation">loading</div>
            <div class="row">
              <div class="row-label">Summary</div>
              <pre id="status-lines" class="code">Loading /api/status?why=true…</pre>
            </div>
          </div>
        </article>`,
  },
  {
    id: "doctor",
    section: "overview",
    markup: `
        <article class="panel" data-panel-id="doctor">
          <div class="panel-header">
            <h2>Doctor</h2>
            <span id="doctor-overall" class="metric">…</span>
          </div>
          <div class="panel-body stack">
            <div class="row">
              <div class="row-label">Checks</div>
              <ul id="doctor-checks" class="list">
                <li>Loading /api/doctor…</li>
              </ul>
            </div>
          </div>
        </article>`,
  },
  {
    id: "issue-details",
    section: "details",
    markup: `
        <article class="panel" data-panel-id="issue-details">
          <div class="panel-header">
            <h2>Issue details</h2>
            <span id="issue-summary" class="hint">No issue loaded.</span>
          </div>
          <div class="panel-body stack">
            <div class="row">
              <div class="row-label">Typed issue shortcuts</div>
              <div id="issue-shortcuts" class="shortcut-list">
                <div class="hint">Waiting for typed issue context…</div>
              </div>
            </div>
            <form id="issue-form" class="toolbar">
              <input id="issue-number-input" type="number" min="1" step="1" inputmode="numeric" placeholder="Issue number">
              <button type="submit">Load issue details</button>
            </form>
            <div class="row">
              <div class="row-label">Explain</div>
              <div id="issue-explain" class="detail-stack">
                <div class="detail-empty">Choose an issue number to load /api/issues/:issueNumber/explain.</div>
              </div>
            </div>
            <div class="row">
              <div class="row-label">Issue lint</div>
              <pre id="issue-lint" class="code">Issue lint appears here after a selection.</pre>
            </div>
          </div>
        </article>`,
  },
  {
    id: "tracked-history",
    section: "details",
    markup: `
        <article class="panel" data-panel-id="tracked-history">
          <div class="panel-header">
            <h2>Tracked history</h2>
            <button type="button" id="tracked-history-toggle">Show done issues</button>
          </div>
          <div class="panel-body stack">
            <div class="row">
              <div class="row-label">History summary</div>
              <span id="tracked-history-summary" class="hint">Waiting for tracked history…</span>
            </div>
            <div class="row">
              <div class="row-label">Tracked issues</div>
              <pre id="tracked-history-lines" class="code">Loading tracked history…</pre>
            </div>
          </div>
        </article>`,
  },
  {
    id: "operator-actions",
    section: "details",
    markup: `
        <article class="panel" data-panel-id="operator-actions">
          <div class="panel-header">
            <h2>Operator actions</h2>
            <span id="command-status" class="hint">No command run yet.</span>
          </div>
          <div class="panel-body stack">
            <p class="hint">
              Commands run one at a time. Confirmation rejections, in-flight progress, and refresh follow-up guidance
              appear below.
            </p>
            <div class="action-grid">
              <div class="action-card">
                <strong>Run once</strong>
                <p>Trigger one safe supervisor cycle through <code>/api/commands/run-once</code>.</p>
                <button type="button" id="run-once-button">Run once</button>
              </div>
              <div class="action-card">
                <strong>Requeue issue</strong>
                <p>Requeue the selected issue only after issue details are loaded.</p>
                <button type="button" id="requeue-button">Requeue selected issue</button>
              </div>
              <div class="action-card">
                <strong>Prune orphaned workspaces</strong>
                <p>Requires confirm before calling <code>/api/commands/prune-orphaned-workspaces</code>.</p>
                <button type="button" id="prune-workspaces-button">Confirm and prune</button>
              </div>
              <div class="action-card">
                <strong>Reset corrupt JSON state</strong>
                <p>Requires confirm before calling <code>/api/commands/reset-corrupt-json-state</code>.</p>
                <button type="button" id="reset-json-state-button">Confirm and reset</button>
              </div>
            </div>
            <div class="row">
              <div class="row-label">Command result</div>
              <pre id="command-result" class="code">Structured command result JSON appears here.</pre>
            </div>
          </div>
        </article>`,
  },
  {
    id: "live-events",
    section: "details",
    markup: `
        <article class="panel" data-panel-id="live-events">
          <div class="panel-header">
            <h2>Live events</h2>
            <span class="hint">SSE from /api/events</span>
          </div>
          <div class="panel-body">
            <div id="event-list" class="event-list">
              <div class="event-item">Waiting for live events…</div>
            </div>
          </div>
        </article>`,
  },
  {
    id: "operator-timeline",
    section: "details",
    markup: `
        <article class="panel" data-panel-id="operator-timeline">
          <div class="panel-header">
            <h2>Operator timeline</h2>
            <span class="hint">Recent commands, refreshes, and correlated live events</span>
          </div>
          <div class="panel-body">
            <div id="operator-timeline" class="event-list">
              <div class="event-item">Waiting for operator activity…</div>
            </div>
          </div>
        </article>`,
  },
] satisfies DashboardPanelDefinition[];

export const DASHBOARD_PANEL_IDS = DASHBOARD_PANEL_REGISTRY.map((panel) => panel.id);

const defaultVisibility = DASHBOARD_PANEL_REGISTRY.reduce<Record<DashboardPanelId, boolean>>((accumulator, panel) => {
  accumulator[panel.id] = true;
  return accumulator;
}, {} as Record<DashboardPanelId, boolean>);

export const DEFAULT_DASHBOARD_PANEL_LAYOUT: DashboardPanelLayoutState = {
  order: [...DASHBOARD_PANEL_IDS],
  visibility: defaultVisibility,
};

function isDashboardPanelId(value: string): value is DashboardPanelId {
  return DASHBOARD_PANEL_IDS.includes(value as DashboardPanelId);
}

export function resolveDashboardPanelLayout(
  layout: Partial<DashboardPanelLayoutState> | null | undefined,
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

  const requestedVisibility: Partial<Record<DashboardPanelId, boolean>> = layout?.visibility ?? {};
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
  layout: Partial<DashboardPanelLayoutState> | null | undefined = DEFAULT_DASHBOARD_PANEL_LAYOUT,
): DashboardPanelDefinition[] {
  const resolvedLayout = resolveDashboardPanelLayout(layout);
  const panelsById = DASHBOARD_PANEL_REGISTRY.reduce<Record<DashboardPanelId, DashboardPanelDefinition>>(
    (accumulator, panel) => {
      accumulator[panel.id] = panel;
      return accumulator;
    },
    {} as Record<DashboardPanelId, DashboardPanelDefinition>,
  );
  return resolvedLayout.order.filter((panelId) => {
    if (!resolvedLayout.visibility[panelId]) {
      return false;
    }
    return panelsById[panelId].section === section;
  }).map((panelId) => panelsById[panelId]);
}
