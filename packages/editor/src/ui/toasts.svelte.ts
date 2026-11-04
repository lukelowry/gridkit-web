/** A message over the workspace, which never moves what is under it. */
export interface Toast {
  readonly id: number;
  readonly key: string | undefined;
  readonly text: string;
  /** Errors stay until dismissed; information leaves on its own. */
  readonly tone: 'error' | 'info';
  /** A file the message offers, such as a run's log, and the name it saves as. */
  readonly link?: { readonly label: string; readonly href: string; readonly file: string } | undefined;
  /** What to do about it, such as running again; choosing it dismisses the message. */
  readonly action?: { readonly label: string; readonly run: () => void } | undefined;
}

const linger = 6_000, most = 3;
const timers = new Map<number, ReturnType<typeof setTimeout>>();
let last = 0;
export const toasts: Toast[] = $state([]);

/** Shows `text`, replacing an earlier toast with the same `key`; the oldest of more than three gives way. */
export function notify(text: string, { tone = 'error', link, action, key }: { tone?: Toast['tone']; link?: Toast['link']; action?: Toast['action']; key?: string } = {}) {
  if (key) dismiss(...toasts.filter(toast => toast.key === key).map(toast => toast.id));
  const toast: Toast = { id: ++last, key, text, tone, link, action };
  toasts.push(toast);
  if (toasts.length > most) dismiss(toasts[0]!.id);
  if (tone === 'info') timers.set(toast.id, setTimeout(() => dismiss(toast.id), linger));
}

export function dismiss(...ids: number[]) {
  for (const id of ids) {
    clearTimeout(timers.get(id)); timers.delete(id);
    const index = toasts.findIndex(toast => toast.id === id);
    if (index >= 0) toasts.splice(index, 1);
  }
}
