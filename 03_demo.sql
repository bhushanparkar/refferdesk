-- Demo data, loaded only when SEED_DEMO=true on the first start.
-- Uses reserved example domains so no real mailbox ever gets a code.
INSERT INTO companies (name, domain) VALUES ('Demo Corp', 'demo.example') ON CONFLICT DO NOTHING;

INSERT INTO users (name, email, role, is_verified, consent_at) VALUES
  ('Asha Rao',   'asha@demo.example',  'employee',  TRUE, NOW()),
  ('Rahul Jain', 'rahul@demo.example', 'employee',  TRUE, NOW()),
  ('Neha Patil', 'neha@example.com',   'candidate', TRUE, NOW()),
  ('Amit Shah',  'amit@example.com',   'candidate', TRUE, NOW());

INSERT INTO employee_profiles (user_id, company_id, work_email, verified_at)
SELECT u.id, c.id, u.email, NOW()
FROM users u JOIN companies c ON c.domain = 'demo.example'
WHERE u.email IN ('asha@demo.example', 'rahul@demo.example');

INSERT INTO candidate_profiles (user_id, experience_years, notice_period_days, current_location, expected_ctc_lpa) VALUES
  ((SELECT id FROM users WHERE email = 'neha@example.com'), 4.5, 60, 'Pune', 14.0),
  ((SELECT id FROM users WHERE email = 'amit@example.com'), 7.0, 30, 'Bengaluru', 22.0);

INSERT INTO user_skills (user_id, skill_id)
SELECT u.id, s.id FROM users u, skills s
WHERE (u.email, s.name) IN (
  ('neha@example.com', 'PL/SQL'), ('neha@example.com', 'Finacle'), ('neha@example.com', 'Splunk'),
  ('amit@example.com', 'Java'), ('amit@example.com', 'Spring Boot'), ('amit@example.com', 'AWS'));

INSERT INTO job_posts (employee_id, company_id, external_job_id, public_link, title, experience_min, experience_max, location)
SELECT u.id, c.id, v.job_id, v.link, v.title, v.emin, v.emax, v.loc
FROM (VALUES
  ('asha@demo.example',  'DEMO-1001', 'https://example.com/jobs/1001', 'Production Support Engineer, Banking', 3, 6, 'Pune'),
  ('rahul@demo.example', 'DEMO-2002', 'https://example.com/jobs/2002', 'Java Backend Developer', 5, 9, 'Bengaluru')
) AS v(email, job_id, link, title, emin, emax, loc)
JOIN users u ON u.email = v.email
JOIN companies c ON c.domain = 'demo.example';

INSERT INTO job_skills (job_post_id, skill_id)
SELECT j.id, s.id FROM job_posts j, skills s
WHERE (j.external_job_id, s.name) IN (
  ('DEMO-1001', 'PL/SQL'), ('DEMO-1001', 'Finacle'), ('DEMO-1001', 'Splunk'),
  ('DEMO-2002', 'Java'), ('DEMO-2002', 'Spring Boot'), ('DEMO-2002', 'AWS'));

INSERT INTO referral_requests (job_post_id, candidate_id, note, match_score)
SELECT j.id, u.id, v.note, 100
FROM (VALUES
  ('DEMO-1001', 'neha@example.com', 'Four years in banking support.'),
  ('DEMO-2002', 'amit@example.com', 'Strong Spring Boot and AWS experience.')
) AS v(job_id, email, note)
JOIN job_posts j ON j.external_job_id = v.job_id
JOIN users u ON u.email = v.email;
