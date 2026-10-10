export function getAppSelectHorizontalPosition(
  trigger: Pick<DOMRect, 'left' | 'width'>,
  viewportWidth: number,
  minimumWidth = 220,
) {
  const safeViewportWidth = Math.max(1, viewportWidth);
  const margin = Math.min(12, Math.max(0, (safeViewportWidth - 1) / 2));
  const maxWidth = Math.max(1, safeViewportWidth - margin * 2);
  const width = Math.min(Math.max(trigger.width, minimumWidth), maxWidth);
  const maxLeft = safeViewportWidth - width - margin;
  const left = Math.max(margin, Math.min(trigger.left, maxLeft));

  return { left, width };
}

export function getAppSelectVerticalPosition(
  trigger: Pick<DOMRect, 'top' | 'bottom'>,
  viewportHeight: number,
  optionCount: number,
) {
  const safeViewportHeight = Math.max(1, viewportHeight);
  const margin = Math.min(12, Math.max(0, (safeViewportHeight - 1) / 2));
  const availableHeight = Math.max(1, safeViewportHeight - margin * 2);
  const desiredHeight = Math.min(280, optionCount * 41 + 11, availableHeight);
  const roomBelow = Math.max(0, safeViewportHeight - trigger.bottom - margin);
  const roomAbove = Math.max(0, trigger.top - margin);
  const openAbove = roomBelow < desiredHeight && roomAbove > roomBelow;
  const roomOnChosenSide = openAbove ? roomAbove : roomBelow;
  const maxHeight = Math.max(1, Math.min(desiredHeight, roomOnChosenSide - 6));
  const preferredTop = openAbove ? trigger.top - maxHeight - 6 : trigger.bottom + 6;
  const maxTop = safeViewportHeight - maxHeight - margin;
  const top = Math.max(margin, Math.min(preferredTop, maxTop));

  return { top, maxHeight };
}
