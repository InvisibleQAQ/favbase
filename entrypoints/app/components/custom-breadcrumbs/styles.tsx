import { styled } from '@mui/material/styles';

export const BreadcrumbsRoot = styled('div')(({ theme }) => ({
  display: 'flex',
  flexDirection: 'column',
  gap: theme.spacing(2),
}));

/**
 * The page's single h1. Minimal renders an `h6` element carrying `h4` type
 * styles; Favbase pages have exactly one h1 and it is this one, so both the
 * tag and the type scale move up.
 */
export const BreadcrumbsHeading = styled('h1')(({ theme }) => ({
  ...theme.typography.h1,
  margin: 0,
  padding: 0,
  display: 'inline-flex',
  wordBreak: 'break-word',
}));

export const BreadcrumbsContainer = styled('div')(({ theme }) => ({
  display: 'flex',
  flexWrap: 'wrap',
  gap: theme.spacing(2),
  alignItems: 'flex-start',
  justifyContent: 'flex-end',
}));

export const BreadcrumbsContent = styled('div')(({ theme }) => ({
  display: 'flex',
  flex: '1 1 auto',
  minWidth: 0,
  gap: theme.spacing(1),
  flexDirection: 'column',
}));

export const BreadcrumbsSeparator = styled('span')(({ theme }) => ({
  width: 4,
  height: 4,
  borderRadius: '50%',
  backgroundColor: theme.vars.palette.text.disabled,
}));
