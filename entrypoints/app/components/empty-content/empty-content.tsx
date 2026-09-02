import type { ReactNode, ComponentProps } from 'react';
import type { BoxProps } from '@mui/material/Box';
import type { Theme, SxProps } from '@mui/material/styles';
import type { TypographyProps } from '@mui/material/Typography';

import { varAlpha } from 'minimal-shared/utils';

import Box from '@mui/material/Box';
import { styled } from '@mui/material/styles';
import Typography from '@mui/material/Typography';

// `title` is dropped from the div props on purpose: ours is rendered copy, not
// the native tooltip attribute, and callers pass nodes (a Skeleton while the
// count loads, for one).
export type EmptyContentProps = Omit<ComponentProps<'div'>, 'title'> & {
  /** Leading visual rendered above the copy. Takes precedence over `imgUrl`. */
  icon?: ReactNode;
  /** Illustration source, used when no `icon` is given. No built-in default. */
  imgUrl?: string;
  title?: ReactNode;
  filled?: boolean;
  sx?: SxProps<Theme>;
  description?: ReactNode;
  action?: ReactNode;
  slotProps?: {
    img?: BoxProps<'img'>;
    title?: TypographyProps;
    description?: TypographyProps;
  };
};

/**
 * Empty / error / no-match state shared by every page.
 *
 * Two deliberate departures from Minimal:
 * - There is no default illustration and no default title. Minimal falls back
 *   to a bundled SVG and the literal "No data"; we have neither that asset nor
 *   a generic i18n key, and every caller already passes its own copy.
 * - Copy sits on `text.secondary`, not `text.disabled`, which does not clear
 *   the contrast floor (docs/25 Step 3).
 *
 * Every slot renders as a direct child of the root so callers can assert the
 * visual order without reaching through wrappers.
 */
export function EmptyContent({
  sx,
  icon,
  imgUrl,
  action,
  filled,
  slotProps,
  description,
  title,
  ...other
}: EmptyContentProps) {
  const renderIllustration = () => {
    if (icon) return icon;
    if (!imgUrl) return null;

    return (
      <Box
        component="img"
        alt=""
        src={imgUrl}
        {...slotProps?.img}
        sx={[
          { width: 1, maxWidth: 160 },
          ...(Array.isArray(slotProps?.img?.sx) ? slotProps.img.sx : [slotProps?.img?.sx]),
        ]}
      />
    );
  };

  return (
    <ContentRoot filled={filled} sx={sx} {...other}>
      {renderIllustration()}

      {title != null && (
        <Typography
          variant="subtitle1"
          component="p"
          {...slotProps?.title}
          sx={[
            { mt: 1, textAlign: 'center', color: 'text.secondary' },
            ...(Array.isArray(slotProps?.title?.sx) ? slotProps.title.sx : [slotProps?.title?.sx]),
          ]}
        >
          {title}
        </Typography>
      )}

      {description != null && (
        <Typography
          variant="body2"
          {...slotProps?.description}
          sx={[
            { mt: 1, maxWidth: 400, textAlign: 'center', color: 'text.secondary' },
            ...(Array.isArray(slotProps?.description?.sx)
              ? slotProps.description.sx
              : [slotProps?.description?.sx]),
          ]}
        >
          {description}
        </Typography>
      )}

      {action}
    </ContentRoot>
  );
}

const ContentRoot = styled('div', {
  shouldForwardProp: (prop: string) => !['filled', 'sx'].includes(prop),
})<Pick<EmptyContentProps, 'filled'>>(({ filled, theme }) => ({
  flexGrow: 1,
  height: '100%',
  display: 'flex',
  alignItems: 'center',
  flexDirection: 'column',
  justifyContent: 'center',
  padding: theme.spacing(0, 3),
  ...(filled && {
    borderRadius: Number(theme.shape.borderRadius) * 2,
    backgroundColor: varAlpha(theme.vars.palette.grey['500Channel'], 0.04),
    border: `dashed 1px ${varAlpha(theme.vars.palette.grey['500Channel'], 0.08)}`,
  }),
}));
