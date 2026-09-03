import Portal from '@mui/material/Portal';

import { useTranslation } from '@/lib/i18n/use-translation';
import { Iconify } from '../iconify';
import { SnackbarRoot } from './styles';
import { snackbarClasses } from './classes';

/**
 * The app's single toast region (Minimal `components/snackbar/snackbar.tsx`).
 * Mounted once in `App.tsx`; every `toast.*` call anywhere in app.html lands
 * here. Portalled so a scrolling or `overflow: hidden` route cannot clip it.
 */
export function Snackbar() {
  const { t } = useTranslation();

  return (
    <Portal>
      <SnackbarRoot
        expand
        closeButton
        gap={12}
        offset={16}
        visibleToasts={4}
        position="top-right"
        className={snackbarClasses.root}
        // sonner's own default is the English "Notifications"; the region is
        // announced to screen readers, so it follows the UI locale.
        containerAriaLabel={t('snackbar.regionLabel')}
        toastOptions={{
          unstyled: true,
          // Same reason as the region label: sonner's own default is the
          // English "Close toast", and `closeButton` puts that name on an
          // icon-only control in every toast (ui-design-system section 12).
          closeButtonAriaLabel: t('snackbar.closeAria'),
          classNames: {
            toast: snackbarClasses.toast,
            icon: snackbarClasses.icon,
            loader: snackbarClasses.loader,
            loading: snackbarClasses.loading,
            /********/
            content: snackbarClasses.content,
            title: snackbarClasses.title,
            description: snackbarClasses.description,
            /********/
            closeButton: snackbarClasses.closeButton,
            actionButton: snackbarClasses.actionButton,
            cancelButton: snackbarClasses.cancelButton,
            /********/
            info: snackbarClasses.info,
            error: snackbarClasses.error,
            success: snackbarClasses.success,
            warning: snackbarClasses.warning,
          },
        }}
        icons={{
          loading: <span className={snackbarClasses.loadingIcon} />,
          info: <Iconify className={snackbarClasses.iconSvg} icon="solar:info-circle-bold" />,
          success: <Iconify className={snackbarClasses.iconSvg} icon="solar:check-circle-bold" />,
          warning: (
            <Iconify className={snackbarClasses.iconSvg} icon="solar:danger-triangle-bold" />
          ),
          error: <Iconify className={snackbarClasses.iconSvg} icon="solar:danger-bold" />,
        }}
      />
    </Portal>
  );
}
