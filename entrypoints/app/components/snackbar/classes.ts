import { createClasses } from '../../theme/create-classes';

/**
 * Slot class names for the sonner toast tree. sonner runs `unstyled`, so every
 * visual rule in `styles.tsx` hangs off one of these — they are the only handle
 * emotion has on markup it does not own.
 *
 * Mirrors Minimal `components/snackbar/classes.ts`.
 */
export const snackbarClasses = {
  root: createClasses('snackbar__root'),
  toast: createClasses('snackbar__toast'),
  /********/
  title: createClasses('snackbar__title'),
  content: createClasses('snackbar__content'),
  description: createClasses('snackbar__description'),
  /********/
  icon: createClasses('snackbar__icon'),
  loaderVisible: '&[data-visible="true"]',
  loader: createClasses('snackbar__loader'),
  loading: createClasses('snackbar__loading'),
  iconSvg: createClasses('snackbar__icon__svg'),
  loadingIcon: createClasses('snackbar__loading_icon'),
  /********/
  default: '&:not([data-type])',
  error: createClasses('snackbar__error'),
  success: createClasses('snackbar__success'),
  warning: createClasses('snackbar__warning'),
  info: createClasses('snackbar__info'),
  /********/
  closeButton: createClasses('snackbar__close_button'),
  actionButton: createClasses('snackbar__action__button'),
  cancelButton: createClasses('snackbar__cancel__button'),
  closeBtnVisible: '[data-close-button="true"]',
  /********/
  unset: createClasses('snackbar__unset'),
};
