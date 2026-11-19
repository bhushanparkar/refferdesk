# ReferDesk

IT-only referral platform. Employees post publicly listed roles, job seekers request referrals,
employees track each referral through to joining. Runs as a web app that installs on iPhone.

## Option A: Docker (easiest, 1 command)

    docker compose up --build

Open http://localhost:3000. Demo data is loaded. Sign-in codes print in the terminal
(look for `[DEV] OTP for ...`).

Demo logins: asha@demo.example (employee), neha@example.com (candidate).
New name and consent are only asked on first sign-in of a new email.

## Option B: Without Docker

Needs Node 18+ and PostgreSQL.

    createdb referdesk   # and a user/password, or point DATABASE_URL at any database
    cd frontend && npm install && npm run build && cd ..
    cd backend && npm install
    cp .env.example .env    # edit DATABASE_URL and JWT_SECRET
    npm start

Open http://localhost:3000. Tables are created automatically on first start.

For live frontend editing: run `npm start` in backend, `npm run dev` in frontend,
and open http://localhost:5173.

## Put it on your iPhone

An iPhone cannot reach `localhost`, so deploy it first.

1. Push this folder to a GitHub repo.
2. On Render: New > Blueprint > pick the repo. It reads `render.yaml` and creates the
   web service and the database. (Railway and Fly.io also work with the Dockerfile.)
3. Add SMTP settings in the service's environment so sign-in codes are emailed
   (any SMTP provider works). Without them, codes only appear in the server logs.
4. Open your https URL in **Safari** on the iPhone.
5. Tap Share, then **Add to Home Screen**. It opens full screen like an app.

Quick test without deploying: run locally, then `cloudflared tunnel --url http://localhost:3000`
gives a temporary https link you can open on the phone.

## Real App Store app (optional)

The web app above is what installs without an Apple account. For a native wrapper
you need a Mac with Xcode and an Apple Developer account:

    cd frontend
    npm i @capacitor/core @capacitor/cli @capacitor/ios
    npx cap init ReferDesk com.yourname.referdesk --web-dir=dist
    # set VITE_API=https://your-deployed-url in frontend/.env, then:
    npm run build && npx cap add ios && npx cap sync && npx cap open ios

## Things to know

- Employees sign up only with an email whose domain is in the `companies` table
  (see `backend/db/02_base.sql`). Check the domains and add yours.
- Candidates add a resume link; file upload is not built yet.
- Add rate limiting (for example `express-rate-limit`) before a public launch.
- Resumes and profiles are personal data. Keep the consent checkbox and have a
  way to delete accounts (India's DPDP Act).
