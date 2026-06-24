import { useState, useEffect, useRef } from 'react';
import { getBiliAuth, fetchFavVideos } from '@/lib/bilibili/bilibili-api';
import type { BiliFavFolder } from '@/lib/bilibili/types';

interface UseFolderCoversReturn {
  coverMap: Record<number, string>;
  loading: boolean;
}

export function useFolderCovers(folders: BiliFavFolder[]): UseFolderCoversReturn {
  const [coverMap, setCoverMap] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(false);
  const generationRef = useRef(0);

  useEffect(() => {
    const needCover = folders.filter((f) => !f.cover && f.media_count > 0);
    if (needCover.length === 0) {
      setCoverMap({});
      setLoading(false);
      return;
    }

    let cancelled = false;
    const gen = ++generationRef.current;
    setLoading(true);
    setCoverMap({});

    (async () => {
      const auth = await getBiliAuth();
      if (cancelled || !auth || gen !== generationRef.current) return;

      const results = await Promise.allSettled(
        needCover.map(async (f) => {
          const resp = await fetchFavVideos(auth, f.id, 1, 1);
          const firstVideo = resp.medias?.[0];
          return { id: f.id, cover: firstVideo?.cover ?? '' };
        }),
      );

      if (cancelled || gen !== generationRef.current) return;

      const map: Record<number, string> = {};
      for (const r of results) {
        if (r.status === 'fulfilled' && r.value.cover) {
          map[r.value.id] = r.value.cover;
        }
      }
      setCoverMap(map);
      setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [folders]);

  return { coverMap, loading };
}
