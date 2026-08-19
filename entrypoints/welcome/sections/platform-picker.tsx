import type { LocaleKeys } from '@/lib/i18n';
import type { IconifyName } from '@/entrypoints/app/components/iconify';
import type { CollectionPlatform } from '@/lib/collections/platforms';

import { useState } from 'react';
import { AnimatePresence } from 'motion/react';

import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { varAlpha } from 'minimal-shared/utils';

import { useTranslation } from '@/lib/i18n/use-translation';
import { Iconify } from '@/entrypoints/app/components/iconify';
import { collectionPlatformRegistry } from '@/entrypoints/app/collection-platform-registry';

import { readinessFor } from '../landing';
import { FadeIn } from '../components/fade-in';
import { MotionBox, MotionButtonBase } from '../components/motion-box';
import { useOnboardingExit } from '../use-onboarding-exit';
import { ctaGlowShadow, Eyebrow, Headline, WelcomeSection } from '../components/section-shell';

const HINT_KEYS: Record<CollectionPlatform, LocaleKeys> = {
  bilibili: 'welcome.picker.hint.bilibili',
  github: 'welcome.picker.hint.github',
  bookmarks: 'welcome.picker.hint.bookmarks',
  x: 'welcome.picker.hint.x',
  zhihu: 'welcome.picker.hint.zhihu',
  youtube: 'welcome.picker.hint.youtube',
};

/** What the user has to do before this platform can sync, at a glance. */
function readiness(platform: CollectionPlatform): { labelKey: LocaleKeys; icon: IconifyName } {
  const state = readinessFor(platform);
  if (state === 'credentials') {
    return { labelKey: 'welcome.picker.needsKey', icon: 'solar:shield-keyhole-bold-duotone' };
  }
  if (state === 'local') {
    return { labelKey: 'welcome.picker.readyNow', icon: 'eva:done-all-fill' };
  }
  return { labelKey: 'welcome.picker.needsLogin', icon: 'solar:global-bold-duotone' };
}

function PlatformCard({
  platform,
  selected,
  onToggle,
}: {
  platform: (typeof collectionPlatformRegistry)[number];
  selected: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const state = readiness(platform.id);

  return (
    <MotionButtonBase
      onClick={onToggle}
      aria-pressed={selected}
      whileHover={{ y: -4 }}
      whileTap={{ scale: 0.98 }}
      transition={{ type: 'spring', stiffness: 340, damping: 24 }}
      sx={(theme) => ({
        position: 'relative',
        width: 1,
        height: 1,
        p: 2.5,
        gap: 1.75,
        borderRadius: '20px',
        textAlign: 'left',
        alignItems: 'flex-start',
        justifyContent: 'flex-start',
        bgcolor: 'background.paper',
        // Unselected cards separate from the page by surface + z1 shadow alone;
        // the 2px slot stays reserved so selecting never shifts layout.
        border: `2px solid ${selected ? theme.vars.palette.primary.main : 'transparent'}`,
        boxShadow: selected ? theme.vars.customShadows.card : theme.vars.customShadows.z1,
        transition: theme.transitions.create(['border-color', 'box-shadow']),
        '&.Mui-focusVisible': {
          outline: `2px solid ${theme.vars.palette.primary.main}`,
          outlineOffset: 2,
        },
      })}
    >
      <Box
        sx={(theme) => ({
          width: 44,
          height: 44,
          flexShrink: 0,
          borderRadius: '30%',
          display: 'grid',
          placeItems: 'center',
          color: selected ? 'primary.main' : 'text.primary',
          bgcolor: selected
            ? varAlpha(theme.vars.palette.primary.mainChannel, 0.12)
            : varAlpha(theme.vars.palette.grey['500Channel'], 0.1),
        })}
      >
        <Iconify icon={platform.icon} width={24} />
      </Box>

      <Box sx={{ minWidth: 0 }}>
        <Typography variant="subtitle1">{t(platform.title)}</Typography>
        <Typography variant="body2" sx={{ mt: 0.5, color: 'text.secondary' }}>
          {t(HINT_KEYS[platform.id])}
        </Typography>

        <Box
          sx={{
            mt: 1.5,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 0.5,
            color: 'text.secondary',
          }}
        >
          <Iconify icon={state.icon} width={14} />
          <Typography variant="caption" sx={{ fontWeight: 600 }}>
            {t(state.labelKey)}
          </Typography>
        </Box>
      </Box>

      <AnimatePresence>
        {selected && (
          <MotionBox
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 420, damping: 22 }}
            sx={{
              position: 'absolute',
              top: 12,
              right: 12,
              display: 'flex',
              color: 'primary.main',
            }}
          >
            <Iconify icon="solar:check-circle-bold" width={22} />
          </MotionBox>
        )}
      </AnimatePresence>
    </MotionButtonBase>
  );
}

export function PlatformPicker() {
  const { t } = useTranslation();
  const { exit, leaving } = useOnboardingExit();
  const [picked, setPicked] = useState<CollectionPlatform[]>([]);

  const toggle = (id: CollectionPlatform) =>
    setPicked((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));

  return (
    <WelcomeSection id="welcome-picker" sx={{ scrollMarginTop: 80 }}>
      <Box sx={{ maxWidth: 720 }}>
        <FadeIn y={-12}>
          <Eyebrow>{t('welcome.picker.eyebrow')}</Eyebrow>
        </FadeIn>
        <FadeIn delay={0.08} sx={{ mt: 2.5 }}>
          <Headline>{t('welcome.picker.heading')}</Headline>
        </FadeIn>
        <FadeIn delay={0.16}>
          <Typography
            sx={{ mt: 2.5, color: 'text.secondary', lineHeight: 1.75, textWrap: 'pretty' }}
          >
            {t('welcome.picker.desc')}
          </Typography>
        </FadeIn>
      </Box>

      <Grid container spacing={2} sx={{ mt: { xs: 4, md: 6 } }}>
        {collectionPlatformRegistry.map((platform, index) => (
          <Grid key={platform.id} size={{ xs: 12, sm: 6, md: 4 }} sx={{ display: 'flex' }}>
            <FadeIn delay={0.05 * index} y={22} sx={{ width: 1, display: 'flex' }}>
              <PlatformCard
                platform={platform}
                selected={picked.includes(platform.id)}
                onToggle={() => toggle(platform.id)}
              />
            </FadeIn>
          </Grid>
        ))}
      </Grid>

      <FadeIn
        delay={0.1}
        sx={{
          mt: { xs: 5, md: 7 },
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 1.5,
        }}
      >
        <Button
          size="large"
          variant="contained"
          disabled={leaving}
          onClick={() => exit(picked)}
          endIcon={<Iconify icon="eva:arrow-ios-forward-fill" width={18} />}
          sx={(theme) => ({ px: 4, py: 1.5, fontSize: 16, boxShadow: ctaGlowShadow(theme) })}
        >
          {picked.length ? t('welcome.picker.cta') : t('welcome.picker.ctaNone')}
        </Button>

        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          {picked.length
            ? t('welcome.picker.selected', { count: picked.length })
            : t('welcome.picker.selectedNone')}
        </Typography>

        <Typography
          variant="caption"
          sx={{ mt: 2, maxWidth: 460, textAlign: 'center', color: 'text.disabled' }}
        >
          {t('welcome.picker.footnote')}
        </Typography>
      </FadeIn>
    </WelcomeSection>
  );
}
