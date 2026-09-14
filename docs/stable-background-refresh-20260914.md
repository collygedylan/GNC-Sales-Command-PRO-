# Stable background refresh — V2026.09.14.01

The baseline compiled app reproduced Eval Reports #2 → LowStock → Block Alpha → location returning from drill level 2 to 0 when an assignment snapshot arrived. The repair separates derived-cache invalidation from explicit account/navigation reset.

Background refresh uses the interaction-aware scheduler without its usual forced-render timeout. Source reads continue while gestures are active. Changed lists are prepared in detached bounded chunks and published after interaction settles; a surviving card identity retains its viewport offset after publication. New navigation/render tokens supersede pending work. Unchanged foreground metadata does not request another list render, and unrelated background adapters do not redraw the foreground view. Polled HL state uses the same render owner while explicit command behavior remains unchanged.

Eval navigation is reconciled only against complete verified inventory and assignment data. Missing groups return to the nearest valid parent with an explanation. Selections and edits survive source updates, but current source/proof checks gate editing and sending. Obsolete account/permission reads cannot restore an old report cache.

The browser regression uses restored native authentication, actual Manager/Eval/LowStock navigation, current coordinator reads, and isolated source fixtures. It covers unchanged DOM identity, changed refresh anchoring within two CSS pixels, touch-held updates, and complete-proof removal on desktop, Android, and iPhone. Initial animation and rendering completion are observed before anchor measurements; the tolerance remains unchanged. The dedicated compiled release lane is required alongside the existing lanes.

Local baseline failure traces are retained in the worktree's ignored `artifacts/baseline-refresh` folder. Unit, focused browser, candidate, main and deployment evidence is recorded separately; this document does not assert live publication. No database or public API changes are included.
