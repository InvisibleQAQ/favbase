import { memo } from 'react';

import Box from '@mui/material/Box';
import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';
import { varAlpha } from 'minimal-shared/utils';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Lightweight markdown renderer for assistant chat bubbles. Wraps `react-markdown`
 * + `remark-gfm` (tables / strikethrough / task lists) with MUI + theme-token
 * styled element overrides. Colors/backgrounds all resolve through `theme.vars.*`
 * so both light and dark schemes hold. Long content, code blocks and tables
 * scroll horizontally instead of breaking the layout.
 *
 * Security: NO `rehype-raw` — raw HTML in the model output is never rendered
 * (react-markdown default), so LLM-produced markup cannot inject arbitrary DOM/XSS.
 */

const markdownComponents: Components = {
  a: ({ children, href, ...rest }) => (
    <Link
      {...rest}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      sx={(theme) => ({ color: theme.vars.palette.text.accent })}
    >
      {children}
    </Link>
  ),
  p: ({ children }) => (
    <Typography variant="body2" component="p" sx={{ my: 0.75, lineHeight: 1.6 }}>
      {children}
    </Typography>
  ),
  h1: ({ children }) => (
    <Typography variant="subtitle1" component="h1" sx={{ mt: 1.5, mb: 0.75, fontWeight: 700 }}>
      {children}
    </Typography>
  ),
  h2: ({ children }) => (
    <Typography variant="subtitle1" component="h2" sx={{ mt: 1.5, mb: 0.75, fontWeight: 700 }}>
      {children}
    </Typography>
  ),
  h3: ({ children }) => (
    <Typography variant="subtitle2" component="h3" sx={{ mt: 1.25, mb: 0.5, fontWeight: 700 }}>
      {children}
    </Typography>
  ),
  h4: ({ children }) => (
    <Typography variant="subtitle2" component="h4" sx={{ mt: 1.25, mb: 0.5, fontWeight: 600 }}>
      {children}
    </Typography>
  ),
  ul: ({ children }) => (
    <Box component="ul" sx={{ my: 0.75, pl: 2.5, listStyleType: 'disc' }}>
      {children}
    </Box>
  ),
  ol: ({ children }) => (
    <Box component="ol" sx={{ my: 0.75, pl: 2.5, listStyleType: 'decimal' }}>
      {children}
    </Box>
  ),
  li: ({ children }) => (
    <Typography variant="body2" component="li" sx={{ my: 0.25, lineHeight: 1.6 }}>
      {children}
    </Typography>
  ),
  blockquote: ({ children }) => (
    <Box
      component="blockquote"
      sx={(theme) => ({
        my: 1,
        ml: 0,
        pl: 1.5,
        borderLeft: `1px solid ${varAlpha(theme.vars.palette.grey['500Channel'], 0.32)}`,
        color: theme.vars.palette.text.secondary,
      })}
    >
      {children}
    </Box>
  ),
  code: ({ children, className }) => {
    // react-markdown gives block code a language className (e.g. `language-ts`);
    // inline code has none. `pre` styles the block container below.
    const isBlock = typeof className === 'string' && className.startsWith('language-');
    if (isBlock) {
      return (
        <Box
          component="code"
          className={className}
          sx={(theme) => ({ fontFamily: 'monospace', fontSize: theme.typography.caption.fontSize })}
        >
          {children}
        </Box>
      );
    }
    return (
      <Box
        component="code"
        sx={(theme) => ({
          px: 0.5,
          py: 0.125,
          borderRadius: 0.5,
          fontFamily: 'monospace',
          fontSize: theme.typography.caption.fontSize,
          bgcolor: varAlpha(theme.vars.palette.grey['500Channel'], 0.12),
        })}
      >
        {children}
      </Box>
    );
  },
  pre: ({ children }) => (
    <Box
      component="pre"
      sx={(theme) => ({
        my: 1,
        p: 1.5,
        borderRadius: 0.5,
        overflowX: 'auto',
        fontFamily: 'monospace',
        fontSize: theme.typography.caption.fontSize,
        lineHeight: 1.5,
        bgcolor: varAlpha(theme.vars.palette.grey['500Channel'], 0.12),
      })}
    >
      {children}
    </Box>
  ),
  table: ({ children }) => (
    <Box sx={{ my: 1, overflowX: 'auto' }}>
      <Box
        component="table"
        sx={(theme) => ({
          borderCollapse: 'collapse',
          width: '100%',
          fontSize: theme.typography.caption.fontSize,
          '& th, & td': {
            border: `1px solid ${varAlpha(theme.vars.palette.grey['500Channel'], 0.24)}`,
            px: 1,
            py: 0.5,
            textAlign: 'left',
          },
          '& th': {
            bgcolor: varAlpha(theme.vars.palette.grey['500Channel'], 0.08),
            fontWeight: 600,
          },
        })}
      >
        {children}
      </Box>
    </Box>
  ),
  hr: () => (
    <Box
      component="hr"
      sx={(theme) => ({
        my: 1.5,
        border: 'none',
        borderTop: `1px solid ${varAlpha(theme.vars.palette.grey['500Channel'], 0.24)}`,
      })}
    />
  ),
};

const remarkPlugins = [remarkGfm];

interface ChatMarkdownProps {
  children: string;
}

function ChatMarkdownImpl({ children }: ChatMarkdownProps) {
  return (
    <Box
      sx={{
        '& > :first-of-type': { mt: 0 },
        '& > :last-child': { mb: 0 },
        wordBreak: 'break-word',
      }}
    >
      <ReactMarkdown remarkPlugins={remarkPlugins} components={markdownComponents}>
        {children}
      </ReactMarkdown>
    </Box>
  );
}

export const ChatMarkdown = memo(ChatMarkdownImpl);
