-- Roadmap items for timetrack.dk
-- Run this against the production database

-- Clear existing items (optional - uncomment if needed)
-- DELETE FROM roadmap_items;

-- In Progress items
INSERT INTO roadmap_items (id, title, description, status, category, priority, created_at, updated_at)
VALUES 
  (gen_random_uuid(), 'Mobile app (iOS & Android)', 'Native mobile app med timer, tidsregistrering og push notifications. React Native med offline support.', 'in-progress', 'mobile', 1, NOW(), NOW()),
  (gen_random_uuid(), 'Outlook Calendar sync', 'Integration med Microsoft Outlook/365 kalender. Synkroniser events og bloker tid automatisk.', 'in-progress', 'integration', 2, NOW(), NOW());

-- Planned items (High to Low priority)
INSERT INTO roadmap_items (id, title, description, status, category, priority, created_at, updated_at)
VALUES 
  (gen_random_uuid(), 'Slack integration', 'Start/stop timer fra Slack. Daily standups med gårsdagens tidsregistreringer. Slash commands.', 'planned', 'integration', 1, NOW(), NOW()),
  (gen_random_uuid(), 'AI-powered time suggestions', 'Machine learning der foreslår projekter baseret på din kalender, emails og arbejdsmønstre.', 'planned', 'feature', 2, NOW(), NOW()),
  (gen_random_uuid(), 'Automatisk fakturering', 'Generer og send fakturaer automatisk ved månedens udgang eller når klippekort er opbrugt.', 'planned', 'feature', 3, NOW(), NOW()),
  (gen_random_uuid(), 'Team dashboard', 'Overblik over dit teams tidsregistreringer, projektstatus og kapacitet. Resource planning.', 'planned', 'feature', 4, NOW(), NOW()),
  (gen_random_uuid(), 'Pomodoro timer mode', '25/5 min arbejds/pause-intervaller. Statistik over fokustid. Integration med eksisterende timer.', 'planned', 'improvement', 5, NOW(), NOW()),
  (gen_random_uuid(), 'API for third-party integrations', 'Public REST API med API keys, rate limiting og webhooks. Dokumentation med OpenAPI/Swagger.', 'planned', 'integration', 6, NOW(), NOW()),
  (gen_random_uuid(), 'Bulk time entry', 'Opret mange tidsregistreringer på én gang. Kopier uger, templates og batch-redigering.', 'planned', 'improvement', 7, NOW(), NOW()),
  (gen_random_uuid(), 'Budget alerts', 'Advarsler når projekter nærmer sig budgetgrænsen. Email og push notifications.', 'planned', 'feature', 8, NOW(), NOW()),
  (gen_random_uuid(), 'Custom reports builder', 'Byg dine egne rapporter med drag-and-drop. Eksport til PDF, Excel og CSV.', 'planned', 'feature', 9, NOW(), NOW()),
  (gen_random_uuid(), 'Multi-currency support', 'Arbejd med flere valutaer. Automatisk kursomregning og valuta per kunde/projekt.', 'planned', 'feature', 10, NOW(), NOW());

-- Completed items
INSERT INTO roadmap_items (id, title, description, status, category, priority, completed_at, created_at, updated_at)
VALUES 
  (gen_random_uuid(), 'Google Calendar integration', 'Synkroniser med Google Calendar. Time-blocking og event-to-task linking.', 'completed', 'integration', 1, '2026-01-15'::timestamp, NOW(), NOW()),
  (gen_random_uuid(), 'Browser extension', 'Chrome og Firefox extension med timer, auto-detection og offline support.', 'completed', 'feature', 2, '2026-01-20'::timestamp, NOW(), NOW()),
  (gen_random_uuid(), 'Client portal (white-label)', 'Giv kunder adgang til deres egne data med dit brand. Fakturaer, tid og klippekort.', 'completed', 'feature', 3, '2026-01-25'::timestamp, NOW(), NOW());

-- Verify
SELECT status, COUNT(*) as count FROM roadmap_items GROUP BY status ORDER BY status;
