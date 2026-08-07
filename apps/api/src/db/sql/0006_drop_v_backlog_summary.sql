BEGIN;

-- v_backlog_summary was never read by any code (the backlog surfaces query
-- daily_assignment directly). 0001_initial.sql no longer creates it, so fresh
-- databases never have it; this migration retires it on databases created
-- before the view was removed.
DROP VIEW IF EXISTS v_backlog_summary;

COMMIT;
