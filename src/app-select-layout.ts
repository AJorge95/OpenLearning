export function shouldCloseAppSelectForLayoutChange(
  eventTarget: EventTarget | null,
  menuElement: Pick<Node, 'contains'> | null,
) {
  if (!eventTarget || !menuElement || typeof (eventTarget as Node).nodeType !== 'number') return true;
  return !menuElement.contains(eventTarget as Node);
}
