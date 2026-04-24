import { findParentIssuesReadyToClose } from "./issue-metadata";
import { doneResetPatch } from "./recovery-support";
import { type RecoveryEvent } from "./run-once-cycle-prelude";
import { type GitHubIssue, type IssueRunRecord, type SupervisorStateFile } from "./core/types";
import { type StateStore } from "./core/state-store";

type StateStoreLike = Pick<StateStore, "touch" | "save">;
type BuildRecoveryEvent = (issueNumber: number, reason: string) => RecoveryEvent;
type ApplyRecoveryEvent = (
  patch: Partial<IssueRunRecord>,
  recoveryEvent: RecoveryEvent,
) => Partial<IssueRunRecord>;

export async function reconcileParentEpicClosuresInModule(
  github: Pick<import("./github").GitHubClient, "closeIssue">,
  stateStore: StateStoreLike,
  state: SupervisorStateFile,
  issues: GitHubIssue[],
  helpers: {
    buildRecoveryEvent: BuildRecoveryEvent;
    applyRecoveryEvent: ApplyRecoveryEvent;
    createRecoveredDoneRecord: (issueNumber: number) => IssueRunRecord;
    needsRecordUpdate: (record: IssueRunRecord, patch: Partial<IssueRunRecord>) => boolean;
  },
): Promise<RecoveryEvent[]> {
  const parentIssuesReadyToClose = findParentIssuesReadyToClose(issues);
  if (parentIssuesReadyToClose.length === 0) {
    return [];
  }

  let changed = false;
  const recoveryEvents: RecoveryEvent[] = [];

  for (const { parentIssue, childIssues } of parentIssuesReadyToClose) {
    const childIssueNumbers = childIssues
      .map((childIssue) => `#${childIssue.number}`)
      .sort((left, right) => Number(left.slice(1)) - Number(right.slice(1)));
    const recoveryEvent = helpers.buildRecoveryEvent(
      parentIssue.number,
      `parent_epic_auto_closed: auto-closed parent epic #${parentIssue.number} because child issues ${childIssueNumbers.join(", ")} are closed`,
    );

    await github.closeIssue(
      parentIssue.number,
      `Closed automatically because all child issues are closed: ${childIssueNumbers.join(", ")}.`,
    );
    recoveryEvents.push(recoveryEvent);

    const existingRecord = state.issues[String(parentIssue.number)];
    if (existingRecord) {
      const patch = helpers.applyRecoveryEvent(doneResetPatch(), recoveryEvent);
      if (helpers.needsRecordUpdate(existingRecord, patch)) {
        const updated = stateStore.touch(existingRecord, patch);
        state.issues[String(parentIssue.number)] = updated;
        changed = true;
      }
      if (state.activeIssueNumber === parentIssue.number) {
        state.activeIssueNumber = null;
        changed = true;
      }
    } else {
      const created = stateStore.touch(
        helpers.createRecoveredDoneRecord(parentIssue.number),
        helpers.applyRecoveryEvent(doneResetPatch(), recoveryEvent),
      );
      state.issues[String(parentIssue.number)] = created;
      changed = true;
    }
  }

  if (changed) {
    await stateStore.save(state);
  }

  return recoveryEvents;
}
