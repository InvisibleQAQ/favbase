import { useState } from 'react';
import Card from '@mui/material/Card';
import CardHeader from '@mui/material/CardHeader';
import CardContent from '@mui/material/CardContent';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import ToggleButton from '@mui/material/ToggleButton';
import FormControlLabel from '@mui/material/FormControlLabel';
import Checkbox from '@mui/material/Checkbox';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Box from '@mui/material/Box';
import Alert from '@mui/material/Alert';

import { useTranslation } from '@/lib/i18n/use-translation';
import { Iconify } from '../../components/iconify';
import { getDb } from '../../../../lib/database/db';
import { queryAllTables, isTableDataEmpty } from '../../../../lib/export/query';
import { toExportJson } from '../../../../lib/export/serialize-json';
import { toExportCsvZip } from '../../../../lib/export/serialize-csv';
import { triggerDownload, buildExportFilename } from '../../../../lib/export/download';

type ExportFormat = 'json' | 'csv';

export function ExportCard() {
  const { t } = useTranslation();
  const [format, setFormat] = useState<ExportFormat>('json');
  const [includeEmbedding, setIncludeEmbedding] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleExport = async () => {
    setError(null);
    setExporting(true);
    try {
      const db = getDb();
      const data = await queryAllTables(db, includeEmbedding);

      if (isTableDataEmpty(data)) {
        setError(t('export.emptyDb'));
        return;
      }

      if (format === 'json') {
        const json = toExportJson(data);
        const blob = new Blob([json], { type: 'application/json' });
        triggerDownload(blob, buildExportFilename('json'));
      } else {
        const zip = toExportCsvZip(data);
        const blob = new Blob([new Uint8Array(zip) as BlobPart], { type: 'application/zip' });
        triggerDownload(blob, buildExportFilename('csv'));
      }
    } catch (err) {
      const msg =
        err instanceof Error && err.message.includes('not initialized')
          ? t('export.dbNotReady')
          : t('export.failed');
      setError(msg);
    } finally {
      setExporting(false);
    }
  };

  return (
    <Card>
      <CardHeader title={t('export.title')} subheader={t('export.subtitle')} />
      <CardContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
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

          {error && <Alert severity="warning" onClose={() => setError(null)}>{error}</Alert>}

          <Button
            variant="contained"
            onClick={handleExport}
            disabled={exporting}
            startIcon={
              exporting ? (
                <CircularProgress size={18} color="inherit" />
              ) : (
                <Iconify icon="solar:database-bold-duotone" width={18} />
              )
            }
          >
            {exporting ? t('export.exporting') : t('export.exportBtn')}
          </Button>
        </Box>
      </CardContent>
    </Card>
  );
}
