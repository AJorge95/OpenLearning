type AppSelectActivation = Pick<MouseEvent, 'detail' | 'clientX' | 'clientY'>;
type AppSelectTriggerBounds = Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>;

export function isAppSelectActivationWithinTrigger(activation: AppSelectActivation, bounds: AppSelectTriggerBounds) {
  // Keyboard and assistive-technology clicks have no pointer coordinates to constrain.
  if (activation.detail === 0) return true;
  return activation.clientX >= bounds.left && activation.clientX <= bounds.right
    && activation.clientY >= bounds.top && activation.clientY <= bounds.bottom;
}
