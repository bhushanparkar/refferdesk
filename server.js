// ReferDesk backend: Express + PostgreSQL, email-OTP login (auth.js).
// Also serves the built frontend, so one URL runs the whole app.

require("dotenv").config();
const fs = require("fs");
const path = require("path");

const isProd = process.env.NODE_ENV === "production";
if (!process.env.JWT_SECRET) {
  if (isProd) {
    console.error("JWT_SECRET is required in production.");
    process.exit(1);
  }
  process.env.JWT_SECRET = "dev-only-secret-change-me";
  console.warn("JWT_SECRET not set: using an insecure dev secret.");
}

const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");

const app = express();
if (process.env.CORS_ORIGIN) app.use(cors({ origin: process.env.CORS_ORIGIN }));
app.use(express.json());

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL || "postgres://referdesk:referdesk@localhost:5432/referdesk",
  ssl: process.env.PGSSL === "true" ? { rejectUnauthorized: false } : undefined,
});

app.get("/healthz", (req, res) => res.json({ ok: true }));

const { router: authRouter, auth } = require("./auth")(pool);
app.use("/auth", authRouter);

const requireRole = (role) => (req, res, next) =>
  req.user.role === role
    ? next()
    : res.status(403).json({ error: `Only ${role}s can do this` });

// ---- Employee: post a job (verified employees only) ----
app.post("/jobs", auth, requireRole("employee"), async (req, res) => {
  const { external_job_id, public_link, title, experience_min,
          experience_max, location, skill_ids = [] } = req.body;
  if (!public_link || !title)
    return res.status(400).json({ error: "public_link and title required" });
  if (!req.user.is_verified)
    return res.status(403).json({ error: "Verify your work email first" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const emp = await client.query(
      "SELECT company_id FROM employee_profiles WHERE user_id = $1",
      [req.user.id]
    );
    if (!emp.rows[0]) throw new Error("No employee profile");

    const job = await client.query(
      `INSERT INTO job_posts (employee_id, company_id, external_job_id,
         public_link, title, experience_min, experience_max, location)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [req.user.id, emp.rows[0].company_id, external_job_id, public_link,
       title, experience_min || 0, experience_max, location]
    );
    for (const sid of skill_ids) {
      await client.query(
        "INSERT INTO job_skills (job_post_id, skill_id) VALUES ($1,$2)",
        [job.rows[0].id, sid]
      );
    }
    await client.query("COMMIT");
    res.status(201).json(job.rows[0]);
  } catch (e) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

// ---- Anyone: browse open jobs (filter by skill, location) ----
app.get("/jobs", auth, async (req, res) => {
  const { skill_id, location } = req.query;
  const { rows } = await pool.query(
    `SELECT j.*, c.name AS company,
            ARRAY_AGG(s.name) FILTER (WHERE s.name IS NOT NULL) AS skills
     FROM job_posts j
     JOIN companies c ON c.id = j.company_id
     LEFT JOIN job_skills js ON js.job_post_id = j.id
     LEFT JOIN skills s ON s.id = js.skill_id
     WHERE j.status = 'open'
       AND ($1::int IS NULL OR j.id IN
            (SELECT job_post_id FROM job_skills WHERE skill_id = $1))
       AND ($2::text IS NULL OR j.location ILIKE '%' || $2 || '%')
     GROUP BY j.id, c.name
     ORDER BY j.created_at DESC`,
    [skill_id || null, location || null]
  );
  res.json(rows);
});

// ---- Candidate: request a referral ----
app.post("/jobs/:id/request", auth, requireRole("candidate"), async (req, res) => {
  const jobId = parseInt(req.params.id, 10);
  try {
    const score = await pool.query(
      "SELECT match_score FROM candidate_match($1) WHERE candidate_id = $2",
      [jobId, req.user.id]
    );
    const { rows } = await pool.query(
      `INSERT INTO referral_requests (job_post_id, candidate_id, note, match_score)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [jobId, req.user.id, req.body.note || null, score.rows[0]?.match_score || 0]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    if (e.code === "23505")
      return res.status(409).json({ error: "Already requested" });
    res.status(500).json({ error: e.message });
  }
});

// ---- Employee: see ranked candidates for own job ----
app.get("/jobs/:id/candidates", auth, requireRole("employee"), async (req, res) => {
  const { rows } = await pool.query(
    `SELECT r.id AS request_id, r.status, r.match_score, r.note,
            u.name, cp.experience_years, cp.notice_period_days,
            cp.current_location, cp.resume_url
     FROM referral_requests r
     JOIN job_posts j ON j.id = r.job_post_id
     JOIN users u ON u.id = r.candidate_id
     JOIN candidate_profiles cp ON cp.user_id = u.id
     WHERE r.job_post_id = $1 AND j.employee_id = $2
     ORDER BY r.match_score DESC, cp.experience_years DESC`,
    [req.params.id, req.user.id]
  );
  res.json(rows);
});

// ---- Employee: update referral status ----
const STATUSES = ["shortlisted", "referred", "interview", "offer", "joined", "rejected"];

app.patch("/requests/:id/status", auth, requireRole("employee"), async (req, res) => {
  const { status } = req.body;
  if (!STATUSES.includes(status))
    return res.status(400).json({ error: "Invalid status" });
  const { rows } = await pool.query(
    `UPDATE referral_requests r SET status = $1, updated_at = NOW()
     FROM job_posts j
     WHERE r.id = $2 AND j.id = r.job_post_id AND j.employee_id = $3
     RETURNING r.*`,
    [status, req.params.id, req.user.id]
  );
  if (!rows[0]) return res.status(404).json({ error: "Not found or not yours" });
  res.json(rows[0]);
});

// ---- Candidate: track own requests ----
app.get("/my/requests", auth, requireRole("candidate"), async (req, res) => {
  const { rows } = await pool.query(
    `SELECT r.id, r.job_post_id, r.status, r.match_score, j.title, j.public_link, c.name AS company
     FROM referral_requests r
     JOIN job_posts j ON j.id = r.job_post_id
     JOIN companies c ON c.id = j.company_id
     WHERE r.candidate_id = $1
     ORDER BY r.updated_at DESC`,
    [req.user.id]
  );
  res.json(rows);
});

// ---- Skills list (for pickers) ----
app.get("/skills", auth, async (req, res) => {
  const { rows } = await pool.query("SELECT id, name FROM skills ORDER BY name");
  res.json(rows);
});

// ---- Employee: own job posts with request counts ----
app.get("/my/jobs", auth, requireRole("employee"), async (req, res) => {
  const { rows } = await pool.query(
    `SELECT j.id, j.title, j.location, j.status, j.public_link, j.created_at,
            COUNT(r.id)::int AS request_count
     FROM job_posts j
     LEFT JOIN referral_requests r ON r.job_post_id = j.id
     WHERE j.employee_id = $1
     GROUP BY j.id
     ORDER BY j.created_at DESC`,
    [req.user.id]
  );
  res.json(rows);
});

// ---- Candidate: read and update own profile ----
app.get("/my/profile", auth, requireRole("candidate"), async (req, res) => {
  const p = await pool.query("SELECT * FROM candidate_profiles WHERE user_id = $1", [req.user.id]);
  const s = await pool.query("SELECT skill_id FROM user_skills WHERE user_id = $1", [req.user.id]);
  res.json({ ...(p.rows[0] || {}), skill_ids: s.rows.map((r) => r.skill_id) });
});

app.put("/my/profile", auth, requireRole("candidate"), async (req, res) => {
  const { experience_years, notice_period_days, current_location,
          expected_ctc_lpa, resume_url, skill_ids = [] } = req.body;
  if (resume_url && !/^https?:\/\//i.test(resume_url))
    return res.status(400).json({ error: "Resume link must start with http:// or https://" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO candidate_profiles
         (user_id, experience_years, notice_period_days, current_location,
          expected_ctc_lpa, resume_url)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (user_id) DO UPDATE SET
         experience_years = EXCLUDED.experience_years,
         notice_period_days = EXCLUDED.notice_period_days,
         current_location = EXCLUDED.current_location,
         expected_ctc_lpa = EXCLUDED.expected_ctc_lpa,
         resume_url = EXCLUDED.resume_url`,
      [req.user.id, experience_years || 0, notice_period_days || null,
       current_location || null, expected_ctc_lpa || null, resume_url || null]
    );
    await client.query("DELETE FROM user_skills WHERE user_id = $1", [req.user.id]);
    for (const sid of skill_ids) {
      await client.query(
        "INSERT INTO user_skills (user_id, skill_id) VALUES ($1,$2)",
        [req.user.id, sid]
      );
    }
    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (e) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

// ---- Frontend (built files) ----
const distDir = [path.join(__dirname, "public"), path.join(__dirname, "../frontend/dist")]
  .find((d) => fs.existsSync(path.join(d, "index.html")));
if (distDir) app.use(express.static(distDir));
else console.warn("Frontend build not found. Run `npm run build` in /frontend.");

// ---- Create tables on first start ----
async function ensureSchema() {
  const { rows } = await pool.query("SELECT to_regclass('public.users') AS t");
  if (rows[0].t) return;
  const files = ["01_schema.sql", "02_base.sql"];
  if (process.env.SEED_DEMO === "true") files.push("03_demo.sql");
  for (const f of files) {
    await pool.query(fs.readFileSync(path.join(__dirname, "db", f), "utf8"));
  }
  console.log("Database initialised:", files.join(", "));
}

async function start() {
  for (let i = 1; ; i++) {
    try {
      await ensureSchema();
      break;
    } catch (e) {
      if (i >= 15) {
        console.error("Cannot reach the database:", e.message);
        process.exit(1);
      }
      console.log(`Waiting for database (${i}/15): ${e.message}`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`ReferDesk running on http://localhost:${port}`));
}
start();
