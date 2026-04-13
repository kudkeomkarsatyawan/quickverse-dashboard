# Quickverse Dashboard

Internal operations dashboard for **Quickverse** — a hyperlocal delivery platform. Manages orders, vendors, settlements, delivery personnel, and real-time analytics, all synced from the Quickverse Admin Deck API.

---

## Tech Stack

| Layer        | Technology                                                                 |
| ------------ | -------------------------------------------------------------------------- |
| **Frontend** | React 18 · TypeScript · Vite 5 · Tailwind CSS 3 · Zustand · Recharts      |
| **Backend**  | Python 3.10+ · FastAPI · SQLAlchemy 2 · Pydantic 2 · Uvicorn              |
| **Database** | PostgreSQL 14+                                                             |
| **HTTP**     | Axios (frontend) · httpx (backend, for Admin Deck API calls)               |
| **Routing**  | React Router v6                                                            |

---

## Features

- **OTP Authentication** — Phone-based login via Quickverse Admin Deck API.
- **Order Management** — Sync, search, filter, and paginate orders. Assign delivery persons to orders.
- **Vendor Management** — Sync vendors from Admin Deck. Custom commission rates and notes per vendor.
- **Settlement Engine** — Auto-calculate vendor settlements (commission, platform fees, delivery fees, adjustments). Mark as settled, edit, or delete.
- **Delivery Personnel** — Full CRUD for delivery staff. Track vehicle type, salary, per-delivery bonus, attendance, and performance stats (avg delivery time, cash collected, GMV handled).
- **Analytics Dashboard** — Revenue trends, order volume, payment method breakdown, delivery performance charts (powered by Recharts).

---

## Project Structure

```
quickverse-dashboard/
├── backend/
│   ├── main.py              # FastAPI app — all API routes
│   ├── models.py            # SQLAlchemy ORM models
│   ├── database.py          # DB engine & session factory
│   ├── admin_deck.py        # Quickverse Admin Deck API client
│   └── requirements.txt     # Python dependencies
├── frontend/
│   ├── src/
│   │   ├── pages/           # Route-level page components
│   │   │   ├── LoginPage.tsx
│   │   │   ├── OrdersPage.tsx
│   │   │   ├── SettlementPage.tsx
│   │   │   ├── DeliveryPage.tsx
│   │   │   └── AnalyticsPage.tsx
│   │   ├── components/      # Shared UI components
│   │   ├── lib/             # Utilities, API client, store
│   │   ├── App.tsx          # Root component with routing
│   │   ├── main.tsx         # Entry point
│   │   └── index.css        # Global styles + Tailwind directives
│   ├── package.json
│   ├── vite.config.ts
│   ├── tailwind.config.js
│   └── tsconfig.json
├── init_db.sql              # Full database schema (tables + indexes)
├── .env.example             # Environment variable template
└── README.md
```

---

## Prerequisites

Make sure you have the following installed:

| Tool           | Version   | Download                                        |
| -------------- | --------- | ----------------------------------------------- |
| **Node.js**    | 18+       | https://nodejs.org/                              |
| **Python**     | 3.10+     | https://www.python.org/downloads/                |
| **PostgreSQL** | 14+       | https://www.postgresql.org/download/             |
| **Git**        | any       | https://git-scm.com/downloads                    |

---

## Setup Instructions

### 1. Clone the Repository

```bash
git clone https://github.com/<your-username>/quickverse-dashboard.git
cd quickverse-dashboard
```

### 2. Set Up the Database

Open a terminal and run the PostgreSQL initialization script:

```bash
psql -U postgres -f init_db.sql
```

> This creates the `quickverse` database with all required tables and indexes.
>
> If you already have a `quickverse` database, drop it first:
> ```bash
> psql -U postgres -c "DROP DATABASE IF EXISTS quickverse;"
> psql -U postgres -f init_db.sql
> ```

### 3. Configure Environment Variables

Copy the example env file and update it with your credentials:

```bash
cp .env.example .env
```

Edit `.env`:

```env
DATABASE_URL=postgresql://<db_user>:<db_password>@localhost:5432/quickverse
ADMIN_DECK_BASE_URL=http://prd.quickverse.in/quickVerse
```

Replace `<db_user>` and `<db_password>` with your PostgreSQL username and password.

