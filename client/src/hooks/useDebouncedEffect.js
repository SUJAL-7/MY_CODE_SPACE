import { useEffect, useRef } from "react";

/**
 * Runs effect after `delay` ms since last change in `deps`.
 * Cleans on unmount.
 */
export default function useDebouncedEffect(effect, deps, delay = 500) {
  const handlerRef = useRef();
  useEffect(() => {
    clearTimeout(handlerRef.current);
    handlerRef.current = setTimeout(() => {
      effect();
    }, delay);
    return () => clearTimeout(handlerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, delay]);
}