import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Typography from '@mui/material/Typography';

import { useTranslation } from '@/lib/i18n/use-translation';
import { Iconify } from '../../components/iconify';
import type { LanguageCount } from '@/lib/github/github-sync-service';
import { languageColor } from './language-colors';

interface LanguageChipsProps {
  languages: LanguageCount[];
  /** Unfiltered library size — count for the "All" chip. */
  totalCount: number;
  /** null = "All" selected. */
  selected: string | null;
  onSelect: (language: string | null) => void;
}

function LanguageDot({ language }: { language: string }) {
  return (
    <Box
      sx={{
        width: 10,
        height: 10,
        ml: 1,
        borderRadius: '50%',
        bgcolor: languageColor(language),
        flexShrink: 0,
      }}
    />
  );
}

export function LanguageChips({ languages, totalCount, selected, onSelect }: LanguageChipsProps) {
  const { t } = useTranslation();

  return (
    <Box sx={{ mb: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
        <Iconify icon="mdi:github" width={20} sx={{ color: 'primary.main' }} />
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
          {t('githubStars.languagesTitle')}
        </Typography>
      </Box>

      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
        <Chip
          label={`${t('githubStars.allLanguages')} (${totalCount})`}
          clickable
          onClick={() => onSelect(null)}
          color={selected === null ? 'primary' : 'default'}
          variant={selected === null ? 'filled' : 'outlined'}
        />
        {languages.map(({ language, count }) => {
          const isSelected = language === selected;
          return (
            <Chip
              key={language}
              icon={<LanguageDot language={language} />}
              label={`${language} (${count})`}
              clickable
              onClick={() => onSelect(language)}
              color={isSelected ? 'primary' : 'default'}
              variant={isSelected ? 'filled' : 'outlined'}
              sx={{
                maxWidth: 220,
                '& .MuiChip-label': {
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                },
              }}
            />
          );
        })}
      </Box>
    </Box>
  );
}
