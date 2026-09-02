import { themeConfig } from './theme-config';

/**
 * Builds a stable, prefixed class name for a shared primitive's slot, so styles
 * can be targeted from a parent's `sx` without depending on emotion's generated
 * hashes. Mirrors Minimal `theme/create-classes.ts`.
 *
 * `createClasses('label__root')` → `favbase__label__root`.
 */
export function createClasses(className: string): string {
  return `${themeConfig.classesPrefix}__${className}`;
}
