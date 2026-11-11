/**
 * Minimal pointer-based drag & drop (mouse and touch). A press that moves less than
 * THRESHOLD pixels stays a normal click, so tapping keeps working as before.
 */
const THRESHOLD = 6;

export interface DragHandlers {
  /** Which element (if any) a press on `target` would drag. */
  source(target: HTMLElement): HTMLElement | null;
  /** Called while dragging with the element under the pointer (or null). */
  over?(under: HTMLElement | null, source: HTMLElement): void;
  /** Called on release with the element under the pointer (or null). */
  drop(under: HTMLElement | null, source: HTMLElement): void;
  /** Called after a drag ends, dropped or cancelled. */
  end?(): void;
}

export function enableDrag(root: HTMLElement, h: DragHandlers): void {
  root.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const src = h.source(e.target as HTMLElement);
    if (!src) return;
    const startX = e.clientX;
    const startY = e.clientY;
    let clone: HTMLElement | null = null;
    let offX = 0;
    let offY = 0;

    const underPointer = (x: number, y: number) => document.elementFromPoint(x, y) as HTMLElement | null;

    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      if (!clone) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < THRESHOLD) return;
        const rect = src.getBoundingClientRect();
        offX = startX - rect.left;
        offY = startY - rect.top;
        clone = src.cloneNode(true) as HTMLElement;
        clone.classList.add('drag-clone');
        clone.style.width = `${rect.width}px`;
        clone.style.height = `${rect.height}px`;
        document.body.appendChild(clone);
        src.classList.add('drag-source');
        root.classList.add('dragging');
      }
      ev.preventDefault();
      clone.style.transform = `translate(${ev.clientX - offX}px, ${ev.clientY - offY}px) rotate(-4deg)`;
      h.over?.(underPointer(ev.clientX, ev.clientY), src);
    };

    const finish = (ev: PointerEvent, dropped: boolean) => {
      if (ev.pointerId !== e.pointerId) return;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      if (!clone) return;
      clone.remove();
      src.classList.remove('drag-source');
      root.classList.remove('dragging');
      // The release would otherwise also count as a click on whatever is underneath.
      const swallow = (ce: Event) => {
        ce.stopPropagation();
        ce.preventDefault();
      };
      window.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
      if (dropped) h.drop(underPointer(ev.clientX, ev.clientY), src);
      h.end?.();
    };
    const up = (ev: PointerEvent) => finish(ev, true);
    const cancel = (ev: PointerEvent) => finish(ev, false);

    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
  });
}
