import Card from '@mui/material/Card';
import CardMedia from '@mui/material/CardMedia';
import CardActionArea from '@mui/material/CardActionArea';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

import { Iconify } from '../../components/iconify';
import type { BiliFavVideo } from '@/lib/bilibili/types';

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatPlay(count: number): string {
  if (count >= 10000) return `${(count / 10000).toFixed(1)}万`;
  return String(count);
}

const INVALID_ATTR = 9;

export function VideoCard({ video }: { video: BiliFavVideo }) {
  const isInvalid = video.attr === INVALID_ATTR;
  const cover = video.cover?.startsWith('//') ? `https:${video.cover}` : video.cover;

  const handleClick = () => {
    if (isInvalid) return;
    window.open(`https://www.bilibili.com/video/${video.bvid}`, '_blank');
  };

  return (
    <Card
      sx={(theme) => ({
        overflow: 'hidden',
        boxShadow: theme.vars.customShadows.card,
        transition: 'box-shadow 0.2s',
        ...(isInvalid && { opacity: 0.45, filter: 'grayscale(1)' }),
        '&:hover': {
          boxShadow: isInvalid ? undefined : theme.vars.customShadows.z8,
        },
      })}
    >
      <CardActionArea onClick={handleClick} disabled={isInvalid} sx={{ height: '100%' }}>
        <Box sx={{ position: 'relative' }}>
          {cover ? (
            <CardMedia
              component="img"
              image={cover}
              alt={video.title}
              sx={{ height: 130, objectFit: 'cover' }}
            />
          ) : (
            <Box
              sx={(theme) => ({
                height: 130,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                bgcolor: theme.vars.palette.grey[100],
              })}
            >
              <Iconify icon="solar:video-library-bold-duotone" width={40} sx={{ color: 'text.disabled' }} />
            </Box>
          )}

          {!isInvalid && (
            <Box
              sx={{
                position: 'absolute',
                bottom: 4,
                right: 4,
                bgcolor: 'rgba(0,0,0,0.7)',
                color: '#fff',
                px: 0.75,
                py: 0.25,
                borderRadius: 0.5,
                fontSize: '0.75rem',
                lineHeight: 1.4,
              }}
            >
              {formatDuration(video.duration)}
            </Box>
          )}
        </Box>

        <Box sx={{ p: 1.5 }}>
          <Typography
            variant="subtitle2"
            noWrap
            title={isInvalid ? '已失效视频' : video.title}
            sx={{ fontWeight: 600, mb: 0.5 }}
          >
            {isInvalid ? '已失效视频' : video.title}
          </Typography>

          {!isInvalid && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <Typography variant="caption" sx={{ color: 'text.secondary' }} noWrap>
                {video.upper.name}
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Iconify icon="solar:play-bold" width={14} sx={{ color: 'text.disabled' }} />
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  {formatPlay(video.cnt_info.play)}
                </Typography>
              </Box>
            </Box>
          )}
        </Box>
      </CardActionArea>
    </Card>
  );
}
