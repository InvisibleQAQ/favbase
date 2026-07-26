import { useEffect, useState } from 'react';
import { useReducedMotion } from 'motion/react';

export interface Typewriter {
  /** The prefix revealed so far. */
  visible: string;
  /** True once the whole string is out (drives caret / next-step reveals). */
  done: boolean;
}

/**
 * Reveal `text` character by character once `active` flips true, and rewind when
 * it flips back. Under reduced motion the full string lands immediately —
 * a stream animation has no calm variant worth showing.
 */
export function useTypewriter(text: string, active: boolean, msPerChar = 24): Typewriter {
  const reduceMotion = useReducedMotion();
  const [count, setCount] = useState(0);

  useEffect(() => {
    const total = [...text].length;

    if (!active) {
      setCount(0);
      return;
    }
    if (reduceMotion) {
      setCount(total);
      return;
    }

    let revealed = 0;
    const timer = setInterval(() => {
      revealed += 1;
      setCount(revealed);
      if (revealed >= total) clearInterval(timer);
    }, msPerChar);

    return () => clearInterval(timer);
  }, [text, active, msPerChar, reduceMotion]);

  const chars = [...text];
  return { visible: chars.slice(0, count).join(''), done: count >= chars.length };
}
