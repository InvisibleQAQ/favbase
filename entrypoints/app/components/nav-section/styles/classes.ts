import { createClasses } from '../../../theme/create-classes';

/**
 * Stable slot classes for the nav (Minimal `nav-section/styles/classes.ts`
 * minus `horizontal`). `layouts/` targets these from `sx`, and the structural
 * tests assert `state.active` on the active row, so the names are contract.
 */
export const navSectionClasses = {
  mini: createClasses('nav__section__mini'),
  vertical: createClasses('nav__section__vertical'),
  li: createClasses('nav__li'),
  ul: createClasses('nav__ul'),
  subheader: createClasses('nav__subheader'),
  dropdown: {
    root: createClasses('nav__dropdown__root'),
    paper: createClasses('nav__dropdown__paper'),
  },
  item: {
    root: createClasses('nav__item__root'),
    link: createClasses('nav__item__link'),
    icon: createClasses('nav__item__icon'),
    info: createClasses('nav__item__info'),
    texts: createClasses('nav__item__texts'),
    title: createClasses('nav__item__title'),
    arrow: createClasses('nav__item__arrow'),
    caption: createClasses('nav__item__caption'),
  },
  state: {
    open: '--open',
    active: '--active',
    disabled: '--disabled',
  },
};
