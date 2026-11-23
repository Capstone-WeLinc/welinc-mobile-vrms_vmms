import {
  MAX_SEARCH_HISTORY_ITEMS,
  mergeRecentSearches,
} from "../services/searchHistory";

test("moves a submitted query to the front and de-duplicates without case sensitivity", () => {
  expect(
    mergeRecentSearches(["oil change", "WO-001"], "  OIL CHANGE  "),
  ).toEqual(["OIL CHANGE", "WO-001"]);
});

test("ignores blank queries and limits recent history", () => {
  const existing = Array.from(
    { length: MAX_SEARCH_HISTORY_ITEMS + 2 },
    (_, index) => `query-${index}`,
  );

  expect(mergeRecentSearches(existing, "  ")).toHaveLength(
    MAX_SEARCH_HISTORY_ITEMS,
  );
  expect(mergeRecentSearches(existing, "new query")).toHaveLength(
    MAX_SEARCH_HISTORY_ITEMS,
  );
  expect(mergeRecentSearches(existing, "new query")[0]).toBe("new query");
});
