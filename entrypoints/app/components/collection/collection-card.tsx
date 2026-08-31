import { useState, type ReactNode } from 'react';
import type { Theme, SxProps } from '@mui/material/styles';

import { varAlpha } from 'minimal-shared/utils';

import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardActionArea, { cardActionAreaClasses } from '@mui/material/CardActionArea';
import Skeleton from '@mui/material/Skeleton';
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
  /** Marks the entry unavailable: no link, neutral surface, desaturated media.
   *  Text keeps readable contrast — the state is visible, not illegible. */
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

/**
 * Content inset shared by the link block and every row below it. Mirrors the
 * theme's `MuiCardContent` (24px) so entries and panels share one rhythm.
 */
const CARD_INSET = 3;
const SIDE_THUMB = 72;
const MEDIA_ASPECT = '16 / 9';

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

/**
 * A row that sits OUTSIDE the entry link (tags, platform actions) but inside
 * the card's inset. The only owner of that inset: rows never restate it.
 */
export function CollectionCardRow({
  children,
  sx,
}: {
  children?: ReactNode;
  sx?: SxProps<Theme>;
}) {
  return (
    <Box
      data-slot="row"
      sx={[
        {
          px: CARD_INSET,
          pb: 2,
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 1,
          minWidth: 0,
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
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
          : { width: 1, aspectRatio: MEDIA_ASPECT }),
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
 * The catalog entry shared by every platform. One shell owns the elevation,
 * the equal height, the whole-card hover and focus, the link semantics (real
 * anchor: middle-click and Ctrl-click work), the cover fallback, the
 * un-squeezable date cell, the inset of the rows outside the link and the
 * "no tags, no row" rule. Platforms only assemble content.
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
        data-slot="content"
        sx={{
          p: CARD_INSET,
          flex: '1 1 auto',
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 1,
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
            <Typography
              data-slot="title"
              variant="subtitle2"
              title={title}
              sx={[clampSx(titleLines), disabled && { color: 'text.secondary' }]}
            >
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
    // The card clips its children, so the baseline's offset ring would be cut
    // off; draw it inside the edge instead. Same 2px, same color, still 3:1.
    '&:focus-visible': { outlineOffset: -2 },
  } as const;

  return (
    <Card
      data-collection-card
      data-disabled={disabled ? '' : undefined}
      sx={(theme) => ({
        height: 1,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        transition: theme.transitions.create(['background-color', 'box-shadow'], {
          duration: theme.transitions.duration.shortest,
        }),
        ...(disabled
          ? {
              bgcolor: theme.vars.palette.background.neutral,
              '& [data-slot="media"]': { filter: 'grayscale(1)', opacity: 0.64 },
            }
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

export interface CollectionCardSkeletonProps {
  /** Same slot as the real entry, so the placeholder sits on the same track. */
  media?: CollectionCardMedia['aspect'];
  /** Reserve the avatar + author line. */
  header?: boolean;
  /** Title / body text lines. */
  lines?: number;
}

/**
 * Loading placeholder with the real entry's anatomy: same inset, same media
 * slot, same text rhythm. A platform picks its shape (cover, thumb, header,
 * line count); it never draws its own skeleton card.
 */
export function CollectionCardSkeleton({
  media = 'none',
  header = false,
  lines = 2,
}: CollectionCardSkeletonProps) {
  const count = Math.max(1, lines);
  const textLines = Array.from({ length: count }, (_, i) => (
    <Skeleton key={i} variant="text" width={i === count - 1 ? '55%' : '90%'} />
  ));

  return (
    <Card
      data-collection-card-skeleton
      sx={{ height: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
    >
      {media === '16/9' && (
        <Skeleton
          data-slot="media"
          variant="rectangular"
          sx={{ width: 1, height: 'auto', aspectRatio: MEDIA_ASPECT }}
        />
      )}
      <Box
        data-slot="content"
        sx={{ p: CARD_INSET, display: 'flex', flexDirection: 'column', gap: 1 }}
      >
        {header && (
          <Box data-slot="header" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Skeleton variant="circular" width={24} height={24} />
            <Skeleton variant="text" width="40%" />
          </Box>
        )}
        <Box data-slot="body-row" sx={{ display: 'flex', gap: 1.5 }}>
          <Box sx={{ flex: '1 1 auto', minWidth: 0 }}>{textLines}</Box>
          {media === '1/1' && (
            <Skeleton
              data-slot="media"
              variant="rounded"
              width={SIDE_THUMB}
              height={SIDE_THUMB}
              sx={{ flexShrink: 0, borderRadius: 0.5 }}
            />
          )}
        </Box>
        <Skeleton variant="text" width="30%" sx={{ mt: 0.5 }} />
      </Box>
    </Card>
  );
}
