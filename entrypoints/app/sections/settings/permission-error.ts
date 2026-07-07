import type { PermissionDenyReason } from '@/lib/permissions/host-access';

/** Map a host-permission deny reason to its locale key (UI side of the i18n seam). */
export function permissionErrorKey(reason: PermissionDenyReason) {
  switch (reason) {
    case 'invalid-url':
      return 'settings.permission.invalidUrl';
    case 'unsupported-scheme':
      return 'settings.permission.unsupportedScheme';
    case 'denied':
      return 'settings.permission.denied';
  }
}
