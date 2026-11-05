/** The visible viewport, including keyboard shrink and pinch/pan offsets. */
export function viewportBounds() {
  const viewport = window.visualViewport;
  const left = viewport?.offsetLeft ?? 0, top = viewport?.offsetTop ?? 0;
  const width = viewport?.width ?? window.innerWidth, height = viewport?.height ?? window.innerHeight;
  return { left, top, width, height, right: left + width, bottom: top + height };
}

export function observeViewport(update: () => void) {
  const viewport = window.visualViewport;
  window.addEventListener('resize', update);
  viewport?.addEventListener('resize', update);
  viewport?.addEventListener('scroll', update);
  return () => {
    window.removeEventListener('resize', update);
    viewport?.removeEventListener('resize', update);
    viewport?.removeEventListener('scroll', update);
  };
}
