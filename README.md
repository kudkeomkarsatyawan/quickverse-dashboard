# Quickverse Dashboard

Internal operations dashboard for **Quickverse** — a hyperlocal delivery platform. Manages orders, vendors, settlements, delivery personnel, and real-time analytics, all synced from the Quickverse Admin Deck API.

---

## Tech Stack

| Layer        | Technology                                                            |
|--------------|-----------------------------------------------------------------------|
| **Frontend** | React 18 · TypeScript · Vite 5 · Tailwind CSS 3 · Zustand · Recharts |
| **Backend**  | Python 3.11+ · FastAPI · SQLAlchemy 2 · Pydantic 2 · Uvicorn         |
| **Database** | PostgreSQL 14+                                                        |
| **HTTP**     | Axios (frontend) · httpx (backend, for Admin Deck API calls)          |

---

## Features

- **OTP Authentication** — Phone-based login via Quickverse Admin Deck API.
- **Order Management** — Sync, search, filter, and paginate orders. Assign delivery persons to orders.
- **Vendor Management** — Sync vendors from Admin Deck. Custom commission rates and notes per vendor.
- **Settlement Engine** — Auto-calculate vendor settlements (commission, platform fees, delivery fees, adjustments).
- **Delivery Personnel** — Full CRUD for delivery staff. Attendance, salary, per-delivery bonus, performance stats.
- **Analytics Dashboard** — Revenue trends, order volume, payment method breakdown, delivery performance charts.
- **Live Map** — Real-time active-order map (requires Google Maps API key).

---

## Project Structure

```
quickverse-dashboard/
├── .env                  ← your local secrets — never committed
├── .env.example          ← copy this to .env
├── .gitignore
├── init_db.sql           ← one-shot DB setup (user + schema + indexes)
├── backend/
│   ├── main.py           ← FastAPI app, all routes (port 8000)
│   ├── models.py         ← SQLAlchemy ORM models
│   ├── database.py       ← DB engine, reads DATABASE_URL from .env
│   ├── admin_deck.py     ← Quickverse Admin Deck API client
│   └── requirements.txt  ← pinned Python dependencies
└── frontend/
    ├── src/
    ├── vite.config.ts    ← dev server port 5173, proxies /api → 8000
    └── package.json
```

---

## Prerequisites

Install all of these before starting. Run the check commands to verify.

| Tool           | Version | Check command       |
|----------------|---------|---------------------|
| **Python**     | 3.11+   | `python --version`  |
| **Node.js**    | 18+     | `node --version`    |
| **npm**        | 9+      | `npm --version`     |
| **PostgreSQL** | 14+     | `psql --version`    |
| **Git**        | any     | `git --version`     |

> **Windows:** After installing PostgreSQL, if `psql` is not found, add  
> `C:\Program Files\PostgreSQL\<version>\bin` to your system PATH and reopen your terminal.

---

## Setup — Step by Step

### Step 1 — Clone the repository

```bash
git clone https://github.com/<your-org>/quickverse-dashboard.git
cd quickverse-dashboard
```

---

### Step 2 — Set up the database

> **This step is where previous setups failed. Follow it exactly.**

The script `init_db.sql` does everything in one shot:
- Creates a dedicated app user (`quickverse_user` / `quickverse_pass`)
- Creates the `quickverse` database owned by that user
- Creates all tables, indexes, and default config rows
- Grants all required permissions to the app user

You only need the **PostgreSQL superuser** (`postgres`) to run this script once.

#### 2a. Find your postgres superuser password

This is the password you set when you installed PostgreSQL on your machine.

