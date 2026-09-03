import { useState } from 'react';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import ToggleButton from '@mui/material/ToggleButton';
import FormControlLabel from '@mui/material/FormControlLabel';
import Checkbox from '@mui/material/Checkbox';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import Typography from '@mui/material/Typography';

import { useTranslation } from '@/lib/i18n/use-translation';
import { Iconify } from '../../components/iconify';
import { toast } from '../../components/snackbar';
import { getDb } from '../../../../lib/database/db';
import { queryAllTables, isTableDataEmpty } from '../../../../lib/export/query';
import { toExportJson } from '../../../../lib/export/serialize-json';
import { toExportCsvZip } from '../../../../lib/export/serialize-csv';
import { triggerDownload, buildExportFilename } from '../../../../lib/export/download';
import { queryObsidianNotes } from '../../../../lib/export/obsidian/query';
import { toObsidianZip } from '../../../../lib/export/obsidian/serialize';
import { SettingsPanel } from '../settings/settings-panel';

type BackupFormat = 'json' | 'csv';

/** Both exports read the same database, so they are mutually exclusive by nature. */
type Section = 'backup' | 'vault';

function errorKey(err: unknown): 'export.dbNotReady' | 'export.failed' {
  return err instanceof Error && err.message.includes('not initialized')
    ? 'export.dbNotReady'
    : 'export.failed';
}

function zipBlob(bytes: Uint8Array): Blob {
  return new Blob([bytes as BlobPart], { type: 'application/zip' });
}

export function ExportCard() {
  const { t } = useTranslation();
  const [format, setFormat] = useState<BackupFormat>('json');
  const [includeEmbedding, setIncludeEmbedding] = useState(false);
  const [busy, setBusy] = useState<Section | null>(null);

  /**
   * Wraps the shared busy/report lifecycle so each handler only holds its own
   * logic. An export is a one-shot action, so its outcome is a toast (docs/25
   * D6 plan A): a returned string is a refusal the user can act on (empty
   * database) and stays a warning; a throw is a failure.
   */
  const run = async (section: Section, task: () => Promise<string | null>) => {
    setBusy(section);
    try {
      const message = await task();
      if (message) toast.warning(message);
      else toast.success(t('snackbar.exported'));
    } catch (err) {
      toast.error(t(errorKey(err)));
    } finally {
      setBusy(null);
    }
  };

  const handleBackup = () =>
    run('backup', async () => {
      const data = await queryAllTables(getDb(), includeEmbedding);
      if (isTableDataEmpty(data)) return t('export.emptyDb');

      if (format === 'json') {
        const blob = new Blob([toExportJson(data)], { type: 'application/json' });
        triggerDownload(blob, buildExportFilename('json'));
      } else {
        triggerDownload(zipBlob(toExportCsvZip(data)), buildExportFilename('csv'));
      }
      return null;
    });

  const handleVault = () =>
    run('vault', async () => {
      const notes = await queryObsidianNotes(getDb());
      if (notes.length === 0) return t('export.emptyDb');

      const zip = toObsidianZip(notes, {
        originalLinkLabel: t('export.obsidianOriginalLink'),
      });
      triggerDownload(zipBlob(zip), buildExportFilename('obsidian'));
      return null;
    });

  return (
    <SettingsPanel title={t('export.title')} description={t('export.subtitle')}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Typography variant="subtitle2">{t('export.backupHeading')}</Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            {t('export.backupHint')}
          </Typography>

          <ToggleButtonGroup
            value={format}
            exclusive
            onChange={(_, v) => v && setFormat(v)}
            size="small"
          >
            <ToggleButton value="json">JSON</ToggleButton>
            <ToggleButton value="csv">CSV (ZIP)</ToggleButton>
          </ToggleButtonGroup>

          <FormControlLabel
            control={
              <Checkbox
                checked={includeEmbedding}
                onChange={(_, v) => setIncludeEmbedding(v)}
                size="small"
              />
            }
            label={t('export.includeEmbedding')}
          />

          <Button
            variant="contained"
            onClick={handleBackup}
            disabled={busy !== null}
            sx={{ alignSelf: 'flex-start' }}
            startIcon={
              busy === 'backup' ? (
                <CircularProgress size={18} color="inherit" />
              ) : (
                <Iconify icon="solar:database-bold-duotone" width={18} />
              )
            }
          >
            {busy === 'backup' ? t('export.exporting') : t('export.exportBtn')}
          </Button>

          <Divider />

          <Typography variant="subtitle2">{t('export.obsidianHeading')}</Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            {t('export.obsidianHint')}
          </Typography>

          <Button
            variant="outlined"
            onClick={handleVault}
            disabled={busy !== null}
            sx={{ alignSelf: 'flex-start' }}
            startIcon={
              busy === 'vault' ? (
                <CircularProgress size={18} color="inherit" />
              ) : (
                <Iconify icon="solar:folder-with-files-bold-duotone" width={18} />
              )
            }
          >
            {busy === 'vault' ? t('export.exporting') : t('export.obsidianBtn')}
          </Button>
        </Box>
    </SettingsPanel>
  );
}
