import { useState, type ReactNode } from 'react';

import { varAlpha } from 'minimal-shared/utils';

import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardActionArea, { cardActionAreaClasses } from '@mui/material/CardActionArea';
import Typography from '@mui/material/Typography';

export interface CollectionCardMedia {
  /** Cover / thumbnail URL. Missing or failing to load shows `fallbackIcon`. */
  src?: string | null;
  alt: string;
  /** Platform glyph for the empty / broken state — caller controls size and color. */
  fallbackIcon: ReactNode;
  /**
   * `'16/9'` = full-width cover across the top (video entries);
   * `'1/1'` = square thumb to the RIGHT of the title/body block, below the
   *   header row (text entries with an image) — never beside the header;
   * `'none'` = no media slot at all.
   */
  aspect: '16/9' | '1/1' | 'none';
  /** Badges drawn over the cover (duration, play count). Use `CoverBadge`. */
  overlay?: ReactNode;
}

export interface CollectionCardProps {
  /** Original URL. Opens in a new tab; omit for entries that cannot be opened. */
  href?: string;
  /** Dims the whole entry and removes the link (e.g. an unavailable video). */
  disabled?: boolean;
  media?: CollectionCardMedia;
  /** Avatar + author line above the title. */
  header?: ReactNode;
  /** Entry title — clamped, with the full text as a tooltip. */
  title: string;
  titleLines?: 2 | 3;
  /** Description / excerpt below the title. */
  body?: ReactNode;
  /** Left cell of the meta row (author · scope). Shrinks; the date does not. */
  meta?: ReactNode;
  /** Right cell of the meta row. Pre-formatted; never wraps, never squeezed. */
  date?: string;
  /** Counts row (stars, plays, likes). */
  stats?: ReactNode;
  /** Platform / type stamp at the end of the counts row. */
  stamp?: ReactNode;
  /** Tag row, rendered OUTSIDE the link. Absent → no row at all. */
  tags?: ReactNode;
  /** Platform action bar (transcribe controls), rendered OUTSIDE the link. */
  footer?: ReactNode;
}

const SIDE_THUMB = 72;

function clampSx(lines: number) {
  return {
    display: '-webkit-box',
    WebkitLineClamp: lines,
    WebkitBoxOrient: 'vertical',
    overflow: 'hidden',
    wordBreak: 'break-word',
  } as const;
}

/** Caption-sized scrim badge for cover overlays (duration, play count). */
export function CoverBadge({
  children,
  align = 'right',
}: {
  children: ReactNode;
  align?: 'left' | 'right';
}) {
  return (
    <Box
      sx={(theme) => ({
        position: 'absolute',
        bottom: theme.spacing(0.5),
        [align]: theme.spacing(0.5),
        display: 'flex',
        alignItems: 'center',
        gap: 0.25,
        px: 0.75,
        py: 0.25,
        borderRadius: 0.5,
        typography: 'caption',
        lineHeight: 1.4,
        // Scrim over imagery — scheme-independent by design (common.black is
        // the same in both schemes; the channel form keeps it on the theme).
        color: theme.vars.palette.common.white,
        bgcolor: varAlpha(theme.vars.palette.common.blackChannel, 0.7),
      })}
    >
      {children}
    </Box>
  );
}

function MediaSlot({ media }: { media: CollectionCardMedia }) {
  const [failed, setFailed] = useState(false);
  const showImage = Boolean(media.src) && !failed;
  const square = media.aspect === '1/1';

  return (
    <Box
      data-slot="media"
      data-media-state={showImage ? 'image' : 'fallback'}
      sx={(theme) => ({
        position: 'relative',
        overflow: 'hidden',
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: theme.vars.palette.text.disabled,
        bgcolor: theme.vars.palette.background.neutral,
        ...(square
          ? { flex: `0 0 ${SIDE_THUMB}px`, width: SIDE_THUMB, height: SIDE_THUMB, borderRadius: 0.5 }
          : { width: 1, aspectRatio: '16 / 9' }),
      })}
    >
      {showImage ? (
        <Box
          component="img"
          src={media.src ?? undefined}
          alt={media.alt}
          loading="lazy"
          onError={() => setFailed(true)}
          sx={{ width: 1, height: 1, objectFit: 'cover', display: 'block' }}
        />
      ) : (
        media.fallbackIcon
      )}
      {media.overlay}
    </Box>
  );
}

