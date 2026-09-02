import { useState, useEffect, useCallback } from 'react';

/** Parses a CSS length to a number, treating anything unparseable as 0. */
function toNumber(value: string | null): number {
  if (!value) return 0;
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Pulls the x/y pair out of a CSS `translate` value. */
function extractTranslate(translate: string): { translateX: number; translateY: number } {
  if (!translate || translate === 'none') return { translateX: 0, translateY: 0 };

  const [x, y] = translate.split(' ');

  return {
    translateX: toNumber(x),
    translateY: toNumber(y),
  };
}

export interface ElementRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * Tracks an element's box while the popover is open.
 *
 * The paper is measured from computed style rather than `getBoundingClientRect`
 * because MUI is mid-transition when it first mounts and the rect would capture
 * the scaled-down frame.
 */
export function useElementRect<T extends HTMLElement>(
  element: T | null,
  context: 'anchor' | 'popoverPaper',
  open: boolean,
): ElementRect | null {
  const [rect, setRect] = useState<ElementRect | null>(null);

  const updateRect = useCallback(() => {
    if (!element || !open) return;

    let nextRect: ElementRect;

    if (context === 'popoverPaper') {
      const { top, left, width, height, marginTop, marginLeft, translate } =
        getComputedStyle(element);
      const { translateX, translateY } = extractTranslate(translate);

      nextRect = {
        width: toNumber(width),
        height: toNumber(height),
        top: toNumber(top) + toNumber(marginTop) + translateY,
        left: toNumber(left) + toNumber(marginLeft) + translateX,
      };
    } else {
      const domRect = element.getBoundingClientRect();

      nextRect = {
        top: domRect.top,
        left: domRect.left,
        width: domRect.width,
        height: domRect.height,
      };
    }

    setRect(nextRect);
  }, [context, element, open]);

  useEffect(() => {
    if (!element || !open) return undefined;

    updateRect();

    const resizeObserver = new ResizeObserver(updateRect);
    resizeObserver.observe(element);

    window.addEventListener('resize', updateRect, { passive: true });
    window.addEventListener('scroll', updateRect, { capture: true });

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', updateRect);
      window.removeEventListener('scroll', updateRect, { capture: true });
    };
  }, [element, open, updateRect]);

  return rect;
}
