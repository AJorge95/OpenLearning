type ClipboardDocument = Pick<Document, 'activeElement' | 'body' | 'createElement' | 'execCommand'>;

type ClipboardDependencies = {
  clipboard?: Pick<Clipboard, 'writeText'> | null;
  document?: ClipboardDocument | null;
};

export async function copyTextToClipboard(text: string, dependencies: ClipboardDependencies = {}) {
  const clipboard = dependencies.clipboard === undefined && typeof navigator !== 'undefined'
    ? navigator.clipboard
    : dependencies.clipboard;

  if (clipboard?.writeText) {
    try {
      await clipboard.writeText(text);
      return;
    } catch {
      // Fall through to the selection-based copy for restricted clipboard contexts.
    }
  }

  const documentRef = dependencies.document ?? (typeof document !== 'undefined' ? document : null);
  if (!documentRef?.body || !documentRef.execCommand) throw new Error('Clipboard copy is unavailable');

  // The self-hosted install can serve plain HTTP, where the async Clipboard API is unavailable.
  const textarea = documentRef.createElement('textarea');
  const previousActiveElement = documentRef.activeElement;
  const restoreFocus = previousActiveElement && 'focus' in previousActiveElement
    ? (previousActiveElement as HTMLElement).focus.bind(previousActiveElement)
    : undefined;

  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.setAttribute('aria-hidden', 'true');
  textarea.tabIndex = -1;
  Object.assign(textarea.style, { position: 'fixed', top: '0', left: '-10000px', opacity: '0' });
  documentRef.body.appendChild(textarea);

  let copied = false;
  try {
    textarea.select();
    copied = documentRef.execCommand('copy');
  } finally {
    textarea.remove();
    restoreFocus?.();
  }

  if (!copied) throw new Error('Clipboard copy was rejected');
}
