import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';

import { Iconify } from '../../components/iconify';
import type { IconifyName } from '../../components/iconify';

export interface SettingsTabItem {
  value: string;
  label: string;
  icon: IconifyName;
}

interface SettingsTabsProps {
  value: string;
  onChange: (value: string) => void;
  tabs: SettingsTabItem[];
  ariaLabel: string;
}

/**
 * Settings top-level tabs — Minimal's underline form, straight off the theme
 * defaults (`scrollable`, `textColor`/`indicatorColor: 'inherit'`, 40px list
 * gap). No local variant switch: one track at every width, horizontally
 * scrollable when four localized labels outgrow it.
 */
export function SettingsTabs({ value, onChange, tabs, ariaLabel }: SettingsTabsProps) {
  return (
    <Tabs
      value={value}
      onChange={(_, v) => onChange(v)}
      aria-label={ariaLabel}
      // Centering the whole track is a deliberate local override of Minimal's
      // left-aligned tabs (user decision 2026-09-08): the row leaves the left
      // baseline of the `Settings` h1 and its breadcrumbs, and that is accepted.
      // Two other routes to it do not work here:
      //   - `centered` is unusable: the theme defaults every Tabs to
      //     `variant: 'scrollable'` (`theme/core/components/tabs.tsx`), and MUI
      //     treats `centered` and `scrollable` as mutually exclusive — it warns
      //     and does nothing.
      //   - `& .MuiTabs-list { justifyContent: 'center' }` is unusable: once the
      //     track overflows, flex centering pushes the leading tabs past the
      //     scroll container's start, where they can no longer be reached.
      // `maxWidth: 1` (= 100%) is what guarantees the track never grows past
      // its container, so the `scrollableX` scroller keeps scrolling at narrow
      // widths *regardless of how `fit-content` resolves* on a flex root whose
      // only child is a scroll container — no breakpoint branch needed. The
      // clamp is kept deliberately even though it is probably redundant: MUI
      // gives that scroller `overflowX: 'auto'` (`Tabs.js`), and a scroll
      // container contributes zero min-content in its scrollable axis, which on
      // its own would already make `fit-content` resolve to the available width.
      // That reasoning is unverified — it rests on a spec detail plus Tabs
      // overwriting `overflow` through an inline style at runtime, and no
      // browser measurement has been taken here. The failure mode if it is
      // wrong is a leading tab parked outside the page container at 390px,
      // unreachable. Do not drop the clamp as dead weight without measuring.
      sx={{ width: 'fit-content', maxWidth: 1, mx: 'auto', mb: { xs: 3, md: 5 } }}
    >
      {tabs.map((tab) => (
        <Tab
          key={tab.value}
          value={tab.value}
          label={tab.label}
          icon={<Iconify icon={tab.icon} width={24} />}
          iconPosition="start"
          // Long en labels ("Account connections") must overflow into a scroll,
          // never wrap onto a second line.
          sx={{ whiteSpace: 'nowrap' }}
        />
      ))}
    </Tabs>
  );
}
