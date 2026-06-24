import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Card from '@mui/material/Card';
import Skeleton from '@mui/material/Skeleton';

import { Iconify } from '../../components/iconify';
import { DashboardContent } from '../../layouts/dashboard';
import { useBiliFavFolders } from './use-bili-fav-folders';
import { useFolderCovers } from './use-folder-covers';
import { FavFolderCard } from './fav-folder-card';

function LoadingSkeleton() {
  return (
    <Grid container spacing={3}>
      {Array.from({ length: 6 }).map((_, i) => (
        <Grid key={i} size={{ xs: 12, sm: 6, md: 4 }}>
          <Card sx={{ overflow: 'hidden' }}>
            <Skeleton variant="rectangular" height={140} />
            <Box sx={{ p: 2 }}>
              <Skeleton variant="text" width="60%" />
              <Skeleton variant="text" width="30%" />
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
      <Iconify
        icon="solar:shield-keyhole-bold-duotone"
        width={64}
        sx={{ color: 'warning.main', mb: 1 }}
      />
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
        暂无收藏夹
      </Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
        你的 B 站账号还没有创建任何收藏夹
      </Typography>
    </Box>
  );
}

export function CollectionsView() {
  const { folders, loading, syncing, loginState, lastSyncedAt, error, sync } = useBiliFavFolders();
  const { coverMap, loading: coversLoading } = useFolderCovers(folders);

  return (
    <DashboardContent maxWidth="xl">
      <Box sx={{ display: 'flex', alignItems: 'center', mb: { xs: 3, md: 5 } }}>
        <Typography variant="h4" sx={{ flexGrow: 1 }}>
          B 站收藏夹
        </Typography>

        {loginState === 'logged_in' && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            {lastSyncedAt && (
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                上次同步: {lastSyncedAt.toLocaleTimeString()}
              </Typography>
            )}
            <Button
              variant="contained"
              size="small"
              startIcon={
                syncing ? (
                  <CircularProgress size={16} color="inherit" />
                ) : (
                  <Iconify icon="solar:restart-bold" width={18} />
                )
              }
              onClick={sync}
              disabled={syncing}
            >
              {syncing ? '同步中...' : '同步'}
            </Button>
          </Box>
        )}
      </Box>

      {error && (
        <Typography variant="body2" sx={{ color: 'error.main', mb: 2 }}>
          同步失败: {error}
        </Typography>
      )}

      {loading ? (
        <LoadingSkeleton />
      ) : loginState === 'not_logged_in' ? (
        <NotLoggedIn onRetry={sync} />
      ) : folders.length === 0 ? (
        <EmptyState />
      ) : (
        <Grid container spacing={3}>
          {folders.map((folder) => (
            <Grid key={folder.id} size={{ xs: 12, sm: 6, md: 4 }}>
              <FavFolderCard
                folder={folder}
                resolvedCover={coverMap[folder.id]}
                coverLoading={coversLoading && !folder.cover && folder.media_count > 0}
              />
            </Grid>
          ))}
        </Grid>
      )}
    </DashboardContent>
  );
}
