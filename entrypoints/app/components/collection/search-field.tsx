import type { Theme, SxProps } from '@mui/material/styles';

import TextField from '@mui/material/TextField';
import InputAdornment from '@mui/material/InputAdornment';

import { Iconify } from '../iconify';

export interface SearchFieldProps {
  /** Pre-translated placeholder; doubles as the field's accessible name. */
  placeholder: string;
  /** Controlled value — omit together with onChange for a disabled placeholder field. */
  value?: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
  /** Optional overrides merged after the default `mb: 3` outer spacing. */
  sx?: SxProps<Theme>;
}

/** Full-width search input (56px via the theme's medium outlined input target)
 *  with the shared magnifier adornment. */
export function SearchField({ placeholder, value, onChange, disabled, sx }: SearchFieldProps) {
  return (
    <TextField
      fullWidth
      disabled={disabled}
      value={value}
      onChange={onChange ? (e) => onChange(e.target.value) : undefined}
      placeholder={placeholder}
      sx={[{ mb: 3 }, ...(Array.isArray(sx) ? sx : [sx])]}
      slotProps={{
        htmlInput: { 'aria-label': placeholder },
        input: {
          startAdornment: (
            <InputAdornment position="start">
              <Iconify icon="eva:search-fill" width={20} sx={{ color: 'text.secondary' }} />
            </InputAdornment>
          ),
        },
      }}
    />
  );
}
