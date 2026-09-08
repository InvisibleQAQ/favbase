import type { ReactNode } from 'react';
import type { Breakpoint } from '@mui/material/styles';

import Box from '@mui/material/Box';

import { MainSection } from '@/entrypoints/app/layouts/core/main-section';
import { HeaderSection } from '@/entrypoints/app/layouts/core/header-section';
import { LayoutSection } from '@/entrypoints/app/layouts/core/layout-section';

import { WelcomeFooter } from './footer';
import { BrandMark } from './components/brand-mark';
import { TopBarActions } from './sections/top-bar-actions';
import { ScrollProgress, BackToTopButton } from './components/animate';

export type WelcomeLayoutProps = {
  children: ReactNode;
  layoutQuery?: Breakpoint;
};

/**
 * Page shell, modelled on Minimal's `MainLayout`: `LayoutSection` takes the
 * header/main/footer slots and `LayoutSection` already carries a no-sidebar
 * branch, so nothing here needs to fake one.
 *
 * Three of Minimal's header slots are deliberately absent. `SignInButton` and
 * the `Purchase` button have no counterpart (no accounts, no store), and
 * `SettingsButton` cannot come along: it reaches the settings context, which
 * welcome.html deliberately does not mount (guarded by the import boundary in
 * `tests/ui-vendor-boundaries.test.ts`). `NavDesktop`/`NavMobile`/`MenuButton`
 * are gone too — this is one scrolling page, not a multi-route site.
 *
 * `disableElevation` matches app.html: transparent at rest, blur plus a divider
 * once scrolled, no floating ellipse shadow. A user clicking through to the
 * app is one continuous motion, and the header should not change under them.
 *
 * There is no Skip Intro control here, by design — the picker is the only way
 * out, and it accepts an empty selection.
 */
export function WelcomeLayout({ children, layoutQuery = 'md' }: WelcomeLayoutProps) {
  return (
    <>
      {/* Above the header (which sits at `--layout-header-zIndex`, appBar + 1),
          otherwise the bar reads as a sliver under the blurred strip. */}
      <ScrollProgress
        sx={(theme) => ({ position: 'fixed', zIndex: theme.zIndex.appBar + 2 })}
      />

      <BackToTopButton />

      <LayoutSection
        layoutQuery={layoutQuery}
        headerSection={
          <HeaderSection
            disableElevation
            layoutQuery={layoutQuery}
            slotProps={{ container: { maxWidth: 'lg' } }}
            slots={{
              leftArea: <BrandMark tagline />,
              rightArea: (
                <Box sx={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                  <TopBarActions />
                </Box>
              ),
            }}
          />
        }
        footerSection={<WelcomeFooter />}
        sx={{ position: 'relative', overflowX: 'clip', bgcolor: 'background.default' }}
      >
        <MainSection>{children}</MainSection>
      </LayoutSection>
    </>
  );
}
