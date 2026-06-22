import Card from '@mui/material/Card';
import CardMedia from '@mui/material/CardMedia';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

import type { Source } from '@/lib/database/types';

interface FavFolderMeta {
  media_count?: number;
  cover?: string;
  intro?: string;
}

export function FavFolderCard({ source }: { source: Source }) {
  const meta = source.platformMeta as FavFolderMeta;
  const cover = meta.cover || '';
  const count = meta.media_count ?? 0;

  return (
    <Card
      sx={(theme) => ({
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        boxShadow: theme.vars.customShadows.card,
        transition: 'box-shadow 0.2s',
        '&:hover': {
          boxShadow: theme.vars.customShadows.z8,
        },
      })}
    >
      {cover ? (
        <CardMedia
          component="img"
          image={cover.startsWith('//') ? `https:${cover}` : cover}
          alt={source.title}
          sx={{ height: 140, objectFit: 'cover' }}
        />
      ) : (
        <Box
          sx={(theme) => ({
            height: 140,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            bgcolor: theme.vars.palette.grey[100],
          })}
        >
          <Typography variant="h3" sx={{ color: 'text.disabled' }}>
            {source.title.charAt(0)}
          </Typography>
        </Box>
      )}

      <Box sx={{ p: 2 }}>
        <Typography
          variant="subtitle1"
          noWrap
          title={source.title}
          sx={{ fontWeight: 600 }}
        >
          {source.title}
        </Typography>

        <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
          {count} 个视频
        </Typography>
      </Box>
    </Card>
  );
}
