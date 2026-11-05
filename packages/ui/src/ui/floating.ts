import { observeViewport, viewportBounds } from './viewport.js';

export type FloatingOrigin = HTMLElement | { readonly x: number; readonly y: number };

/** Tracks only an open overlay; resize, content and scroll changes share one scheduled layout pass. */
export function trackFloating(popup: HTMLElement, origin: () => FloatingOrigin, options: { width: number; align?: 'start' | 'end' }) {
  let frame = 0, stop: (() => void) | undefined;
  let lastWidth = 0, lastHeight = 0;
  const set = (key: 'width' | 'maxHeight' | 'left' | 'top', value: number) => {
    const next = Math.max(0, value) + 'px';
    if (popup.style[key] !== next) popup.style[key] = next;
  };
  function position() {
    frame = 0;
    if (!popup.matches(':popover-open')) return;
    const viewport = viewportBounds(), margin = 8, gap = 6;
    const leftEdge = viewport.left + margin, topEdge = viewport.top + margin;
    const rightEdge = viewport.right - margin, bottomEdge = viewport.bottom - margin;
    const width = Math.max(0, Math.min(options.width, viewport.width - margin * 2));
    set('width', width);
    // Measure unconstrained content once, then fit it to the available side.
    popup.style.maxHeight = 'none';
    const desired = popup.getBoundingClientRect().height;
    const anchor = origin();
    let left: number, top: number, room = Math.max(0, viewport.height - margin * 2);
    if (anchor instanceof HTMLElement) {
      const bounds = anchor.getBoundingClientRect();
      const below = Math.max(0, bottomEdge - bounds.bottom - gap);
      const above = Math.max(0, bounds.top - gap - topEdge);
      const down = below >= desired || below >= above;
      room = Math.min(room, down ? below : above);
      left = options.align === 'end' ? bounds.right - width : bounds.left;
      top = down ? bounds.bottom + gap : bounds.top - gap - Math.min(desired, room);
    } else {
      left = anchor.x + width > rightEdge ? anchor.x - width : anchor.x;
      top = anchor.y + desired > bottomEdge ? anchor.y - Math.min(desired, room) : anchor.y;
    }
    const height = Math.min(desired, room);
    set('maxHeight', room);
    set('left', Math.max(leftEdge, Math.min(left, rightEdge - width)));
    set('top', Math.max(topEdge, Math.min(top, bottomEdge - height)));
    const bounds = popup.getBoundingClientRect();
    lastWidth = bounds.width; lastHeight = bounds.height;
  }
  function schedule() { if (!frame) frame = requestAnimationFrame(position); }
  function start() {
    if (stop) return;
    // WebKit caches intrinsic row heights when opening an unconstrained popover.
    set('width', Math.min(options.width, viewportBounds().width - 16));
    const unobserve = observeViewport(schedule);
    const resize = new ResizeObserver(() => {
      const bounds = popup.getBoundingClientRect();
      if (bounds.width !== lastWidth || bounds.height !== lastHeight) schedule();
    });
    const mutation = new MutationObserver(schedule);
    resize.observe(popup);
    mutation.observe(popup, { childList: true, subtree: true, characterData: true });
    function scroll(event: Event) {
      const anchor = origin();
      if (anchor instanceof HTMLElement && event.target instanceof Element && event.target.contains(anchor)) schedule();
    }
    document.addEventListener('scroll', scroll, true);
    stop = () => {
      unobserve(); resize.disconnect(); mutation.disconnect();
      document.removeEventListener('scroll', scroll, true);
      cancelAnimationFrame(frame); frame = 0; stop = undefined;
    };
    // beforetoggle runs before the top layer opens; size it in the same turn, before paint.
    queueMicrotask(() => { if (stop) { cancelAnimationFrame(frame); position(); } });
  }
  function toggle(event: ToggleEvent) { if (event.newState === 'open') start(); else stop?.(); }
  popup.addEventListener('beforetoggle', toggle);
  if (popup.matches(':popover-open')) start();
  return () => { stop?.(); popup.removeEventListener('beforetoggle', toggle); };
}