- **Windows:** It was set during the installer wizard. If you forgot it, see [Forgot postgres password](#forgot-the-postgres-superuser-password) below.
- **Mac (Homebrew):** Often no password is set — try pressing Enter when prompted.
- **Linux:** Run `sudo -u postgres psql` (no password needed for the superuser on most distros).

#### 2b. Run the initialization script

```bash
# From the quickverse-dashboard/ root directory:
psql -U postgres -f init_db.sql
```

You will be prompted for the `postgres` password. Enter it.

**Expected output (no errors):**
```
DO
CREATE DATABASE
GRANT
CREATE TABLE
CREATE TABLE
CREATE TABLE
CREATE TABLE
CREATE TABLE
CREATE TABLE
INSERT 0 3
CREATE INDEX
...
GRANT
GRANT
```

If you see `ERROR: database "quickverse" already exists`, the database was created in a previous attempt. Drop it and re-run:

```bash
psql -U postgres -c "DROP DATABASE IF EXISTS quickverse;"
psql -U postgres -f init_db.sql
```

#### 2c. Verify the connection

Confirm the app user can connect before proceeding:

```bash
psql -U quickverse_user -d quickverse -c "SELECT 1;"
# It will prompt: Password for user quickverse_user:
# Enter: quickverse_pass
```

Expected output:
```
 ?column?
----------
        1
(1 row)
```

If this works, your database is ready. If you get `FATAL: password authentication failed`, see [Auth errors](#fatal-password-authentication-failed).

---

### Step 3 — Configure environment variables

The entire app (backend + frontend) reads from a **single `.env` file** in the project root.

```bash
# Mac / Linux
cp .env.example .env

# Windows PowerShell
Copy-Item .env.example .env
```

**If you ran `init_db.sql` without changes, you do not need to edit `.env` at all.**

The pre-filled values in `.env.example` match the user created by the script:

```dotenv
DATABASE_URL=postgresql://quickverse_user:quickverse_pass@localhost:5432/quickverse
ADMIN_DECK_BASE_URL=http://prd.quickverse.in/quickVerse
VITE_GOOGLE_MAPS_API_KEY=
```

> The `VITE_GOOGLE_MAPS_API_KEY` line is optional and only affects the Live Map page.  
> Leave it blank — the rest of the dashboard works without it.

> **Never commit `.env`** — it is already in `.gitignore`.

---

### Step 4 — Set up the Python backend

```bash
cd backend

# Create a virtual environment
python -m venv venv

# Activate it
# Mac / Linux:
source venv/bin/activate
# Windows PowerShell:
.\venv\Scripts\Activate.ps1
# Windows CMD:
venv\Scripts\activate.bat

# Install pinned dependencies
pip install -r requirements.txt
```

> Make sure `(venv)` appears in your terminal prompt before running `pip install`.  
> If you install without activating, packages go to your global Python and may conflict.

---

### Step 5 — Set up the frontend

Open a **new terminal** (keep the backend terminal open):

```bash
# From the project root
cd frontend
npm install
```

This installs everything from `package.json`. `node_modules/` is git-ignored and never committed.

---

### Step 6 — Launch the application

You need **two terminals running at the same time**.

**Terminal 1 — Backend:**

```bash
cd backend
# Activate venv first if not already active:
source venv/bin/activate          # Mac/Linux
# .\venv\Scripts\Activate.ps1    # Windows

uvicorn main:app --reload --port 8000
```

Wait until you see:
```
INFO:     Application startup complete.
INFO:     Uvicorn running on http://0.0.0.0:8000
```

On first run, SQLAlchemy automatically creates any missing columns (it runs inline migrations). **You do not need to run migrations manually.**

**Terminal 2 — Frontend:**

```bash
cd frontend
npm run dev
```

Wait until you see:
```
  VITE v5.x.x  ready

  ➜  Local:   http://localhost:5173/
```

**Open the dashboard:** http://localhost:5173

The Vite dev server proxies all `/api` calls to port 8000 automatically — no CORS configuration needed.

---

## Verification Checklist

Run through these after setup to confirm everything is working:

- [ ] `psql -U quickverse_user -d quickverse -c "SELECT 1;"` returns a row
- [ ] `http://localhost:8000/api/health` returns `{"status": "ok", ...}`
- [ ] `http://localhost:5173` loads the login page in the browser
- [ ] Backend terminal shows no red errors after startup

---

## Pushing to GitHub (for the repo owner)

Run these commands **once** from the `quickverse-dashboard/` directory to initialise and push the repo:

```bash
# 1. Initialise git (skip if already a git repo)
git init

# 2. Confirm .env is ignored before adding any files
git check-ignore -v .env
# Expected output: .gitignore:16:.env    .env
# If you see no output, .env is NOT ignored — stop and fix .gitignore first.

# 3. Stage everything except what .gitignore blocks
git add .

# 4. Double-check that .env is not staged
git status
# You should NOT see .env in the list. If you do, run:
# git rm --cached .env

# 5. Commit
git commit -m "Initial commit: Quickverse Dashboard"

# 6. Add the remote (replace with your actual repo URL)
git remote add origin https://github.com/<your-org>/quickverse-dashboard.git

# 7. Push
git push -u origin main
```

> If your default branch is `master` instead of `main`, replace `main` with `master` in step 7.

---

## API Overview

Base URL: `http://localhost:8000`  
Interactive docs: **http://localhost:8000/docs**

| Method   | Endpoint                           | Description                         |
|----------|------------------------------------|-------------------------------------|
| `POST`   | `/api/auth/send-otp`               | Send OTP to phone number            |
| `POST`   | `/api/auth/verify-otp`             | Verify OTP, returns session key     |
| `GET`    | `/api/auth/regions`                | List available regions              |
| `POST`   | `/api/orders/sync`                 | Sync orders from Admin Deck         |
| `GET`    | `/api/orders`                      | List orders (filterable, paginated) |
| `PUT`    | `/api/orders/{id}/assign-delivery` | Assign delivery person to order     |
| `POST`   | `/api/vendors/sync`                | Sync vendors from Admin Deck        |
| `GET`    | `/api/vendors`                     | List all vendors                    |
| `PUT`    | `/api/vendors/{id}`                | Update vendor commission/notes      |
| `POST`   | `/api/settlements/calculate`       | Calculate & create a settlement     |
| `GET`    | `/api/settlements`                 | List settlements                    |
| `GET`    | `/api/settlements/vendor-summary`  | Per-vendor settlement summary       |
| `PUT`    | `/api/settlements/{id}/settle`     | Mark settlement as settled          |
| `DELETE` | `/api/settlements/{id}`            | Delete a settlement                 |
| `GET`    | `/api/delivery-persons`            | List delivery personnel + stats     |
| `POST`   | `/api/delivery-persons`            | Add a delivery person               |
| `GET`    | `/api/analytics/summary`           | Revenue and order analytics         |
| `GET`    | `/api/health`                      | Health check                        |

---

## Common Errors and Fixes

### `FATAL: password authentication failed`

**Cause:** The user/password in your `DATABASE_URL` does not match what PostgreSQL expects.

**Fix:**
1. Confirm you ran `init_db.sql` successfully (Step 2b).
2. Confirm your `.env` contains exactly:
   ```
   DATABASE_URL=postgresql://quickverse_user:quickverse_pass@localhost:5432/quickverse
   ```
3. Test directly: `psql -U quickverse_user -d quickverse -c "SELECT 1;"`

If the test also fails, the user was not created. Re-run `init_db.sql`:
```bash
psql -U postgres -c "DROP DATABASE IF EXISTS quickverse;"
psql -U postgres -c "DROP ROLE IF EXISTS quickverse_user;"
psql -U postgres -f init_db.sql
```

---

### `FATAL: database "quickverse" does not exist`

The database was not created. Re-run `init_db.sql` (see above).

---

### `connection refused` on port 5432

PostgreSQL is not running.

```bash
# Windows — open Services (services.msc) and start postgresql-x64-<version>
# OR in PowerShell (Admin):
Start-Service postgresql*

# Mac (Homebrew):
brew services start postgresql@14

# Linux:
sudo systemctl start postgresql
```

---

### `pg_hba.conf` authentication errors (peer / ident)

On Linux, PostgreSQL may use `peer` auth by default, which ignores passwords. Edit `/etc/postgresql/<version>/main/pg_hba.conf` and change the local connection line from `peer` to `scram-sha-256`, then restart:

```bash
sudo systemctl restart postgresql
```

---

### Forgot the postgres superuser password

**Windows:**
1. Open `C:\Program Files\PostgreSQL\<version>\data\pg_hba.conf`
2. Find the line: `host all all 127.0.0.1/32 scram-sha-256`
3. Temporarily change `scram-sha-256` to `trust`
4. Restart the PostgreSQL service (via `services.msc`)
5. Connect with `psql -U postgres` (no password needed now)
6. Run: `ALTER USER postgres WITH PASSWORD 'newpassword';`
7. Revert `pg_hba.conf` back to `scram-sha-256` and restart the service

**Mac / Linux:**
```bash
sudo -u postgres psql
ALTER USER postgres WITH PASSWORD 'newpassword';
\q
```

---

### `ModuleNotFoundError` in Python

The virtual environment is not activated. You should see `(venv)` in your prompt. Run:
```bash
source backend/venv/bin/activate   # Mac/Linux
.\backend\venv\Scripts\Activate.ps1  # Windows
```

---

### Frontend shows blank data or "Network Error"

The backend is not running, or it crashed on startup. Check Terminal 1 for error output. The most common cause is a wrong `DATABASE_URL` — fix `.env` and restart uvicorn.

---

### `npm install` fails or `node_modules` errors

```bash
cd frontend
rm -rf node_modules package-lock.json   # Mac/Linux
# Windows: Remove-Item -Recurse -Force node_modules, package-lock.json
npm install
```

---

## License

Private — Internal use only.