### 4. Set Up the Backend

```bash
cd backend

# Create a virtual environment (recommended)
python -m venv venv

# Activate it
# Windows:
venv\Scripts\activate
# macOS / Linux:
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Start the API server
uvicorn main:app --reload --port 8000
```

The API will be live at **http://localhost:8000**.  
Swagger docs available at **http://localhost:8000/docs**.

### 5. Set Up the Frontend

Open a **new terminal**:

```bash
cd frontend

# Install dependencies
npm install

# Start the dev server
npm run dev
```

The app will be live at **http://localhost:5173**.

> Vite is pre-configured to proxy `/api/*` requests to the backend at `localhost:8000`.

---

## Running Both Together (Quick Start)

You need **two terminals** running simultaneously:

| Terminal 1 (Backend)                              | Terminal 2 (Frontend)       |
| ------------------------------------------------- | --------------------------- |
| `cd backend`                                      | `cd frontend`               |
| `python -m venv venv && venv\Scripts\activate`    | `npm install`               |
| `pip install -r requirements.txt`                 | `npm run dev`               |
| `uvicorn main:app --reload --port 8000`           |                             |

Then open **http://localhost:5173** in your browser.

---

## API Overview

Base URL: `http://localhost:8000`

| Method   | Endpoint                              | Description                          |
| -------- | ------------------------------------- | ------------------------------------ |
| `POST`   | `/api/auth/send-otp`                  | Send OTP to phone number             |
| `POST`   | `/api/auth/verify-otp`                | Verify OTP                           |
| `GET`    | `/api/auth/regions`                   | List available regions               |
| `POST`   | `/api/orders/sync`                    | Sync orders from Admin Deck          |
| `GET`    | `/api/orders`                         | List orders (filterable, paginated)  |
| `PUT`    | `/api/orders/{id}/assign-delivery`    | Assign delivery person to order      |
| `POST`   | `/api/vendors/sync`                   | Sync vendors from Admin Deck         |
| `GET`    | `/api/vendors`                        | List all vendors                     |
| `PUT`    | `/api/vendors/{id}`                   | Update vendor commission/notes       |
| `POST`   | `/api/settlements/calculate`          | Calculate & create a settlement      |
| `GET`    | `/api/settlements`                    | List settlements                     |
| `GET`    | `/api/settlements/vendor-summary`     | Per-vendor settlement summary        |
| `PUT`    | `/api/settlements/{id}/settle`        | Mark settlement as settled           |
| `DELETE` | `/api/settlements/{id}`               | Delete a settlement                  |
| `GET`    | `/api/delivery-persons`               | List delivery personnel + stats      |
| `POST`   | `/api/delivery-persons`               | Add a delivery person                |
| `PUT`    | `/api/delivery-persons/{id}`          | Update a delivery person             |
| `GET`    | `/api/pricing-configs`                | Fetch pricing configurations         |

Full interactive docs: **http://localhost:8000/docs**

---

## Database Schema

The app uses **6 tables** — see [`init_db.sql`](init_db.sql) for the full schema:

- `vendors` — Vendor profiles (synced + custom fields)
- `delivery_persons` — Delivery staff records
- `delivery_attendance` — Daily attendance tracking
- `order_cache` — Orders synced from Admin Deck
- `settlements` — Vendor settlement records
- `app_config` — Key-value configuration store

---

## Build for Production

```bash
# Frontend
cd frontend
npm run build
# Output: frontend/dist/

# Backend
# Serve with Gunicorn (Linux) or Uvicorn (any OS)
uvicorn main:app --host 0.0.0.0 --port 8000
```

---

## Troubleshooting

| Issue                                  | Solution                                                                 |
| -------------------------------------- | ------------------------------------------------------------------------ |
| `psql: command not found`              | Add PostgreSQL `bin/` to your system PATH                                |
| `FATAL: password authentication failed`| Check your PostgreSQL username/password in `.env`                        |
| `Module not found` (Python)            | Ensure virtual environment is activated before `pip install`             |
| Frontend can't reach API               | Confirm backend is running on port 8000; check `vite.config.ts` proxy   |
| `npm install` fails                    | Delete `node_modules/` and `package-lock.json`, then retry               |

---

## License

Private — Internal use only.
