export function normalizeDashboardPanelOrder<TPanelId extends string>(
  requestedOrder: readonly string[] | null | undefined,
  defaultOrder: readonly TPanelId[],
): TPanelId[] {
  const knownPanelIds = new Set(defaultOrder);
  const normalizedOrder: TPanelId[] = [];

  for (const candidate of Array.isArray(requestedOrder) ? requestedOrder : []) {
    if (!knownPanelIds.has(candidate as TPanelId) || normalizedOrder.includes(candidate as TPanelId)) {
      continue;
    }
    normalizedOrder.push(candidate as TPanelId);
  }

  for (const panelId of defaultOrder) {
    if (!normalizedOrder.includes(panelId)) {
      normalizedOrder.push(panelId);
    }
  }

  return normalizedOrder;
}

export function restoreDashboardPanelOrder<TPanelId extends string>(
  serializedLayout: string | null | undefined,
  defaultOrder: readonly TPanelId[],
): TPanelId[] {
  if (typeof serializedLayout !== "string" || serializedLayout.trim() === "") {
    return normalizeDashboardPanelOrder(null, defaultOrder);
  }

  try {
    const parsed = JSON.parse(serializedLayout) as { order?: readonly string[] | null } | readonly string[] | null;
    if (Array.isArray(parsed)) {
      return normalizeDashboardPanelOrder(parsed, defaultOrder);
    }
    if (parsed && typeof parsed === "object" && "order" in parsed) {
      return normalizeDashboardPanelOrder(parsed.order, defaultOrder);
    }
  } catch {}

  return normalizeDashboardPanelOrder(null, defaultOrder);
}

export function serializeDashboardPanelOrder<TPanelId extends string>(
  currentOrder: readonly string[] | null | undefined,
  defaultOrder: readonly TPanelId[],
): string {
  return JSON.stringify({
    order: normalizeDashboardPanelOrder(currentOrder, defaultOrder),
  });
}

export function applyDashboardPanelDrop<TPanelId extends string>(
  currentOrder: readonly string[] | null | undefined,
  draggedPanelId: TPanelId | null | undefined,
  targetPanelId: TPanelId | null | undefined,
  defaultOrder: readonly TPanelId[],
): TPanelId[] {
  const normalizedOrder = normalizeDashboardPanelOrder(currentOrder, defaultOrder);
  if (!draggedPanelId || !targetPanelId || draggedPanelId === targetPanelId) {
    return normalizedOrder;
  }
  if (!normalizedOrder.includes(draggedPanelId) || !normalizedOrder.includes(targetPanelId)) {
    return normalizedOrder;
  }

  const nextOrder = normalizedOrder.filter((panelId) => panelId !== draggedPanelId);
  const targetIndex = nextOrder.indexOf(targetPanelId);
  if (targetIndex < 0) {
    return normalizedOrder;
  }
  nextOrder.splice(targetIndex, 0, draggedPanelId);
  return nextOrder;
}
