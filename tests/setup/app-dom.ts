/**
 * DOM shims happy-dom does not provide.
 *
 * Only `ResizeObserver`, and only because two shared primitives observe element
 * size: `Scrollbar` (through simplebar) and `CustomPopover` (to keep its arrow
 * centred on the anchor). The stub records observers without firing them —
 * these components must render correctly before the first measurement, which is
 * exactly what the structural tests assert.
 */
class ResizeObserverStub implements ResizeObserver {
  observe(): void {}

  unobserve(): void {}

  disconnect(): void {}
}

if (!('ResizeObserver' in globalThis)) {
  Object.defineProperty(globalThis, 'ResizeObserver', {
    writable: true,
    configurable: true,
    value: ResizeObserverStub,
  });
}
