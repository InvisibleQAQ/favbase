import { useParams, useNavigate } from 'react-router-dom';

import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Skeleton from '@mui/material/Skeleton';
import Pagination from '@mui/material/Pagination';

import { Iconify } from '../../components/iconify';
import { DashboardContent } from '../../layouts/dashboard';
import { useBiliFavVideos } from './use-bili-fav-videos';
import { VideoCard } from './video-card';

function LoadingSkeleton() {
  return (
    <Grid container spacing={2.5}>
      {Array.from({ length: 8 }).map((_, i) => (
        <Grid key={i} size={{ xs: 12, sm: 6, md: 4, lg: 3 }}>
          <Card sx={{ overflow: 'hidden' }}>
            <Skeleton variant="rectangular" height={130} />
            <Box sx={{ p: 1.5 }}>
              <Skeleton variant="text" width="80%" />
              <Skeleton variant="text" width="50%" />
            </Box>
          </Card>
        </Grid>
      ))}
    </Grid>
  );
}

function NotLoggedIn({ onRetry }: { onRetry: () => void }) {
  return (
    <Box
      sx={(theme) => ({
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 320,
        gap: 2,
        borderRadius: 2,
        border: `2px dashed ${theme.vars.palette.grey[300]}`,
        p: 4,
      })}
    >
      <Iconify icon="solar:shield-keyhole-bold-duotone" width={64} sx={{ color: 'warning.main', mb: 1 }} />
      <Typography variant="h6">未检测到 B 站登录状态</Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary', textAlign: 'center', maxWidth: 400 }}>
        请先在浏览器中打开 bilibili.com 并登录你的账号，然后回到此页面点击重试。
      </Typography>
      <Button variant="outlined" onClick={onRetry} sx={{ mt: 1 }}>
        重试
      </Button>
    </Box>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Box
      sx={(theme) => ({
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 320,
        gap: 2,
        borderRadius: 2,
        border: `2px dashed ${theme.vars.palette.grey[300]}`,
        p: 4,
      })}
    >
      <Iconify icon="solar:danger-triangle-bold-duotone" width={64} sx={{ color: 'error.main', mb: 1 }} />
      <Typography variant="h6">加载失败</Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary', textAlign: 'center', maxWidth: 400 }}>
        {message}
      </Typography>
      <Button variant="outlined" onClick={onRetry} sx={{ mt: 1 }}>
        重试
      </Button>
    </Box>
  );
}

function EmptyState() {
  return (
    <Box
      sx={(theme) => ({
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 320,
        gap: 2,
        borderRadius: 2,
        border: `2px dashed ${theme.vars.palette.grey[300]}`,
      })}
    >
      <Typography variant="h6" sx={{ color: 'text.disabled' }}>
        收藏夹为空
      </Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
        这个收藏夹还没有收藏任何视频
      </Typography>
    </Box>
  );
}

export function FolderDetailView() {
  const { mediaId } = useParams<{ mediaId: string }>();
  const navigate = useNavigate();
  const numericId = Number(mediaId);

  const { videos, folderTitle, page, totalPages, loading, loginState, error, goToPage, retry } =
    useBiliFavVideos(numericId);

  const handleBack = () => {
    navigate('/collections');
  };

  const handlePageChange = (_: React.ChangeEvent<unknown>, value: number) => {
    goToPage(value);
  };

  return (
    <DashboardContent maxWidth="xl">
      <Box sx={{ display: 'flex', alignItems: 'center', mb: { xs: 3, md: 5 }, gap: 1.5 }}>
        <Button
          onClick={handleBack}
          startIcon={<Iconify icon="solar:arrow-left-bold" width={20} />}
          sx={{ color: 'text.secondary', minWidth: 'auto' }}
        >
          返回
        </Button>

        <Typography variant="h4" sx={{ flexGrow: 1 }} noWrap>
          {loading ? <Skeleton width={200} /> : folderTitle}
        </Typography>
      </Box>

      {loading ? (
        <LoadingSkeleton />
      ) : loginState === 'not_logged_in' ? (
        <NotLoggedIn onRetry={retry} />
      ) : error ? (
        <ErrorState message={error} onRetry={retry} />
      ) : videos.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          <Grid container spacing={2.5}>
            {videos.map((video) => (
              <Grid key={video.id} size={{ xs: 12, sm: 6, md: 4, lg: 3 }}>
                <VideoCard video={video} />
              </Grid>
            ))}
          </Grid>

          {totalPages > 1 && (
            <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>
              <Pagination
                count={totalPages}
                page={page}
                onChange={handlePageChange}
                color="primary"
                shape="rounded"
              />
            </Box>
          )}
        </>
      )}
    </DashboardContent>
  );
}
