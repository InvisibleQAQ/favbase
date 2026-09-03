// @vitest-environment happy-dom

import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ThemeProvider } from '../../theme/theme-provider';
import { DonutChart, type DonutSegment } from './donut-chart';

/** Same geometry the component derives from its defaults (size 200 / thickness 24). */
const STROKE = (24 / 200) * 100;
const RADIUS = (100 - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** Six platform-shaped segments summing to 1, like a real snapshot. */
function segments(): DonutSegment[] {
  return [
    { id: 'bilibili', share: 0.5, color: 'rgb(1, 1, 1)' },
    { id: 'github', share: 0.25, color: 'rgb(2, 2, 2)' },
    { id: 'bookmarks', share: 0.125, color: 'rgb(3, 3, 3)' },
    { id: 'x', share: 0.125, color: 'rgb(4, 4, 4)' },
    { id: 'zhihu', share: 0, color: 'rgb(5, 5, 5)' },
    { id: 'youtube', share: 0, color: 'rgb(6, 6, 6)' },
  ];
}

/** The drawn length of each arc — the first value of its dasharray pair. */
function arcLengths(root: ParentNode): number[] {
  return Array.from(root.querySelectorAll('circle[data-segment]')).map((arc) =>
    Number(arc.getAttribute('stroke-dasharray')?.split(' ')[0]),
  );
}

describe('DonutChart', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const render = (node: ReactElement) => {
    act(() => {
      root.render(<ThemeProvider>{node}</ThemeProvider>);
    });
    return container.firstElementChild as HTMLElement;
  };

  it('spends the full circumference on the segments and offsets each by the ones before it', () => {
    render(<DonutChart segments={segments()} trackColor="rgb(9, 9, 9)" />);

    const lengths = arcLengths(container);
    expect(lengths).toHaveLength(4);
    expect(lengths.reduce((sum, length) => sum + length, 0)).toBeCloseTo(CIRCUMFERENCE, 6);

    // Each arc starts where the previous ones ended (offsets are negative).
    const offsets = Array.from(container.querySelectorAll('circle[data-segment]')).map((arc) =>
      Number(arc.getAttribute('stroke-dashoffset')),
    );
    expect(offsets[0]).toBe(0);
    expect(offsets[1]).toBeCloseTo(-0.5 * CIRCUMFERENCE, 6);
    expect(offsets[2]).toBeCloseTo(-0.75 * CIRCUMFERENCE, 6);
    expect(offsets[3]).toBeCloseTo(-0.875 * CIRCUMFERENCE, 6);
  });

  it('draws no arc for a zero share, but always draws the track', () => {
    render(<DonutChart segments={segments()} trackColor="rgb(9, 9, 9)" />);
    expect(container.querySelectorAll('circle[data-segment]')).toHaveLength(4);
    expect(container.querySelectorAll('circle')).toHaveLength(5); // 4 arcs + track

    // An all-zero snapshot (empty library) is a bare ring, not a broken chart.
    const allZero = segments().map((segment) => ({ ...segment, share: 0 }));
    render(<DonutChart segments={allZero} trackColor="rgb(9, 9, 9)" />);
    expect(container.querySelectorAll('circle[data-segment]')).toHaveLength(0);
    const track = container.querySelector('circle');
    expect(track?.getAttribute('stroke')).toBe('rgb(9, 9, 9)');
  });

  it('hides itself from assistive tech and still prints the caller centre figure', () => {
    const el = render(
      <DonutChart segments={segments()} trackColor="rgb(9, 9, 9)" center={<span>1,024</span>} />,
    );

    // The chart carries no meaning alone: the legend and the KPI cards print
    // every figure it shows, so the whole block is hidden rather than labelled.
    expect(el.getAttribute('aria-hidden')).toBe('true');
    expect(el.querySelector('svg')).not.toBeNull();
    expect(el.textContent).toBe('1,024');
  });
});
