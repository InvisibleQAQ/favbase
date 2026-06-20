import { themeConfig } from '../../theme/theme-config';

function createClasses(className: string): string {
  return `${themeConfig.classesPrefix}__${className}`;
}

export const layoutClasses = {
  root: createClasses('layout__root'),
  main: createClasses('layout__main'),
  header: createClasses('layout__header'),
  content: createClasses('layout__main__content'),
  sidebarContainer: createClasses('layout__sidebar__container'),
};
