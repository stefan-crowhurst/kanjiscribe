BEGIN;

DROP VIEW IF EXISTS v_day_summary;

CREATE VIEW v_day_summary AS
SELECT
  assigned_for_date,
  COUNT(*) AS total_assignments,
  SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed_count,
  SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending_count,
  SUM(COALESCE(time_spent_ms, 0)) AS total_time_ms,
  SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) AS skipped_count,
  CASE
    WHEN SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) > 0
     AND SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) = 0
     AND SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) = 0
    THEN 1 ELSE 0 END AS is_fully_completed
FROM daily_assignment
WHERE status != 'archived'
GROUP BY assigned_for_date;

COMMIT;