import Grid from '@mui/material/Grid';
import Typography from '@mui/material/Typography';
import Card from '@mui/material/Card';
import CardHeader from '@mui/material/CardHeader';
import CardContent from '@mui/material/CardContent';
import Box from '@mui/material/Box';

import { Iconify } from '../../components/iconify';
import { DashboardContent } from '../../layouts/dashboard';
import { StatWidget } from './stat-widget';
import { ExportCard } from './export-card';

export function OverviewView() {
  return (
    <DashboardContent maxWidth="xl">
      <Typography variant="h4" sx={{ mb: { xs: 3, md: 5 } }}>
        Hi, Welcome back
      </Typography>

      <Grid container spacing={3}>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatWidget
            title="Total Videos"
            total={128}
            icon={<Iconify icon="solar:videocamera-record-bold-duotone" width={32} />}
            color="primary"
          />
        </Grid>

        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatWidget
            title="Transcriptions"
            total={96}
            icon={<Iconify icon="solar:subtitles-bold-duotone" width={32} />}
            color="info"
          />
        </Grid>

        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatWidget
            title="Knowledge Items"
            total={342}
            icon={<Iconify icon="solar:database-bold-duotone" width={32} />}
            color="warning"
          />
        </Grid>

        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatWidget
            title="This Week"
            total={12}
            icon={<Iconify icon="eva:trending-up-fill" width={32} />}
            color="success"
          />
        </Grid>

        <Grid size={{ xs: 12, md: 6, lg: 8 }}>
          <Card>
            <CardHeader title="Recent Activity" subheader="Latest video transcriptions" />
            <CardContent>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {[
                  { title: 'Understanding React Server Components', time: '2 hours ago', status: 'Transcribed' },
                  { title: 'Advanced TypeScript Patterns', time: '5 hours ago', status: 'Transcribed' },
                  { title: 'Building Chrome Extensions with WXT', time: '1 day ago', status: 'Transcribed' },
                  { title: 'CSS Container Queries Deep Dive', time: '2 days ago', status: 'Pending' },
                  { title: 'Rust for JavaScript Developers', time: '3 days ago', status: 'Transcribed' },
                ].map((item) => (
                  <Box
                    key={item.title}
                    sx={(theme) => ({
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      p: 2,
                      borderRadius: 1,
                      bgcolor: theme.vars.palette.background.neutral,
                    })}
                  >
                    <Box>
                      <Typography variant="subtitle2">{item.title}</Typography>
                      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                        {item.time}
                      </Typography>
                    </Box>
                    <Typography
                      variant="caption"
                      sx={{
                        px: 1,
                        py: 0.5,
                        borderRadius: 0.75,
                        fontWeight: 700,
                        ...(item.status === 'Transcribed'
                          ? { color: 'success.dark', bgcolor: 'success.lighter' }
                          : { color: 'warning.dark', bgcolor: 'warning.lighter' }),
                      }}
                    >
                      {item.status}
                    </Typography>
                  </Box>
                ))}
              </Box>
            </CardContent>
          </Card>
        </Grid>

        <Grid size={{ xs: 12, md: 6, lg: 4 }}>
          <Card>
            <CardHeader title="Quick Stats" />
            <CardContent>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {[
                  { label: 'Bilibili Subtitles', value: '64', pct: '50%' },
                  { label: 'Groq ASR', value: '32', pct: '25%' },
                  { label: 'Cached', value: '96', pct: '75%' },
                  { label: 'Storage Used', value: '24 MB', pct: '12%' },
                ].map((item) => (
                  <Box key={item.label}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                        {item.label}
                      </Typography>
                      <Typography variant="subtitle2">{item.value}</Typography>
                    </Box>
                    <Box
                      sx={(theme) => ({
                        height: 6,
                        borderRadius: 3,
                        bgcolor: theme.vars.palette.grey[200],
                        overflow: 'hidden',
                      })}
                    >
                      <Box
                        sx={{
                          height: '100%',
                          width: item.pct,
                          borderRadius: 3,
                          bgcolor: 'primary.main',
                          transition: 'width 0.4s ease',
                        }}
                      />
                    </Box>
                  </Box>
                ))}
              </Box>
            </CardContent>
          </Card>
        </Grid>

        <Grid size={{ xs: 12, md: 6, lg: 4 }}>
          <ExportCard />
        </Grid>
      </Grid>
    </DashboardContent>
  );
}
