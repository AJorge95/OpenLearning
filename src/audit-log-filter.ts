export type AuditActionCount = { action: string; count: number };
export type AuditActionOption = { value: string; label: string };

export function buildAuditActionOptions(
  actions: readonly AuditActionCount[],
  selectedAction: string,
): AuditActionOption[] {
  const selectedActionIsRetained = actions.some((item) => item.action === selectedAction);

  // Keep a pruned selection visible so the active filter never becomes anonymous.
  return [
    { value: '', label: 'All actions' },
    ...(selectedAction && !selectedActionIsRetained
      ? [{ value: selectedAction, label: `${selectedAction.replaceAll('_', ' ')} (no longer retained)` }]
      : []),
    ...actions.map((item) => ({
      value: item.action,
      label: `${item.action.replaceAll('_', ' ')} (${item.count})`,
    })),
  ];
}
