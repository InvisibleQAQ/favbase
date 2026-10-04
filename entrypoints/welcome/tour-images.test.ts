import { readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { SUPPORTED_LOCALES } from '@/lib/i18n/detect';

import { TOUR_PAGES, TOUR_SCHEMES, tourImageSrc } from './tour-images';

// Same `__dirname` convention as `tests/*-contract.test.ts`.
const PUBLIC_DIR = path.resolve(__dirname, '../../public');
const IMAGE_DIR = path.join(PUBLIC_DIR, 'assets/images/welcome');

/** Every URL the tour can ask for: page x scheme x locale. */
const urls = TOUR_PAGES.flatMap((page) =>
  TOUR_SCHEMES.flatMap((scheme) =>
    SUPPORTED_LOCALES.map((locale) => tourImageSrc(page, scheme, locale))
  )
);

describe('tour images', () => {
  it('serves every page x scheme x locale from the welcome image directory', () => {
    // `public/` is the extension root, so a URL is a path under it. Resolving
    // the URL itself (not a rebuilt file name) is what ties the function to
    // the directory.
    const served = urls.map((url) => path.relative(IMAGE_DIR, path.join(PUBLIC_DIR, url)));
    const onDisk = new Set(readdirSync(IMAGE_DIR));

    expect(served).toHaveLength(
      TOUR_PAGES.length * TOUR_SCHEMES.length * SUPPORTED_LOCALES.length
    );
    expect(served.filter((file) => !onDisk.has(file))).toEqual([]);
  });

  it('leaves no tour-* file in the directory that the list does not produce', () => {
    const expected = new Set(urls.map((url) => path.basename(url)));
    const strays = readdirSync(IMAGE_DIR).filter(
      (file) => file.startsWith('tour-') && !expected.has(file)
    );

    expect(strays).toEqual([]);
  });
});
