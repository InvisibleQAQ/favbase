import type { drizzle } from 'drizzle-orm/pglite';

import type * as schema from './schema';

export type FavbaseDb = ReturnType<typeof drizzle<typeof schema>>;
