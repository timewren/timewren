-- Læring i en 0.2.22-database (opdigtede testdata, ingen rigtige personer).
-- Aktiviteten lægges ind af testen med tider i forhold til "nu".
INSERT INTO settings (key, value) VALUES ('onboarding_completed', 'true');

-- remote_id = web's id (sat, når 0.2 har synkroniseret). "Andet ApS" og dets
-- projekt nåede aldrig web.
INSERT INTO clients (id, remote_id, name, created_at) VALUES
  ('c-bager', 'web-kunde-bager', 'Bageriet', '2026-01-02 08:00:00'),
  ('c-andet', NULL, 'Andet ApS', '2026-01-03 08:00:00');

INSERT INTO projects (id, remote_id, client_id, name, created_at) VALUES
  ('p-shop', 'web-proj-shop', 'c-bager', 'Webshop', '2026-01-04 08:00:00'),
  ('p-lokal', NULL, 'c-andet', 'Lokalt', '2026-01-05 08:00:00');

INSERT INTO project_matchers (id, project_id, client_id, kind, value) VALUES
  (1, 'p-shop', 'c-bager', 'domain', 'ovnen.example'),
  (2, NULL, NULL, 'domain', 'nyheder.ovnen.example'),
  (3, 'p-shop', NULL, 'git_repo', 'webshop'),
  (4, 'p-lokal', NULL, 'path', '/Users/test/kunder/andet'),
  (5, NULL, 'c-bager', 'keyword', 'kagekatalog'),
  (6, 'p-shop', NULL, 'app', 'Kassesystem'),
  (7, 'p-shop', NULL, 'sonar', 'ukendt');

INSERT INTO classification_rules (id, name, priority, condition_type, condition_op, condition_value, target_project_id, target_client_id, is_active) VALUES
  (1, 'Figma', 10, 'app_name', 'equals', 'Figma', 'p-shop', NULL, 1),
  (2, 'Titel', 5, 'window_title', 'contains', 'bestillinger', NULL, 'c-bager', 1),
  (3, 'Regex', 1, 'url', 'regex', '^https://x\.example/.*', 'p-shop', NULL, 1),
  (4, 'Slukket', 1, 'app_name', 'equals', 'Mail', 'p-shop', NULL, 0),
  (5, 'Repo', 3, 'git_repo', 'starts_with', 'webs', 'p-shop', NULL, 1),
  (6, 'Uden mål', 1, 'app_name', 'equals', 'Noter', NULL, NULL, 1),
  (7, 'Lokalt', 1, 'app_name', 'equals', 'Regneark', 'p-lokal', NULL, 1);

INSERT INTO confirmed_patterns (app_name, window_title_pattern, url_pattern, git_repo, context_path, project_id, client_id, confirmation_count) VALUES
  ('Code', 'index.ts — kagesider', NULL, 'github.com/eksempel/kagesider', '/Users/test/dev/kunder/bageriet/kagesider', 'p-shop', NULL, 4),
  ('Google Chrome', 'Ordrer – Bageriet Admin - Google Chrome', 'https://admin.bageriet.example/ordrer', NULL, NULL, NULL, 'c-bager', 2),
  ('Spotify', 'Spotify', NULL, NULL, NULL, 'p-shop', NULL, 3),
  ('Code', 'main.rs — andet', NULL, NULL, '/Users/test/dev/kunder/andet/app', 'p-lokal', NULL, 2);

INSERT INTO exclusion_rules (field, op, value, is_active) VALUES
  ('app_name', 'equals', '1Password', 1),
  ('window_title', 'contains', 'privat', 1),
  ('url', 'regex', '^https://bank\.example', 1),
  ('app_name', 'equals', 'Gammel', 0),
  ('url', 'regex', '([', 1);
