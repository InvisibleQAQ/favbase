import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { createHashRouter, RouterProvider, Outlet } from 'react-router-dom';

import Box from '@mui/material/Box';
import LinearProgress, { linearProgressClasses } from '@mui/material/LinearProgress';
import { varAlpha } from 'minimal-shared/utils';

import App from './App';
import { DashboardLayout } from './layouts/dashboard';

const DashboardPage = lazy(() => import('./pages/dashboard'));
const CollectionsPage = lazy(() => import('./pages/collections'));
const SettingsPage = lazy(() => import('./pages/settings'));
const FolderDetailPage = lazy(() => import('./pages/folder-detail'));

function LoadingFallback() {
  return (
    <Box
      sx={{
        display: 'flex',
        flex: '1 1 auto',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <LinearProgress
        sx={{
          width: 1,
          maxWidth: 320,
          bgcolor: (theme) => varAlpha(theme.vars.palette.text.primaryChannel, 0.16),
          [`& .${linearProgressClasses.bar}`]: { bgcolor: 'text.primary' },
        }}
      />
    </Box>
  );
}

const router = createHashRouter([
  {
    Component: App,
    children: [
      {
        element: (
          <DashboardLayout>
            <Suspense fallback={<LoadingFallback />}>
              <Outlet />
            </Suspense>
          </DashboardLayout>
        ),
        children: [
          { index: true, element: <DashboardPage /> },
          { path: 'collections', element: <CollectionsPage /> },
          { path: 'collections/bilibili/:mediaId', element: <FolderDetailPage /> },
          { path: 'settings', element: <SettingsPage /> },
        ],
      },
    ],
  },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>
);
