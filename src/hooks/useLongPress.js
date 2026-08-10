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
  // True for the brief window between a long-press actually firing and the
  // resulting click (browsers synthesize a native click on release even
  // after a long hold, since nothing here calls preventDefault on pointerup
  // itself — that event fires before the click even exists). Without this,
  // long-pressing directly on a nested interactive element (e.g. a <button>
  // inside the long-press zone, like Dashboard's Balance/End of Month card)
  // fires BOTH onLongPress and that element's own onClick from one gesture.
  const firedRef = useRef(false);

  const clear = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
  }, []);

  const onPointerDown = useCallback((e) => {
    startPos.current = { x: e.clientX, y: e.clientY };
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      firedRef.current = true;
      navigator.vibrate?.(15);
      onLongPress();
    }, THRESHOLD_MS);
  }, [onLongPress]);

  const onPointerMove = useCallback((e) => {
    if (!timerRef.current) return;
    if (Math.hypot(e.clientX - startPos.current.x, e.clientY - startPos.current.y) > MOVE_CANCEL_PX) clear();
  }, [clear]);

  // Capture phase, on the same element the long-press props are spread
  // onto — runs before the click reaches any nested element's own onClick,
  // so it can swallow exactly the one click produced by the gesture that
  // just fired a long-press. A genuine later tap has firedRef already reset
  // to false, so it's never affected.
  const onClickCapture = useCallback((e) => {
    if (firedRef.current) {
      firedRef.current = false;
      e.preventDefault();
      e.stopPropagation();
    }
  }, []);

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: clear,
    onPointerLeave: clear,
    onPointerCancel: clear,
    // Prevents the native context menu (copy/select) some mobile browsers
    // show on a long touch-hold, which would otherwise fire alongside ours.
    onContextMenu: e => e.preventDefault(),
    onClickCapture,
  };
}
