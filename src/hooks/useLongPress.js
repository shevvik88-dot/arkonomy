import { useCallback, useRef } from "react";

// Pointer Events (unified mouse+touch, no separate touch/mouse listeners).
// A quick tap never reaches the threshold, so the timer is cleared on
// pointerup before firing — existing onClick handlers on the same element
// (or nested inside it) keep working unchanged, this is an orthogonal path.
const THRESHOLD_MS = 500;
const MOVE_CANCEL_PX = 10;

export function useLongPress(onLongPress) {
  const timerRef = useRef(null);
  const startPos = useRef({ x: 0, y: 0 });

  const clear = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
  }, []);

  const onPointerDown = useCallback((e) => {
    startPos.current = { x: e.clientX, y: e.clientY };
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      navigator.vibrate?.(15);
      onLongPress();
    }, THRESHOLD_MS);
  }, [onLongPress]);

  const onPointerMove = useCallback((e) => {
    if (!timerRef.current) return;
    if (Math.hypot(e.clientX - startPos.current.x, e.clientY - startPos.current.y) > MOVE_CANCEL_PX) clear();
  }, [clear]);

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: clear,
    onPointerLeave: clear,
    onPointerCancel: clear,
    // Prevents the native context menu (copy/select) some mobile browsers
    // show on a long touch-hold, which would otherwise fire alongside ours.
    onContextMenu: e => e.preventDefault(),
  };
}
