import Card from '@mui/material/Card';
import CardMedia from '@mui/material/CardMedia';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

import type { BiliFavFolder } from '@/lib/bilibili/favorites';

export function FavFolderCard({ folder }: { folder: BiliFavFolder }) {
  const cover = folder.cover || '';

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
          alt={folder.title}
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
            {folder.title.charAt(0)}
          </Typography>
        </Box>
      )}

      <Box sx={{ p: 2 }}>
        <Typography
          variant="subtitle1"
          noWrap
          title={folder.title}
          sx={{ fontWeight: 600 }}
        >
          {folder.title}
        </Typography>

        <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
          {folder.media_count} 个视频
        </Typography>
      </Box>
    </Card>
  );
}
