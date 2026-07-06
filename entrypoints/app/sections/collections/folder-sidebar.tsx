import { useState } from 'react';

import Box from '@mui/material/Box';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import Typography from '@mui/material/Typography';
import Collapse from '@mui/material/Collapse';
import Skeleton from '@mui/material/Skeleton';
import { varAlpha } from 'minimal-shared/utils';

import { useTranslation } from '@/lib/i18n/use-translation';
import { Iconify } from '../../components/iconify';
import type { BiliFavFolder } from '@/lib/bilibili/types';

// Responsive stepped width — narrower on smaller viewports so the second-level
// folder sidebar doesn't starve the video grid when stacked under the dashboard nav.
const SIDEBAR_WIDTH = { xs: 160, sm: 200 };

interface FolderSidebarProps {
  folders: BiliFavFolder[];
  selectedId: number | undefined;
  loading: boolean;
  onSelect: (folderId: number) => void;
}

export function FolderSidebar({ folders, selectedId, loading, onSelect }: FolderSidebarProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(true);

  return (
    <Box
      sx={(theme) => ({
        width: SIDEBAR_WIDTH,
        flexShrink: 0,
        alignSelf: 'flex-start',
        borderRight: `1px solid ${theme.vars.palette.divider}`,
        borderBottom: `1px solid ${theme.vars.palette.divider}`,
        borderRadius: '0 0 0 16px',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      })}
    >
      <ListItemButton
        onClick={() => setExpanded((prev) => !prev)}
        sx={(theme) => ({
          py: 1.5,
          px: 2,
          gap: 1,
          borderBottom: `1px solid ${theme.vars.palette.divider}`,
        })}
      >
        <Iconify
          icon="solar:videocamera-record-bold-duotone"
          width={20}
          sx={{ color: 'primary.main' }}
        />
        <ListItemText
          primary={t('collections.sidebarTitle')}
          slotProps={{ primary: { variant: 'subtitle2', fontWeight: 700 } }}
        />
        <Iconify
          icon={expanded ? 'eva:arrow-ios-upward-fill' : 'eva:arrow-ios-downward-fill'}
          width={16}
          sx={{ color: 'text.disabled' }}
        />
      </ListItemButton>

      <Collapse in={expanded} sx={{ overflow: 'auto' }}>
        {loading ? (
          <Box sx={{ p: 2 }}>
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} variant="rounded" height={36} sx={{ mb: 1 }} />
            ))}
          </Box>
        ) : folders.length === 0 ? (
          <Box sx={{ p: 2, textAlign: 'center' }}>
            <Typography variant="caption" sx={{ color: 'text.disabled' }}>
              {t('collections.noFolders')}
            </Typography>
          </Box>
        ) : (
          <List disablePadding sx={{ py: 0.5 }}>
            {folders.map((folder) => {
              const isSelected = folder.id === selectedId;
              return (
                <ListItemButton
                  key={folder.id}
                  selected={isSelected}
                  onClick={() => onSelect(folder.id)}
                  sx={(theme) => ({
                    py: 1,
                    px: 2,
                    mx: 0.5,
                    borderRadius: 1,
                    ...(isSelected && {
                      bgcolor: varAlpha(theme.vars.palette.primary.mainChannel, 0.08),
                      color: 'primary.main',
                      '&:hover': {
                        bgcolor: varAlpha(theme.vars.palette.primary.mainChannel, 0.16),
                      },
                    }),
                  })}
                >
                  <ListItemText
                    primary={folder.title}
                    slotProps={{
                      primary: {
                        variant: 'body2',
                        noWrap: true,
                        fontWeight: isSelected ? 600 : 400,
                      },
                    }}
                  />
                  <Typography
                    variant="caption"
                    sx={{ color: isSelected ? 'primary.main' : 'text.disabled', ml: 1, flexShrink: 0 }}
                  >
                    {folder.media_count}
                  </Typography>
                </ListItemButton>
              );
            })}
          </List>
        )}
      </Collapse>
    </Box>
  );
}
