// Email OTP login + JWT sessions.
// Employees must sign in with a work email whose domain is in the companies
// table, which is what makes them "verified". Candidates can use any email.
//
// Env:     JWT_SECRET (required), SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS/MAIL_FROM
//          Without SMTP_HOST, codes are printed to the server console (dev only).

const crypto = require("crypto");
const express = require("express");
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");

module.exports = function authModule(pool) {
  const SECRET = process.env.JWT_SECRET;
  if (!SECRET) throw new Error("Set JWT_SECRET in the environment");

  const mailer = process.env.SMTP_HOST
    ? nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      })
    : null;

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const domainOf = (email) => email.split("@")[1];
  const hash = (email, otp) =>
    crypto.createHmac("sha256", SECRET).update(`${email}:${otp}`).digest("hex");

  async function sendOtp(email, otp) {
    if (!mailer) {
      console.log(`[DEV] OTP for ${email}: ${otp}`);
      return;
    }
    await mailer.sendMail({
      from: process.env.MAIL_FROM,
      to: email,
      subject: "Your ReferDesk sign-in code",
      text: `Your code is ${otp}. It expires in 10 minutes.`,
    });
  }

  // ---- Middleware: reads "Authorization: Bearer <token>" ----
  async function auth(req, res, next) {
    const header = req.header("authorization") || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: "Sign in required" });
    try {
      const { uid } = jwt.verify(token, SECRET);
      const { rows } = await pool.query(
        "SELECT id, name, email, role, is_verified FROM users WHERE id = $1",
        [uid]
      );
      if (!rows[0]) return res.status(401).json({ error: "Account not found" });
      req.user = rows[0];
      next();
    } catch {
      res.status(401).json({ error: "Session expired. Sign in again." });
    }
  }

  const router = express.Router();

  // Step 1: send a 6-digit code
  router.post("/request-otp", async (req, res) => {
    try {
      const email = String(req.body.email || "").trim().toLowerCase();
      const role = req.body.role;
      if (!EMAIL_RE.test(email))
        return res.status(400).json({ error: "Enter a valid email address" });

      // New employees must use a recognised company domain
      const existing = await pool.query("SELECT 1 FROM users WHERE email = $1", [email]);
      if (!existing.rows[0] && role === "employee") {
        const c = await pool.query("SELECT 1 FROM companies WHERE $1 = domain OR $1 LIKE '%.' || domain", [domainOf(email)]);
        if (!c.rows[0])
          return res.status(400).json({
            error: "We don't recognise this company email domain. Use your work email.",
          });
      }

      const recent = await pool.query(
        "SELECT 1 FROM otp_codes WHERE email = $1 AND created_at > NOW() - INTERVAL '60 seconds'",
        [email]
      );
      if (recent.rows[0])
        return res.status(429).json({ error: "Wait a minute before requesting another code" });

      const otp = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
      await pool.query(
        `INSERT INTO otp_codes (email, code_hash, expires_at)
         VALUES ($1, $2, NOW() + INTERVAL '10 minutes')
         ON CONFLICT (email) DO UPDATE
           SET code_hash = EXCLUDED.code_hash, expires_at = EXCLUDED.expires_at,
               attempts = 0, created_at = NOW()`,
        [email, hash(email, otp)]
      );
      await sendOtp(email, otp);
      res.json({ ok: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Could not send the code. Try again." });
    }
  });

  // Step 2: verify the code, create the account if new, return a JWT
  router.post("/verify-otp", async (req, res) => {
    const client = await pool.connect();
    try {
      const email = String(req.body.email || "").trim().toLowerCase();
      const otp = String(req.body.otp || "").trim();

      const { rows } = await client.query("SELECT * FROM otp_codes WHERE email = $1", [email]);
      const row = rows[0];
      if (!row || new Date(row.expires_at) < new Date())
        return res.status(400).json({ error: "Code expired. Request a new one." });
      if (row.attempts >= 5)
        return res.status(429).json({ error: "Too many wrong codes. Request a new one." });

      const ok = crypto.timingSafeEqual(
        Buffer.from(hash(email, otp)),
        Buffer.from(row.code_hash)
      );
      if (!ok) {
        await client.query("UPDATE otp_codes SET attempts = attempts + 1 WHERE email = $1", [email]);
        return res.status(400).json({ error: "Wrong code" });
      }

      let user = (await client.query("SELECT * FROM users WHERE email = $1", [email])).rows[0];

      if (!user) {
        const name = String(req.body.name || "").trim();
        const role = req.body.role;
        if (!name) return res.status(400).json({ error: "Enter your name to create an account" });
        if (!["candidate", "employee"].includes(role))
          return res.status(400).json({ error: "Choose how you will use ReferDesk" });
        if (req.body.consent !== true)
          return res.status(400).json({ error: "Accept the data consent to continue" });

        let companyId = null;
        if (role === "employee") {
          const c = await client.query("SELECT id FROM companies WHERE $1 = domain OR $1 LIKE '%.' || domain ORDER BY length(domain) DESC LIMIT 1", [domainOf(email)]);
          if (!c.rows[0])
            return res.status(400).json({ error: "Use your company email to sign up as an employee" });
          companyId = c.rows[0].id;
        }

        await client.query("BEGIN");
        user = (
          await client.query(
            `INSERT INTO users (name, email, role, is_verified, consent_at)
             VALUES ($1, $2, $3, TRUE, NOW()) RETURNING *`,
            [name, email, role]
          )
        ).rows[0];
        if (role === "employee") {
          await client.query(
            `INSERT INTO employee_profiles (user_id, company_id, work_email, verified_at)
             VALUES ($1, $2, $3, NOW())`,
            [user.id, companyId, email]
          );
        } else {
          await client.query("INSERT INTO candidate_profiles (user_id) VALUES ($1)", [user.id]);
        }
        await client.query("COMMIT");
      }

      await client.query("DELETE FROM otp_codes WHERE email = $1", [email]);
      const token = jwt.sign({ uid: user.id }, SECRET, { expiresIn: "7d" });
      res.json({
        token,
        user: { id: user.id, name: user.name, email: user.email, role: user.role },
      });
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      console.error(e);
      res.status(500).json({ error: "Could not sign you in. Try again." });
    } finally {
      client.release();
    }
  });

  router.get("/me", auth, (req, res) => res.json(req.user));

  return { router, auth };
};
