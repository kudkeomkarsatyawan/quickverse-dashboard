# Quickverse Dashboard

Internal admin dashboard for the Quickverse platform — orders, vendors, delivery persons, settlements, and live map.

## Stack

| Layer    | Technology                       |
|----------|----------------------------------|
| Backend  | Python · FastAPI · SQLAlchemy    |
| Database | PostgreSQL 13+                   |
| Frontend | React 18 · TypeScript · Vite     |

---

## Quick Start (fresh machine)

Follow every step in order. Estimated time: ~10 minutes.

### Prerequisites

Install these before anything else:

| Tool       | Version | Download |
|------------|---------|----------|
| PostgreSQL | 13+     | https://www.postgresql.org/download/ |
| Python     | 3.10+   | https://www.python.org/downloads/    |
| Node.js    | 18+     | https://nodejs.org/                  |
| Git        | any     | https://git-scm.com/                 |

> **Windows note:** After installing PostgreSQL, make sure `psql` is on your PATH.
> The installer adds it to `C:\Program Files\PostgreSQL\<version>\bin`.
> Open a **new** terminal after installing so the PATH change takes effect.

---

### Step 1 — Clone the repository

```bash
git clone <your-repo-url>
cd quickverse-dashboard
```

---

### Step 2 — Set up the database

Run the setup script as the PostgreSQL superuser. It creates the `quickverse_user` role, the `quickverse` database, all tables, and seed data in one shot.

**Windows (PowerShell / Command Prompt):**
```powershell
psql -U postgres -f database\setup.sql
```

**Mac / Linux:**
```bash
psql -U postgres -f database/setup.sql
```

> You will be prompted for the `postgres` superuser password (the one you chose during PostgreSQL installation).
> If you see "command not found", ensure `psql` is on your PATH (see Prerequisites above).

---

### Step 3 — Configure environment variables

```bash
cp .env.example .env
```

**Windows:**
```powershell
copy .env.example .env
```

The defaults in `.env.example` already match what `setup.sql` created, so **no edits are needed** to get the app running. The only optional addition is a Google Maps API key for the Live Map page (see the comment inside `.env`).

---

### Step 4 — Install backend dependencies and start the API

```bash
cd backend
python -m venv venv
```

Activate the virtual environment:

**Windows:**
```powershell
venv\Scripts\activate
```

**Mac / Linux:**
```bash
source venv/bin/activate
```

Install dependencies and run:
```bash
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

The API is now running at `http://localhost:8000`.
You should see `Application startup complete` in the terminal.

---

### Step 5 — Install frontend dependencies and start the dev server

Open a **second terminal** (keep the backend running in the first):

```bash
cd frontend
npm install
npm run dev
```

Open your browser at `http://localhost:5173`.

---

### Step 6 — Log in and sync live data

1. On the login page, enter your phone number and complete OTP verification.
2. Go to **Orders → Sync** to pull real orders from the Quickverse API.
3. Go to **Vendors → Sync** to pull your vendor list.

The seed data loaded in Step 2 means every dashboard page shows sample data immediately — syncing replaces it with live data.

---

## Project structure

```
quickverse-dashboard/
├── backend/
│   ├── main.py           # FastAPI app — all API routes
│   ├── models.py         # SQLAlchemy ORM models
│   ├── database.py       # DB engine and session factory
│   ├── admin_deck.py     # External Quickverse API client
│   └── requirements.txt
├── database/
│   └── setup.sql         # One-shot DB + schema + seed script
├── frontend/
│   ├── src/
│   │   ├── lib/api.ts    # All backend API calls (axios)
│   │   ├── lib/store.ts  # Zustand global state
│   │   └── pages/        # One file per dashboard page
│   └── vite.config.ts    # Dev server + /api proxy to backend
├── .env.example          # Copy to .env — safe defaults included
└── .gitignore
```

---

## Environment variables reference

| Variable                   | Required | Description |
|----------------------------|----------|-------------|
| `DATABASE_URL`             | Yes      | PostgreSQL connection string |
| `ADMIN_DECK_BASE_URL`      | Yes      | Quickverse API base URL — do not change |
| `ADMIN_DECK_BASIC_AUTH`    | Yes      | Shared platform credential — do not change |
| `VITE_GOOGLE_MAPS_API_KEY` | No       | Enables the Live Map page |

---

## Common issues

**`psql: error: connection to server failed`**
PostgreSQL is not running. Start it via the Services panel (Windows) or `brew services start postgresql` (Mac).

**`ModuleNotFoundError: No module named 'psycopg2'`**
Your virtual environment is not activated. Run `venv\Scripts\activate` (Windows) or `source venv/bin/activate` (Mac/Linux) first.

**`relation "vendors" does not exist`**
The setup script did not run successfully. Repeat Step 2.

**Frontend shows blank page or network errors**
Ensure the backend (`uvicorn`) is running on port 8000 before starting the frontend. The Vite dev server proxies all `/api` requests to `localhost:8000`.
