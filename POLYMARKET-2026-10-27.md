# Polymarket market desk — 0.8.3

## Comparison desk update

Both outcomes now appear together on a shared probability/time scale. Source team colors and logos follow each outcome through the matchup banner, chart, prediction rows, order-book selectors and ticket. Dark source colors are lifted for legibility; pairs with similar colors use stable gold and white accents, matching the supplied baseball reference. The base dark palette and brand gradient are unchanged. End labels represent actual last historical observations, while the header displays current quotes. Hover shows both historical values at the chosen time.

Detail refreshes use Gamma's filtered market list because its individual-market endpoint omits parent-event context. Sports headers use source game times, with no inferred scores or records. Related markets are sorted by volume and open their Scenara detail when imported. Sampling adapts to the age of newer markets, retaining useful detail in ALL/monthly views. Thirty-two backend tests cover this release, including source identity validation and adaptive sampling.

The feed now uses compact market cards with precise outcome probabilities, daily movement in percentage points, genuine source sparklines, volume, liquidity and closing times. A first-visit introduction explains the virtual balance. Desktop includes a source statistics strip and Market Pulse; phones prioritize the market list. Activity, movement, liquidity and closing-time controls reorder the board.

## Source coverage

- Gamma: full market rules, market and parent-event identifiers, canonical source link, images, outcome/token mapping, dates, tags, source state, minimum order size, tick size, bid/ask/spread, last trade, hourly/daily/weekly/monthly movement, and volume windows.
- CLOB: actual history per outcome for 1H, 6H, 1D, 1W, 1M and ALL; eight levels of sorted bids and asks.
- Data API: open interest and 20 recent trades, with wallet/profile identifiers omitted.
- Parent event: contextual activity, tags and related market outcomes, kept distinct from per-market metrics.

Quote batches explicitly request 100 rows and page all tracked markets, avoiding Gamma’s default 20-row limit. All imported open markets refresh every minute, including markets outside discovery's first page. Detail pages poll every 30 seconds. Public requests are cached and identical requests share an in-flight call. History is capped at 240 real observations per outcome; feed sparklines use 36 observations in batches of at most 20 markets. Upstream failures preserve a labelled partial result, never generated prices/history.

Simulated orders preserve the Polymarket probabilities. The API rejects expired markets, source markets not accepting orders and quotes older than five minutes. Fast quote refreshes update current odds without growing the local history table on every poll. Displayed countdowns interpret timezone-free API timestamps as UTC.

## Verification

Thirty-one tests cover the trading lifecycle plus source field normalization, small price changes, outcome-label mapping, quote freshness, real history, order-book ordering, partial failures, trade-identity omission, and request caching. The suite runs against a disposable PostgreSQL database. Web checks include TypeScript, lint and the production export.

Chrome layout checks cover widths 320, 390, 768, 1024, 1440 and 1920, plus 844 × 390 landscape. The narrow-screen chart retained an old desktop width during resizing; its width now derives from the active layout. The ticket's stake input now shrinks within its row, including long values, and its contents scroll in short viewports. Phone charts, controls and trade actions remain reachable. Guest registration, translated interfaces, source tabs and simulation-ticket behavior are checked separately.

## Practical limits

The public APIs can return empty history, incomplete metadata or temporary errors. Their latest timestamps remain visible. Board statistics describe the currently loaded board, not all Polymarket volume. Related outcomes open the original parent event. Scenara still uses virtual funds, with its existing simulation fee and odds bounds; it does not submit Polymarket orders.

Official references: [market fields](https://docs.polymarket.com/api-reference/markets/get-market-by-id), [token history](https://docs.polymarket.com/api-reference/markets/get-prices-history), [price semantics](https://docs.polymarket.com/concepts/prices-orderbook).
