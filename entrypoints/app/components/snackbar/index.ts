export { Snackbar } from './snackbar';
export { snackbarClasses } from './classes';

/**
 * The only sanctioned door to sonner (docs/25 rule 6, guarded by
 * `tests/ui-vendor-boundaries.test.ts`): business code imports `toast` from
 * here, never from the package, so the skin above can never be bypassed.
 * `Toaster` is deliberately not re-exported — a second, unskinned region would
 * silently swallow half the app's toasts.
 */
export { toast } from 'sonner';
