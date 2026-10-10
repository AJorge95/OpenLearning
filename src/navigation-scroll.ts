type HorizontalBounds = { left: number; right: number };

export function getHorizontalRevealScrollLeft(
  container: HorizontalBounds,
  target: HorizontalBounds,
  currentScrollLeft: number,
  padding = 12,
): number {
  if (target.left < container.left) {
    return Math.max(0, currentScrollLeft + target.left - container.left - padding);
  }
  if (target.right > container.right) {
    return currentScrollLeft + target.right - container.right + padding;
  }
  return currentScrollLeft;
}
