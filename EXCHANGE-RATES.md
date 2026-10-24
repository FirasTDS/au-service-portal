# Exchange-rate schedule

- SP-Today Damascus USD rates are fetched by GitHub Actions on `0 * * * *`: the start of every UTC hour, also the start of every Damascus hour.
- GitHub scheduled jobs are best-effort and may start late or be skipped. This schedule is not an exact-time publication guarantee.
- The site checks at clock-minute boundaries, including `:00`. Until it receives a snapshot fetched in the current hour, it checks once per minute while visible. Once current, it returns to roughly 15-minute checks.
- Returning to the tab or reconnecting triggers an immediate check. The displayed timestamp remains the real snapshot fetch time; a failed or delayed job never receives a fabricated fresh timestamp.
- The refresh button checks published snapshots; it does not trigger a server-side scrape.

For a firm hourly refresh target, use a separately managed scheduler/backend with monitoring, retries and credentials stored server-side. Changing a GitHub cron expression alone cannot provide that guarantee.
