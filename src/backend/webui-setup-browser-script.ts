export function renderSetupBrowserScript(): string {
  return `
      const elements = {
        overallStatus: document.getElementById("setup-overall-status"),
        overallCaption: document.getElementById("setup-overall-caption"),
        summary: document.getElementById("setup-summary"),
        blockerSummary: document.getElementById("setup-blocker-summary"),
        blockers: document.getElementById("setup-blockers"),
        fieldSummary: document.getElementById("setup-field-summary"),
        fields: document.getElementById("setup-fields"),
        hostSummary: document.getElementById("setup-host-summary"),
        hostChecks: document.getElementById("setup-host-checks"),
        providerPosture: document.getElementById("setup-provider-posture"),
        providerDetails: document.getElementById("setup-provider-details"),
        trustPosture: document.getElementById("setup-trust-posture"),
        trustDetails: document.getElementById("setup-trust-details"),
      };

      function setText(element, value) {
        if (!element) {
          return;
        }
        element.innerHTML = "";
        element.textContent = value;
      }

      function formatToken(value) {
        return String(value || "none").replace(/_/g, " ");
      }

      function titleCaseWords(value) {
        return String(value)
          .split(/\\s+/u)
          .filter(Boolean)
          .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
          .join(" ");
      }

      function formatStatus(value) {
        return titleCaseWords(formatToken(value));
      }

      function appendDetail(element, className, text) {
        const line = document.createElement("div");
        line.className = className;
        line.textContent = text;
        element.appendChild(line);
      }

      function renderChecklist(element, items, emptyMessage) {
        if (!element) {
          return;
        }
        element.innerHTML = "";
        const values = Array.isArray(items) && items.length > 0
          ? items
          : [{ title: emptyMessage, tone: "", meta: [], notes: [] }];
        for (const entry of values) {
          const listItem = document.createElement("li");
          listItem.className = "checklist-item" + (entry.tone ? " checklist-item--" + entry.tone : "");
          appendDetail(listItem, "checklist-item__title", entry.title);
          for (const metaLine of entry.meta || []) {
            appendDetail(listItem, "checklist-item__meta", metaLine);
          }
          for (const noteLine of entry.notes || []) {
            appendDetail(listItem, "checklist-item__note", noteLine);
          }
          element.appendChild(listItem);
        }
      }

      async function readJson(path) {
        const response = await fetch(path, { headers: { Accept: "application/json" } });
        if (!response.ok) {
          let message = "Request failed";
          try {
            const body = await response.json();
            message = body.error || message;
          } catch {}
          throw new Error(path + ": " + message);
        }
        return response.json();
      }

      function summarizeFields(fields) {
        const values = Array.isArray(fields) ? fields : [];
        const configured = values.filter((field) => field.state === "configured").length;
        return configured + " of " + values.length + " required setup fields configured.";
      }

      function summarizeHostReadiness(report) {
        const checks = (report.hostReadiness && report.hostReadiness.checks) || [];
        const overall = report.hostReadiness ? formatStatus(report.hostReadiness.overallStatus) : "Not Ready";
        return "Overall host readiness: " + overall + " across " + checks.length + " checks.";
      }

      function renderSetup(report) {
        setText(
          elements.overallStatus,
          report.ready ? "configured" : report.overallStatus,
        );
        setText(
          elements.overallCaption,
          report.ready
            ? "All required setup checks are configured."
            : "Resolve blockers before relying on steady-state dashboard actions.",
        );
        setText(
          elements.summary,
          "Config path: " +
            report.configPath +
            " | Setup ready: " +
            (report.ready ? "yes" : "no") +
            " | Blockers: " +
            report.blockers.length,
        );
        setText(
          elements.blockerSummary,
          report.blockers.length > 0
            ? report.blockers.length +
              " blocking condition" +
              (report.blockers.length === 1 ? " needs" : "s need") +
              " attention before first-run setup is complete."
            : "No blocking setup conditions remain.",
        );
        renderChecklist(
          elements.blockers,
          (report.blockers || []).map((blocker) => ({
            title: blocker.message,
            tone: "blocker",
            meta: [
              "Blocker code: " + formatToken(blocker.code),
              "Related fields: " + (blocker.fieldKeys && blocker.fieldKeys.length > 0 ? blocker.fieldKeys.join(", ") : "none"),
            ],
            notes: [
              "Suggested remediation: " + blocker.remediation.summary,
              "Remediation kind: " + formatToken(blocker.remediation.kind),
            ],
          })),
          "No setup blockers remain. Open /dashboard for steady-state operations.",
        );
        setText(elements.fieldSummary, summarizeFields(report.fields));
        renderChecklist(
          elements.fields,
          (report.fields || []).map(
            (field) => ({
              title: field.label + " [" + formatStatus(field.state) + "]",
              meta: [
                "Current value: " + (field.value || "Unset"),
                "Required: " + (field.required ? "yes" : "no") + " | Source: " + formatToken(field.metadata.source) + " | Type: " + formatToken(field.metadata.valueType),
              ],
              notes: [field.message],
            }),
          ),
          "No setup fields reported.",
        );
        setText(elements.hostSummary, summarizeHostReadiness(report));
        renderChecklist(
          elements.hostChecks,
          ((report.hostReadiness && report.hostReadiness.checks) || []).map(
            (check) => ({
              title: titleCaseWords(formatToken(check.name)) + " [" + formatStatus(check.status) + "]",
              meta: [check.summary],
              notes: (check.details || []).map((detail) => "Detail: " + detail),
            }),
          ),
          "No host readiness checks reported.",
        );
        setText(elements.providerPosture, report.providerPosture ? report.providerPosture.summary : "No provider posture reported.");
        renderChecklist(
          elements.providerDetails,
          report.providerPosture
            ? [{
              title: "Provider profile: " + formatStatus(report.providerPosture.profile),
              tone: "",
              meta: [
                "Provider: " + report.providerPosture.provider,
                "Signal source: " + formatToken(report.providerPosture.signalSource),
              ],
              notes: [
                "Configured reviewers: " + (report.providerPosture.reviewers.length > 0 ? report.providerPosture.reviewers.join(", ") : "none"),
                "Configured: " + (report.providerPosture.configured ? "yes" : "no"),
              ],
            }]
            : [],
          "No provider posture details reported.",
        );
        setText(elements.trustPosture, report.trustPosture ? report.trustPosture.summary : "No trust posture reported.");
        renderChecklist(
          elements.trustDetails,
          report.trustPosture
            ? [{
              title: "Trust mode: " + formatStatus(report.trustPosture.trustMode),
              tone: "",
              meta: ["Execution safety: " + formatStatus(report.trustPosture.executionSafetyMode)],
              notes: [report.trustPosture.warning ? "Warning: " + report.trustPosture.warning : "Warning: none"],
            }]
            : [],
          "No trust posture details reported.",
        );
      }

      async function bootstrap() {
        try {
          renderSetup(await readJson("/api/setup-readiness"));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          setText(elements.overallStatus, "error");
          setText(elements.overallCaption, "Setup readiness could not be loaded.");
          setText(elements.summary, message);
          setText(elements.blockerSummary, "Setup readiness request failed.");
          renderChecklist(
            elements.blockers,
            [{ title: message, tone: "blocker", meta: [], notes: [] }],
            "No setup blockers reported.",
          );
        }
      }

      void bootstrap();
`;
}
