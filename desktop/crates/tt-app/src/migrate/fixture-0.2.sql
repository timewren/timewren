-- En lille lokal 0.2.22-database uden cloud-synk (testdata, ingen rigtige personer).
INSERT INTO settings (key, value) VALUES
  ('idle_threshold_minutes', '9'),
  ('auto_start_tracking', 'false'),
  ('excluded_apps', 'Signal, 1password , Spotify'),
  ('theme', 'dark'),
  ('language', 'en'),
  ('ai_config', '{"provider":"ollama","model":"llama3","base_url":"http://localhost:11500"}'),
  ('default_hourly_rate', '850'),
  ('ical_url', 'webcal://p01-caldav.icloud.com/published/2/test.ics'),
  ('onboarding_completed', 'true');

INSERT INTO clients (id, name, company, cvr, hourly_rate, is_archived, created_at) VALUES
  ('c-bager', 'Bageriet', 'Bageriet ApS', '12345678', 750, 0, '2026-01-02 08:00:00'),
  ('c-gammel', 'Gammel kunde', NULL, NULL, NULL, 1, '2026-01-03 08:00:00');

INSERT INTO projects (id, client_id, name, hourly_rate, estimated_hours, is_archived, created_at) VALUES
  ('p-shop', 'c-bager', 'Webshop', 900, 40, 0, '2026-01-04 08:00:00'),
  ('p-intern', NULL, 'Intern', NULL, NULL, 0, '2026-01-05 08:00:00'),
  ('p-slut', 'c-gammel', 'Afsluttet', NULL, NULL, 1, '2026-01-06 08:00:00');

INSERT INTO klippekort (id, client_id, project_id, name, total_hours, used_hours, hourly_rate, status, expires_at, auto_deduct, created_at) VALUES
  ('k-10', 'c-bager', NULL, '10 timer', 10, 1.5, 700, 'active', '2099-12-31', 1, '2026-02-01 09:00:00'),
  ('k-uden', NULL, NULL, 'Kort uden kunde', 5, 0, 600, 'active', NULL, 1, '2026-02-02 09:00:00'),
  ('k-proj', NULL, 'p-shop', 'Kort på projektet', 5, 0, 650, 'active', '2099-12-31', 1, '2026-02-03 09:00:00');

-- To tidsformer som i 0.2.x: lokal naiv væg-tid og UTC med offset.
INSERT INTO time_entries (id, project_id, client_id, klippekort_id, description, start_time, end_time, duration, is_billable, is_running, source) VALUES
  ('e-1', 'p-shop', 'c-bager', NULL, 'Produktsider', '2026-03-02T09:00:00', '2026-03-02T11:00:00', 7200, 1, 0, 'manual'),
  ('e-2', 'p-shop', NULL, 'k-10', 'Kurv', '2026-03-03T08:00:00.000+00:00', '2026-03-03T09:30:00.000+00:00', 5400, 1, 0, 'timer'),
  ('e-3', 'p-intern', NULL, NULL, 'Bogføring', '2026-03-04T13:00:00', NULL, 1800, 0, 0, 'manual'),
  ('e-kører', 'p-shop', 'c-bager', NULL, 'Kører stadig', '2026-03-05T10:00:00', NULL, NULL, 1, 1, 'timer'),
  ('e-gammel', 'p-slut', 'c-gammel', NULL, 'Sidste opgave', '2026-01-10T10:00:00', '2026-01-10T11:00:00', 3600, 1, 0, 'manual');

INSERT INTO invoice_drafts (id, client_id, title, status, subtotal, total, invoice_number, created_at) VALUES
  ('i-1', 'c-bager', 'Marts', 'sent', 1800, 2250, 'F-7', '2026-03-31 12:00:00'),
  ('i-2', 'c-gammel', 'Januar', 'exported', 900, 1125, 'F-8', '2026-01-31 12:00:00');
INSERT INTO invoice_lines (invoice_id, description, quantity, unit_price, amount, time_entry_id, sort_order) VALUES
  ('i-1', 'Produktsider', 2, 900, 1800, 'e-1', 0),
  ('i-2', 'Sidste opgave', 1, 900, 900, 'e-gammel', 0);

INSERT INTO classification_rules (name, priority, condition_type, condition_op, condition_value, target_project_id, target_client_id, is_active) VALUES
  ('Figma', 10, 'app_name', 'equals', 'Figma', 'p-shop', NULL, 1),
  ('Shop-titel', 5, 'window_title', 'contains', 'bageriet', 'p-shop', 'c-bager', 1),
  ('Regex', 1, 'url', 'regex', '^https://x\.dk/.*', 'p-shop', NULL, 1),
  ('Slukket', 1, 'app_name', 'equals', 'Mail', 'p-shop', NULL, 0);

INSERT INTO project_matchers (project_id, client_id, kind, value) VALUES
  ('p-shop', 'c-bager', 'domain', 'bageriet.dk'),
  (NULL, NULL, 'domain', 'facebook.com');

INSERT INTO pomodoro_sessions (id, day, minutes, ended_at) VALUES ('pm-1', '2026-03-02', 25, '2026-03-02T09:25:00');
