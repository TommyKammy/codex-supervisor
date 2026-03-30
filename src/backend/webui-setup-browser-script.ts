import { WEBUI_MUTATION_AUTH_HEADER, WEBUI_MUTATION_AUTH_STORAGE_KEY } from "./webui-mutation-auth";

export function renderSetupBrowserScript(): string {
  return `
      const elements = {
        form: document.getElementById("setup-form"),
        formSummary: document.getElementById("setup-form-summary"),
        editors: document.getElementById("setup-editors"),
        saveButton: document.getElementById("setup-save-button"),
        saveStatus: document.getElementById("setup-save-status"),
        restartStatus: document.getElementById("setup-restart-status"),
        restartDetails: document.getElementById("setup-restart-details"),
        restartButton: document.getElementById("setup-restart-button"),
        restartGuidance: document.getElementById("setup-restart-guidance"),
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
        localCiSummary: document.getElementById("setup-local-ci-summary"),
        localCiActions: document.getElementById("setup-local-ci-actions"),
        localCiDetails: document.getElementById("setup-local-ci-details"),
        localCiAdoptRecommended: document.getElementById("setup-local-ci-adopt-recommended"),
      };
      const editableFieldOrder = [
        "repoPath",
        "repoSlug",
        "defaultBranch",
        "workspaceRoot",
        "stateFile",
        "codexBinary",
        "branchPrefix",
        "localCiCommand",
        "reviewProvider",
      ];
      const reviewProviderOptions = [
        { value: "none", label: "No provider selected yet" },
        { value: "copilot", label: "GitHub Copilot" },
        { value: "codex", label: "Codex Connector" },
        { value: "coderabbit", label: "CodeRabbit" },
      ];
      let currentReport = null;
      let latestSaveResult = null;
      let saveInFlight = false;
      let restartInFlight = false;
      let restartRequested = false;
      let reconnectPollToken = 0;
      const reconnectPollInitialIntervalMs = 50;
      const reconnectPollMaxIntervalMs = 1000;
      const mutationAuthStorageKey = ${JSON.stringify(WEBUI_MUTATION_AUTH_STORAGE_KEY)};
      const mutationAuthHeader = ${JSON.stringify(WEBUI_MUTATION_AUTH_HEADER)};

      function formatFieldList(fields) {
        const values = Array.isArray(fields) ? fields.filter((field) => typeof field === "string" && field.length > 0) : [];
        return values.length > 0 ? values.join(", ") : "the saved fields";
      }

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

      async function readJson(path, init) {
        const response = await fetch(path, init || { headers: { Accept: "application/json" } });
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

      async function writeJson(path, body) {
        return writeMutationJson(path, body);
      }

      function readStoredMutationAuthToken() {
        try {
          const value = window.localStorage && window.localStorage.getItem(mutationAuthStorageKey);
          return value && value.trim().length > 0 ? value.trim() : null;
        } catch {
          return null;
        }
      }

      function writeStoredMutationAuthToken(value) {
        try {
          if (!window.localStorage) {
            return;
          }
          if (typeof value !== "string" || value.trim().length === 0) {
            window.localStorage.removeItem(mutationAuthStorageKey);
            return;
          }
          window.localStorage.setItem(mutationAuthStorageKey, value.trim());
        } catch {}
      }

      function promptForMutationAuthToken() {
        if (!window || typeof window.prompt !== "function") {
          throw new Error("WebUI mutation auth requires a browser prompt to collect the token.");
        }
        const value = window.prompt("Enter the local WebUI mutation token.");
        if (typeof value !== "string" || value.trim().length === 0) {
          throw new Error("Mutation auth token is required for WebUI write actions.");
        }
        const normalized = value.trim();
        writeStoredMutationAuthToken(normalized);
        return normalized;
      }

      function buildMutationHeaders(token) {
        const headers = {
          Accept: "application/json",
          "Content-Type": "application/json",
        };
        if (typeof token === "string" && token.length > 0) {
          headers[mutationAuthHeader] = token;
        }
        return headers;
      }

      async function readMutationResponsePayload(response) {
        const headers = response && response.headers;
        const contentType =
          headers && typeof headers.get === "function" ? String(headers.get("content-type") || "") : "";
        const rawText = typeof response.text === "function" ? await response.text() : "";
        if (!rawText) {
          return { payload: null, rawText: "", parseError: false };
        }
        const prefersJson = contentType.toLowerCase().indexOf("application/json") !== -1;
        try {
          return {
            payload: JSON.parse(rawText),
            rawText,
            parseError: false,
          };
        } catch {
          return {
            payload: null,
            rawText,
            parseError: prefersJson,
          };
        }
      }

      async function writeMutationJson(path, body) {
        let token = readStoredMutationAuthToken();

        for (let attempt = 0; attempt < 2; attempt += 1) {
          const response = await fetch(path, {
            method: "POST",
            headers: buildMutationHeaders(token),
            body: JSON.stringify(body),
          });
          const responsePayload = await readMutationResponsePayload(response);
          const payload = responsePayload.payload;
          if (response.ok) {
            if (payload === null) {
              throw new Error(path + ": Server returned invalid JSON response.");
            }
            return payload;
          }

          let message = "Request failed";
          if (payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string") {
            message = payload.error;
          } else if (responsePayload.rawText.trim().length > 0) {
            message = responsePayload.rawText.trim();
          } else if (responsePayload.parseError) {
            message = "Server returned invalid JSON response.";
          }
          if (response.status === 401) {
            writeStoredMutationAuthToken(null);
            if (attempt === 0) {
              token = promptForMutationAuthToken();
              continue;
            }
          }
          throw new Error(path + ": " + message);
        }

        throw new Error(path + ": Mutation auth required.");
      }

      function summarizeFields(fields) {
        const values = Array.isArray(fields) ? fields : [];
        const requiredFields = values.filter((field) => field.required);
        const configuredRequired = requiredFields.filter((field) => field.state === "configured").length;
        return configuredRequired + " of " + requiredFields.length + " required setup fields configured.";
      }

      function summarizeHostReadiness(report) {
        const checks = (report.hostReadiness && report.hostReadiness.checks) || [];
        const overall = report.hostReadiness ? formatStatus(report.hostReadiness.overallStatus) : "Not Ready";
        const noun = checks.length === 1 ? "check" : "checks";
        return "Overall host readiness: " + overall + " across " + checks.length + " " + noun + ".";
      }

      function editableFields(report) {
        const values = Array.isArray(report && report.fields) ? report.fields.slice() : [];
        const order = new Map(editableFieldOrder.map((key, index) => [key, index]));
        return values
          .filter((field) => field && field.metadata && field.metadata.editable)
          .sort((left, right) => (order.get(left.key) ?? 999) - (order.get(right.key) ?? 999));
      }

      function normalizeReviewProviderValue(report) {
        const profile = report && report.providerPosture ? report.providerPosture.profile : "none";
        return reviewProviderOptions.some((option) => option.value === profile) ? profile : "none";
      }

      function createFieldInput(field, report) {
        if (field.key === "reviewProvider") {
          const select = document.createElement("select");
          select.id = "setup-input-" + field.key;
          select.className = "field-editor__input";
          select.disabled = saveInFlight;
          for (const option of reviewProviderOptions) {
            const optionElement = document.createElement("option");
            optionElement.value = option.value;
            optionElement.textContent = option.label;
            select.appendChild(optionElement);
          }
          select.value = normalizeReviewProviderValue(report);
          return select;
        }

        const input = document.createElement("input");
        input.id = "setup-input-" + field.key;
        input.className = "field-editor__input";
        input.type = "text";
        input.value = typeof field.value === "string" ? field.value : "";
        input.disabled = saveInFlight;
        return input;
      }

      function renderEditor(field, report) {
        const wrapper = document.createElement("div");
        wrapper.className = "field-editor";

        const label = document.createElement("div");
        label.className = "field-editor__label";
        label.textContent = field.label + (field.required ? " *" : "");
        wrapper.appendChild(label);

        const hint = document.createElement("div");
        hint.className = "field-editor__hint";
        hint.textContent = field.message;
        wrapper.appendChild(hint);

        const meta = document.createElement("div");
        meta.className = "field-editor__hint";
        meta.textContent =
          "Type: " +
          formatToken(field.metadata && field.metadata.valueType ? field.metadata.valueType : "unknown") +
          " | Current: " +
          (field.value ?? "Unset");
        wrapper.appendChild(meta);

        wrapper.appendChild(createFieldInput(field, report));
        return wrapper;
      }

      function renderForm(report) {
        currentReport = report;
        setText(
          elements.formSummary,
          report.ready
            ? "Setup is configured. You can still update the typed setup fields here."
            : "Edit the blocking setup fields and save only through the typed setup config API.",
        );

        if (!elements.editors) {
          return;
        }
        elements.editors.innerHTML = "";
        const fields = editableFields(report);
        if (fields.length === 0) {
          const empty = document.createElement("div");
          empty.className = "field-editor";
          empty.textContent = "No editable setup fields were reported.";
          elements.editors.appendChild(empty);
          return;
        }
        for (const field of fields) {
          elements.editors.appendChild(renderEditor(field, report));
        }
      }

      function setSaveStatus(message) {
        setText(elements.saveStatus, message);
      }

      function setFormDisabled(disabled) {
        saveInFlight = disabled;
        if (elements.saveButton) {
          elements.saveButton.disabled = disabled;
        }
        if (elements.localCiAdoptRecommended) {
          elements.localCiAdoptRecommended.disabled =
            disabled ||
            elements.localCiAdoptRecommended.hidden ||
            !document.getElementById("setup-input-localCiCommand");
        }
        syncRestartButton();
        for (const field of editableFields(currentReport || {})) {
          const input = document.getElementById("setup-input-" + field.key);
          if (input) {
            input.disabled = disabled;
          }
        }
      }

      function managedRestartCapability(source) {
        const capability = source && source.managedRestart && typeof source.managedRestart === "object"
          ? source.managedRestart
          : null;
        return capability && capability.supported === true
          ? capability
          : (capability || {
            supported: false,
            launcher: null,
            state: "unavailable",
            summary: "Managed restart is unavailable because this WebUI process was not started with explicit launcher-backed restart support.",
          });
      }

      function delay(ms) {
        return new Promise((resolve) => {
          setTimeout(resolve, ms);
        });
      }

      function reconnectPollDelayMs(failureCount) {
        const exponent = Math.max(0, Number(failureCount) || 0);
        return Math.min(reconnectPollInitialIntervalMs * Math.pow(2, exponent), reconnectPollMaxIntervalMs);
      }

      function syncRestartButton() {
        if (!elements.restartButton) {
          return;
        }
        const capability = managedRestartCapability(latestSaveResult || currentReport);
        elements.restartButton.disabled = (
          saveInFlight ||
          restartInFlight ||
          restartRequested ||
          !latestSaveResult ||
          !latestSaveResult.restartRequired ||
          !capability.supported
        );
      }

      function renderRestartOutcome(result) {
        if (!result) {
          restartRequested = false;
          latestSaveResult = null;
          setText(elements.restartStatus, "No recent save");
          setText(
            elements.restartDetails,
            "Save typed setup changes to see whether they take effect immediately or require a supervisor restart.",
          );
          setText(elements.restartGuidance, managedRestartCapability(currentReport).summary);
          syncRestartButton();
          return;
        }

        latestSaveResult = result;
        const capability = managedRestartCapability(result);
        const changedFields = formatFieldList(result.restartTriggeredByFields && result.restartTriggeredByFields.length > 0
          ? result.restartTriggeredByFields
          : result.updatedFields);
        if (result.restartRequired) {
          setText(elements.restartStatus, "Restart required");
          if (capability.supported) {
            setText(
              elements.restartDetails,
              "Saved changes to " +
                changedFields +
                " require a supervisor restart before they take effect. Restart now reconnects the worker while this launcher-managed WebUI shell stays available.",
            );
            setText(elements.restartGuidance, capability.summary);
          } else {
            setText(
              elements.restartDetails,
              "Saved changes to " +
                changedFields +
                " require a supervisor restart before they take effect. Restart now is unavailable for this unmanaged WebUI session. Restart the supervisor manually and then refresh this page.",
            );
            setText(elements.restartGuidance, "Manual next step: restart the supervisor process, then refresh /setup.");
          }
          syncRestartButton();
          return;
        }

        restartRequested = false;
        setText(elements.restartStatus, "Saved and effective");
        setText(
          elements.restartDetails,
          "Saved changes to " + changedFields + " are already effective. No supervisor restart is required for this save.",
        );
        setText(
          elements.restartGuidance,
          capability.supported ? capability.summary : "Restart controls remain disabled because this save is already effective.",
        );
        syncRestartButton();
      }

      async function monitorManagedRestartReconnect() {
        const pollToken = ++reconnectPollToken;
        let unsuccessfulPollCount = 0;
        setSaveStatus("Waiting for the restarted worker to reconnect...");

        while (restartRequested && pollToken === reconnectPollToken) {
          try {
            const report = await refreshSetupReadiness();
            const capability = managedRestartCapability(report);
            if (capability.state !== "ready") {
              setText(elements.restartGuidance, capability.summary);
              await delay(reconnectPollDelayMs(unsuccessfulPollCount));
              unsuccessfulPollCount += 1;
              continue;
            }

            if (latestSaveResult && latestSaveResult.restartRequired) {
              latestSaveResult = {
                ...latestSaveResult,
                restartRequired: false,
                restartScope: null,
                restartTriggeredByFields: [],
                managedRestart: capability,
              };
            }
            restartRequested = false;
            renderRestartOutcome(latestSaveResult);
            setSaveStatus("Restarted worker reconnected.");
            return;
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            setText(elements.restartGuidance, "Waiting for the restarted worker to reconnect: " + message);
            await delay(reconnectPollDelayMs(unsuccessfulPollCount));
            unsuccessfulPollCount += 1;
          }
        }
      }

      function renderSetup(report) {
        renderForm(report);
        syncRestartButton();
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
                "Current value: " + (field.value ?? "Unset"),
                "Required: " + (field.required ? "yes" : "no") + " | Source: " + formatToken(field.metadata && field.metadata.source ? field.metadata.source : "unknown") + " | Type: " + formatToken(field.metadata && field.metadata.valueType ? field.metadata.valueType : "unknown"),
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
        const localCiContract = report.localCiContract || {
          configured: false,
          command: null,
          recommendedCommand: null,
          source: "config",
          summary: "No repo-owned local CI contract is configured.",
        };
        setText(elements.localCiSummary, localCiContract.summary);
        if (elements.localCiAdoptRecommended) {
          const canAdoptRecommended = Boolean(localCiContract.recommendedCommand) && Boolean(document.getElementById("setup-input-localCiCommand"));
          elements.localCiAdoptRecommended.hidden = !canAdoptRecommended;
          elements.localCiAdoptRecommended.disabled = saveInFlight || !canAdoptRecommended;
        }
        renderChecklist(
          elements.localCiDetails,
          [{
            title: "Configured: " + (localCiContract.configured ? "yes" : "no"),
            tone: "",
            meta: [
              "Command: " + (localCiContract.command || "none"),
              "Source: " + formatToken(localCiContract.source || "unknown"),
              ...(localCiContract.recommendedCommand
                ? ["Recommended command: " + localCiContract.recommendedCommand]
                : []),
            ],
            notes: localCiContract.configured
              ? [
                "This repo-owned command is the canonical local verification step before PR publication or update.",
                "When configured local CI fails, PR publication or ready-for-review promotion stays blocked until the repo-owned command passes again.",
              ]
              : localCiContract.recommendedCommand
                ? [
                  "This repo already defines a repo-owned local CI entrypoint, but codex-supervisor will not run it until localCiCommand is configured.",
                  "This warning is advisory only; first-run setup readiness and blocker semantics stay unchanged until you opt in by configuring localCiCommand.",
                ]
              : [
                "If the repo does not declare this contract, codex-supervisor falls back to the issue's ## Verification guidance and operator workflow.",
                "When configured local CI fails, PR publication or ready-for-review promotion stays blocked until the repo-owned command passes again.",
              ],
          }],
          "No local CI contract details reported.",
        );
      }

      function collectSetupChanges() {
        if (!currentReport) {
          throw new Error("Setup readiness has not loaded yet.");
        }

        const changes = {};
        for (const field of editableFields(currentReport)) {
          const input = document.getElementById("setup-input-" + field.key);
          const rawValue = input && typeof input.value === "string" ? input.value.trim() : "";
          if (field.key === "reviewProvider") {
            if (rawValue !== "") {
              changes.reviewProvider = rawValue;
            }
            continue;
          }
          if (rawValue !== "") {
            changes[field.key] = rawValue;
          }
        }

        if (Object.keys(changes).length === 0) {
          throw new Error("Enter at least one setup value before saving.");
        }
        return changes;
      }

      async function refreshSetupReadiness() {
        const report = await readJson("/api/setup-readiness");
        renderSetup(report);
        if (!latestSaveResult) {
          renderRestartOutcome(null);
        } else {
          syncRestartButton();
        }
        return report;
      }

      async function handleSetupSubmit(event) {
        event.preventDefault();
        if (saveInFlight) {
          return;
        }

        let changes;
        try {
          changes = collectSetupChanges();
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          setSaveStatus(message);
          return;
        }

        setFormDisabled(true);
        setSaveStatus("Saving setup changes...");
        try {
          const result = await writeJson("/api/setup-config", { changes });
          setSaveStatus("Revalidating setup readiness...");
          await refreshSetupReadiness();
          renderRestartOutcome(result);
          const updatedCount = Array.isArray(result.updatedFields) ? result.updatedFields.length : Object.keys(changes).length;
          setSaveStatus("Saved " + updatedCount + " setup field" + (updatedCount === 1 ? "" : "s") + ".");
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          setSaveStatus("Setup save failed: " + message);
        } finally {
          setFormDisabled(false);
        }
      }

      async function handleManagedRestartClick() {
        const capability = managedRestartCapability(latestSaveResult || currentReport);
        if (
          restartRequested ||
          restartInFlight ||
          !latestSaveResult ||
          !latestSaveResult.restartRequired ||
          !capability.supported
        ) {
          syncRestartButton();
          return;
        }

        restartInFlight = true;
        syncRestartButton();
        setText(elements.restartGuidance, "Requesting launcher-managed restart...");
        try {
          const result = await writeJson("/api/commands/managed-restart", {});
          restartRequested = true;
          setText(elements.restartGuidance, result.summary || capability.summary);
          void monitorManagedRestartReconnect();
        } catch (error) {
          restartRequested = false;
          const message = error instanceof Error ? error.message : String(error);
          setText(elements.restartGuidance, message);
        } finally {
          restartInFlight = false;
          syncRestartButton();
        }
      }

      function handleAdoptRecommendedLocalCiClick() {
        if (!currentReport || !currentReport.localCiContract || !currentReport.localCiContract.recommendedCommand) {
          return;
        }

        const localCiInput = document.getElementById("setup-input-localCiCommand");
        if (!localCiInput) {
          return;
        }

        localCiInput.value = currentReport.localCiContract.recommendedCommand;
        setSaveStatus("Recommended local CI command copied into the setup field. Save to opt in.");
      }

      async function bootstrap() {
        if (elements.form) {
          elements.form.addEventListener("submit", handleSetupSubmit);
        }
        if (elements.localCiAdoptRecommended) {
          elements.localCiAdoptRecommended.addEventListener("click", handleAdoptRecommendedLocalCiClick);
        }
        if (elements.restartButton) {
          elements.restartButton.addEventListener("click", handleManagedRestartClick);
        }
        setSaveStatus("Loading setup readiness...");
        try {
          await refreshSetupReadiness();
          setSaveStatus("Edit the setup fields and save changes to revalidate readiness.");
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
          setSaveStatus("Setup readiness failed to load.");
        }
      }

      void bootstrap();
`;
}
