-- IT Referral Platform: PostgreSQL schema (MVP)

CREATE TYPE user_role AS ENUM ('employee', 'candidate', 'admin');
CREATE TYPE job_status AS ENUM ('open', 'closed');
CREATE TYPE referral_status AS ENUM (
  'requested', 'shortlisted', 'referred',
  'interview', 'offer', 'joined', 'rejected', 'withdrawn'
);

CREATE TABLE companies (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  domain      TEXT NOT NULL UNIQUE          -- e.g. infosys.com, used for work-email check
);

CREATE TABLE users (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  role          user_role NOT NULL,
  is_verified   BOOLEAN NOT NULL DEFAULT FALSE,
  consent_at    TIMESTAMPTZ,                -- DPDP consent timestamp
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE employee_profiles (
  user_id      INT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  company_id   INT NOT NULL REFERENCES companies(id),
  work_email   TEXT NOT NULL UNIQUE,
  verified_at  TIMESTAMPTZ
);

CREATE TABLE candidate_profiles (
  user_id            INT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  experience_years   NUMERIC(4,1) NOT NULL DEFAULT 0,
  notice_period_days INT,
  current_location   TEXT,
  expected_ctc_lpa   NUMERIC(6,2),
  resume_url         TEXT
);

CREATE TABLE skills (
  id    SERIAL PRIMARY KEY,
  name  TEXT NOT NULL UNIQUE
);

CREATE TABLE user_skills (
  user_id   INT REFERENCES users(id) ON DELETE CASCADE,
  skill_id  INT REFERENCES skills(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, skill_id)
);

CREATE TABLE job_posts (
  id               SERIAL PRIMARY KEY,
  employee_id      INT NOT NULL REFERENCES users(id),
  company_id       INT NOT NULL REFERENCES companies(id),
  external_job_id  TEXT,                    -- job ID on the company portal
  public_link      TEXT NOT NULL,           -- only publicly listed jobs
  title            TEXT NOT NULL,
  experience_min   INT NOT NULL DEFAULT 0,
  experience_max   INT,
  location         TEXT,
  status           job_status NOT NULL DEFAULT 'open',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE job_skills (
  job_post_id  INT REFERENCES job_posts(id) ON DELETE CASCADE,
  skill_id     INT REFERENCES skills(id) ON DELETE CASCADE,
  PRIMARY KEY (job_post_id, skill_id)
);

CREATE TABLE referral_requests (
  id            SERIAL PRIMARY KEY,
  job_post_id   INT NOT NULL REFERENCES job_posts(id) ON DELETE CASCADE,
  candidate_id  INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  note          TEXT,
  match_score   NUMERIC(5,2),
  status        referral_status NOT NULL DEFAULT 'requested',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (job_post_id, candidate_id)        -- no duplicate requests
);

CREATE TABLE ratings (
  id                   SERIAL PRIMARY KEY,
  referral_request_id  INT NOT NULL REFERENCES referral_requests(id) ON DELETE CASCADE,
  from_user            INT NOT NULL REFERENCES users(id),
  to_user              INT NOT NULL REFERENCES users(id),
  score                INT NOT NULL CHECK (score BETWEEN 1 AND 5),
  comment              TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (referral_request_id, from_user)
);

CREATE TABLE reports (
  id                SERIAL PRIMARY KEY,
  reporter_id       INT NOT NULL REFERENCES users(id),
  reported_user_id  INT NOT NULL REFERENCES users(id),
  reason            TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for common lookups
CREATE INDEX idx_job_posts_status      ON job_posts(status, company_id);
CREATE INDEX idx_referral_job          ON referral_requests(job_post_id, status);
CREATE INDEX idx_referral_candidate    ON referral_requests(candidate_id);
CREATE INDEX idx_user_skills_skill     ON user_skills(skill_id);
CREATE INDEX idx_job_skills_skill      ON job_skills(skill_id);

-- Skill match score: % of a job's required skills the candidate has
-- Usage: SELECT * FROM candidate_match(<job_post_id>) ORDER BY match_score DESC;
CREATE OR REPLACE FUNCTION candidate_match(p_job_id INT)
RETURNS TABLE (candidate_id INT, match_score NUMERIC) AS $$
  SELECT us.user_id,
         ROUND(100.0 * COUNT(*) /
           NULLIF((SELECT COUNT(*) FROM job_skills WHERE job_post_id = p_job_id), 0), 2)
  FROM user_skills us
  JOIN job_skills js ON js.skill_id = us.skill_id
  WHERE js.job_post_id = p_job_id
  GROUP BY us.user_id;
$$ LANGUAGE sql STABLE;

CREATE TABLE otp_codes (
  email       TEXT PRIMARY KEY,
  code_hash   TEXT NOT NULL,              -- HMAC of the code, never the code itself
  expires_at  TIMESTAMPTZ NOT NULL,
  attempts    INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
