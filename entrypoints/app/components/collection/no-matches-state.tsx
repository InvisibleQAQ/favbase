import Typography from '@mui/material/Typography';

import { StateBox } from './state-box';

export interface NoMatchesStateProps {
  /** Pre-translated "no matches" line — platform names its own item noun. */
  message: string;
}

/** Filters (search/facet) matched nothing — dashed box with a single line. */
export function NoMatchesState({ message }: NoMatchesStateProps) {
  return (
    <StateBox>
      <Typography variant="body1" sx={{ color: 'text.disabled' }}>
        {message}
      </Typography>
    </StateBox>
  );
}
