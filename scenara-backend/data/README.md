# Scenara market data — recovered

`scenara_market_data.sql.gz` is the event and market history from `scenara-db`
on Render, dumped on 2026-07-30 before that database was deleted. Until this
commit the only copy lived on one laptop, in
`~/Desktop/dev/scenara-archive/_database/`. Now it is in git.

## What is in it

| Table | Rows |
|---|---|
| `scenario_probability_history` | 84,130 |
| `scenarios` | 11,680 |
| `events` | 5,798 |
| **Total** | **101,608** |

Plus the complete schema — all 17 `CREATE TABLE` statements, indexes and
constraints — so it restores into an empty database on its own.

## What is deliberately missing

The row data for `users`, `accounts`, `predictions`, `transactions` and
`pulse_admins` — 17 rows in total — is **withheld**. The `users` table holds
four real email addresses and their bcrypt password hashes, belonging to people
who signed up; `accounts` holds their balances. None of that belongs in a
repository, and none of it is market data.

Their `CREATE TABLE` statements are still here, so a restore produces the tables
empty rather than failing on a missing relation.

If you ever need those 17 rows, they are in the full dumps at
`scenara-archive/_database/scenara_db.{sql,dump}`, which stay off git.

## Restoring

```sh
brew install libpq                                  # psql 18+, the dump is from PG 18.4
export PATH="/opt/homebrew/opt/libpq/bin:$PATH"

createdb scenara_local
gunzip -c scenara_market_data.sql.gz | psql scenara_local
```

Taken with `--no-owner --no-privileges`, so it restores under any role rather
than demanding Render's `scenara_db_user`.

## Verifying

Row counts were checked against the live database before shutdown and again
against this file — 84,130 / 11,680 / 5,798. Every row was validated against its
`COPY` column header: 101,608 checked, 0 malformed. A restore that produces
different numbers means the restore went wrong, not the capture.

```sh
gzip -t scenara_market_data.sql.gz     # archive integrity
```
