type AppSelectActivation = Pick<MouseEvent, 'detail' | 'clientX' | 'clientY'>;
type AppSelectTriggerBounds = Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>;

let pointerTrackingSubscribers = 0;
let lastPointerDownTarget: EventTarget | null = null;

function rememberPointerDown(event: PointerEvent) {
  lastPointerDownTarget = event.target;
}

export function subscribeToAppSelectPointerTracking() {
  // Share one capture listener across mounted selects instead of adding one per control.
  if (pointerTrackingSubscribers === 0) {
    document.addEventListener('pointerdown', rememberPointerDown, true);
  }
  pointerTrackingSubscribers += 1;

  return () => {
    pointerTrackingSubscribers -= 1;
    if (pointerTrackingSubscribers === 0) {
      document.removeEventListener('pointerdown', rememberPointerDown, true);
      lastPointerDownTarget = null;
    }
  };
}

export function isAppSelectPointerDownWithinTrigger(trigger: HTMLElement) {
  return lastPointerDownTarget instanceof Node && trigger.contains(lastPointerDownTarget);
}

export function clearAppSelectPointerDownTarget() {
  lastPointerDownTarget = null;
}

export function isAppSelectActivationWithinTrigger(
  activation: AppSelectActivation,
  bounds: AppSelectTriggerBounds,
  pointerStartedWithinTrigger: boolean,
) {
  // A label-forwarded pointer click can report coordinates inside the button even when the pointer hit blank label space.
  if (activation.detail > 0 && !pointerStartedWithinTrigger) return false;
  // Keyboard and assistive-technology clicks without pointer coordinates must remain usable.
  if (activation.detail === 0 && activation.clientX === 0 && activation.clientY === 0) return true;
  return activation.clientX >= bounds.left && activation.clientX <= bounds.right
    && activation.clientY >= bounds.top && activation.clientY <= bounds.bottom;
}
