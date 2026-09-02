import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { createHashRouter, RouterProvider, Outlet } from 'react-router-dom';

import { initDbProxy } from '@/lib/database';
import { DEFAULT_THEME_SETTINGS, getThemeSettings } from '@/lib/storage';
import { LoadingScreen } from './components/loading-screen';
import App from './App';
import { collectionPlatformRoutes } from './collection-platform-pages';
import { SettingsProvider } from './components/settings';
import { loadNavigationData } from './load-navigation';
import { DashboardLayout } from './layouts/dashboard';

// Fire-and-forget: establish DB connection through PortBridge → Offscreen.
// Does not block UI render. getDb() will be available after init completes.
initDbProxy().catch((err) =>
  console.error('[app] DB proxy init failed:', err),
);

const DashboardPage = lazy(() => import('./pages/dashboard'));
const CollectionsPage = lazy(() => import('./pages/collections'));
const ChatPage = lazy(() => import('./pages/chat'));
const SettingsPage = lazy(() => import('./pages/settings'));

async function bootstrap() {
  // Both reads gate the first render: navigation because the shell is immutable
  // afterwards, theme settings so the first frame already wears the saved
  // preset instead of flashing coral. A storage failure keeps the app usable
  // on the defaults.
  const [navigation, themeSettings] = await Promise.all([
    loadNavigationData(),
    getThemeSettings().catch((error: unknown) => {
      console.error('[app] failed to load theme settings', error);
      return DEFAULT_THEME_SETTINGS;
    }),
  ]);
  const router = createHashRouter([
    {
      Component: App,
      children: [
        {
          element: (
            <DashboardLayout navigation={navigation}>
              <Suspense fallback={<LoadingScreen />}>
                <Outlet />
              </Suspense>
            </DashboardLayout>
          ),
          children: [
            { index: true, element: <DashboardPage /> },
            { path: 'collections', element: <CollectionsPage /> },
            ...collectionPlatformRoutes.map(({ path, Page }) => ({
              path,
              element: <Page />,
            })),
            { path: 'chat', element: <ChatPage /> },
            { path: 'settings', element: <SettingsPage /> },
          ],
        },
      ],
    },
  ]);

  // SettingsProvider sits outside the router (and therefore outside App's
  // ThemeProvider): App is a router `Component` with no props channel for the
  // pre-read initial state.
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <SettingsProvider initialState={themeSettings}>
        <RouterProvider router={router} />
      </SettingsProvider>
    </StrictMode>,
  );
}

void bootstrap();
