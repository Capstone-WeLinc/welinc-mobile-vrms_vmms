import { getDatabase } from "../database/database";

export type SearchHistorySurface = "global" | "work-orders";

export const MAX_SEARCH_HISTORY_ITEMS = 10;

const SEARCH_HISTORY_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS mobile_search_history (
    userId TEXT NOT NULL,
    surface TEXT NOT NULL CHECK (surface IN ('global', 'work-orders')),
    rank INTEGER NOT NULL,
    query TEXT NOT NULL,
    PRIMARY KEY (userId, surface, rank)
  )
`;

export function mergeRecentSearches(
  existing: string[],
  query: string,
): string[] {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) return existing.slice(0, MAX_SEARCH_HISTORY_ITEMS);

  const lowerQuery = normalizedQuery.toLowerCase();
  return [
    normalizedQuery,
    ...existing.filter((item) => item.trim().toLowerCase() !== lowerQuery),
  ].slice(0, MAX_SEARCH_HISTORY_ITEMS);
}

async function getSearchHistoryDatabase() {
  const database = await getDatabase();
  await database.execAsync(SEARCH_HISTORY_TABLE_SQL);
  return database;
}

export async function getRecentSearches(
  userId: string,
  surface: SearchHistorySurface,
): Promise<string[]> {
  const database = await getSearchHistoryDatabase();
  const rows = await database.getAllAsync<{ query: string }>(
    `SELECT query FROM mobile_search_history
     WHERE userId = ? AND surface = ?
     ORDER BY rank ASC`,
    userId,
    surface,
  );
  return rows.map((row) => row.query);
}

export async function recordRecentSearch(
  userId: string,
  surface: SearchHistorySurface,
  query: string,
): Promise<string[]> {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) return getRecentSearches(userId, surface);

  const database = await getSearchHistoryDatabase();
  let updatedHistory: string[] = [];

  await database.withExclusiveTransactionAsync(async (transaction) => {
    const rows = await transaction.getAllAsync<{ query: string }>(
      `SELECT query FROM mobile_search_history
       WHERE userId = ? AND surface = ?
       ORDER BY rank ASC`,
      userId,
      surface,
    );
    updatedHistory = mergeRecentSearches(
      rows.map((row) => row.query),
      normalizedQuery,
    );

    await transaction.runAsync(
      "DELETE FROM mobile_search_history WHERE userId = ? AND surface = ?",
      userId,
      surface,
    );
    for (const [rank, item] of updatedHistory.entries()) {
      await transaction.runAsync(
        `INSERT INTO mobile_search_history (userId, surface, rank, query)
         VALUES (?, ?, ?, ?)`,
        userId,
        surface,
        rank,
        item,
      );
    }
  });

  return updatedHistory;
}

export async function clearRecentSearches(
  userId: string,
  surface: SearchHistorySurface,
): Promise<void> {
  const database = await getSearchHistoryDatabase();
  await database.runAsync(
    "DELETE FROM mobile_search_history WHERE userId = ? AND surface = ?",
    userId,
    surface,
  );
}