/**
 * The catalog entry shared by every platform. One shell owns the hairline,
 * the equal height, the whole-card hover, the link semantics (real anchor:
 * middle-click and Ctrl-click work), the cover fallback, the un-squeezable
 * date cell and the "no tags, no row" rule. Platforms only assemble content.
 * Zero `t()`, zero platform literals — all copy arrives pre-translated.
 */
export function CollectionCard({
  href,
  disabled = false,
  media,
  header,
  title,
  titleLines = 2,
  body,
  meta,
  date,
  stats,
  stamp,
  tags,
  footer,
}: CollectionCardProps) {
  const hasMedia = media != null && media.aspect !== 'none';
  const topMedia = hasMedia && media.aspect === '16/9';
  const sideMedia = hasMedia && media.aspect === '1/1';
  const hasMetaRow = meta != null || date != null;
  const hasStatsRow = stats != null || stamp != null;
  const openable = Boolean(href) && !disabled;

  const content = (
    <>
      {topMedia && <MediaSlot key={media.src ?? ''} media={media} />}
      <Box
        sx={{
          p: 2,
          flex: '1 1 auto',
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 0.75,
        }}
      >
        {/* The identification line owns the full content width — a thumb never
            shares its row. */}
        {header != null && (
          <Box
            data-slot="header"
            sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, overflow: 'hidden' }}
          >
            {header}
          </Box>
        )}
        <Box data-slot="body-row" sx={{ display: 'flex', gap: 1.5, minWidth: 0 }}>
          <Box
            sx={{
              flex: '1 1 auto',
              minWidth: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 0.75,
            }}
          >
            <Typography data-slot="title" variant="subtitle2" title={title} sx={clampSx(titleLines)}>
              {title}
            </Typography>
            {body}
          </Box>
          {sideMedia && <MediaSlot key={media.src ?? ''} media={media} />}
        </Box>
        {(hasMetaRow || hasStatsRow) && (
            <Box sx={{ mt: 'auto', pt: 0.5, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
              {hasMetaRow && (
                <Box
                  data-slot="meta-row"
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: '1fr auto',
                    alignItems: 'center',
                    columnGap: 1,
                    minWidth: 0,
                  }}
                >
                  <Box
                    data-slot="meta"
                    sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}
                  >
                    {meta}
                  </Box>
                  {date != null && (
                    <Typography
                      data-slot="date"
                      variant="caption"
                      noWrap
                      title={date}
                      sx={{ color: 'text.secondary', gridColumn: 2 }}
                    >
                      {date}
                    </Typography>
                  )}
                </Box>
              )}
              {hasStatsRow && (
                <Box
                  data-slot="stats-row"
                  sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0 }}
                >
                  {stats}
                  <Box sx={{ flex: 1 }} />
                  {stamp}
                </Box>
              )}
            </Box>
          )}
      </Box>
    </>
  );

  const actionAreaSx = {
    flex: '1 1 auto',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'stretch',
    // The whole card is the hover surface; the action-area overlay would paint
    // a second, partial one.
    [`& .${cardActionAreaClasses.focusHighlight}`]: { display: 'none' },
  } as const;

  return (
    <Card
      data-collection-card
      sx={(theme) => ({
        height: 1,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        transition: theme.transitions.create('background-color', { duration: 120 }),
        ...(disabled
          ? { opacity: 0.45, filter: 'grayscale(1)' }
          : { '&:hover': { bgcolor: theme.vars.palette.background.neutral } }),
      })}
    >
      {openable ? (
        <CardActionArea
          component="a"
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          sx={actionAreaSx}
        >
          {content}
        </CardActionArea>
      ) : (
        <CardActionArea component="div" disabled sx={actionAreaSx}>
          {content}
        </CardActionArea>
      )}
      {tags}
      {footer}
    </Card>
  );
}
