import Box from '@mui/material/Box';

import { useTranslation } from '@/lib/i18n/use-translation';
import { Iconify } from '../../components/iconify';
import { ChipRowShell, FilterChip } from '../../components/collection';
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
    <ChipRowShell
      icon={<Iconify icon="mdi:github" width={20} sx={{ color: 'primary.main' }} />}
      title={t('githubStars.languagesTitle')}
    >
      <FilterChip
        label={`${t('githubStars.allLanguages')} (${totalCount})`}
        selected={selected === null}
        onClick={() => onSelect(null)}
      />
      {languages.map(({ language, count }) => (
        <FilterChip
          key={language}
          icon={<LanguageDot language={language} />}
          label={`${language} (${count})`}
          selected={language === selected}
          onClick={() => onSelect(language)}
          maxWidth={220}
        />
      ))}
    </ChipRowShell>
  );
}
