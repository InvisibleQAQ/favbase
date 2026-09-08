import { browser } from 'wxt/browser';

import Box from '@mui/material/Box';
import Container from '@mui/material/Container';
import Typography from '@mui/material/Typography';

import { BrandMark } from './components/brand-mark';

/** Read once at module scope — the manifest cannot change while the page lives. */
const EXTENSION_VERSION = browser.runtime.getManifest().version;

/**
 * Page floor, shaped after Minimal's `HomeFooter` (centred, `py: 5`, brand plus
 * one caption line) rather than its full `Footer` — the socials/three-column/
 * newsletter version is not used by Minimal's own home page either.
 *
 * The caption carries the two facts that appear nowhere else in the product:
 * the installed version and the licence. It deliberately adds no repository
 * link — welcome already has two (the header's GithubButton and the Platform
 * Request issue button), and a third would just be noise.
 *
 * `v0.0.5 · GPL-3.0` needs no locale key: it is an identifier and an SPDX id,
 * identical in both languages.
 */
export function WelcomeFooter() {
  return (
    <Box component="footer" sx={{ py: 5, textAlign: 'center' }}>
      <Container maxWidth="lg">
        <Box sx={{ display: 'inline-flex' }}>
          <BrandMark />
        </Box>

        <Typography variant="caption" sx={{ mt: 1, display: 'block', color: 'text.disabled' }}>
          {`v${EXTENSION_VERSION} · GPL-3.0`}
        </Typography>
      </Container>
    </Box>
  );
}
