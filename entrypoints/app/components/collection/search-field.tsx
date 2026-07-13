import TextField from '@mui/material/TextField';
import InputAdornment from '@mui/material/InputAdornment';

import { Iconify } from '../iconify';

export interface SearchFieldProps {
  placeholder: string;
  /** Controlled value — omit together with onChange for a disabled placeholder field. */
  value?: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
}

/** Full-width search input with the shared magnifier adornment. */
export function SearchField({ placeholder, value, onChange, disabled }: SearchFieldProps) {
  return (
    <TextField
      fullWidth
      disabled={disabled}
      value={value}
      onChange={onChange ? (e) => onChange(e.target.value) : undefined}
      placeholder={placeholder}
      sx={{ mb: 3 }}
      slotProps={{
        input: {
          startAdornment: (
            <InputAdornment position="start">
              <Iconify icon="eva:search-fill" width={20} sx={{ color: 'text.disabled' }} />
            </InputAdornment>
          ),
        },
      }}
    />
  );
}
