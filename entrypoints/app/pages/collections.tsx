import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';

import { DashboardContent } from '../layouts/dashboard';

export default function CollectionsPage() {
  return (
    <DashboardContent maxWidth="xl">
      <Typography variant="h4" sx={{ mb: { xs: 3, md: 5 } }}>
        Collections
      </Typography>

      <Box
        sx={(theme) => ({
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: 320,
          borderRadius: 2,
          border: `2px dashed ${theme.vars.palette.grey[300]}`,
          color: theme.vars.palette.text.secondary,
        })}
      >
        <Typography variant="h6" sx={{ color: 'text.disabled' }}>
          Collections coming soon...
        </Typography>
      </Box>
    </DashboardContent>
  );
}
