# Legacy patch archive

These files are the historical patch stack that produced the effective v11 behavior materialized from commit `dd0021d508a24586e55970b2461f3d5fe266e94f`.

They are retained for audit and rollback archaeology only. Current smoke tests, precision runs, and simulations execute canonical `src/` directly.

Do not add new `stall-fixes-v*.py` patches and do not restore these files to the runtime path.
