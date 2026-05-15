-- Quickverse Dashboard – One-shot PostgreSQL Setup
-- Run this as the postgres superuser ONCE on a fresh machine:
--
--   Windows PowerShell:
--     psql -U postgres -f database\setup.sql
--
--   Mac / Linux:
--     psql -U postgres -f database/setup.sql
--
-- This script is idempotent: safe to run multiple times.

-- ─── 1. Create user & database ───────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'quickverse_user') THEN
    CREATE ROLE quickverse_user WITH LOGIN PASSWORD 'quickverse_pass';
  END IF;
END
$$;

SELECT 'CREATE DATABASE quickverse OWNER quickverse_user'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'quickverse')\gexec

-- ─── 2. Connect to the new database ─────────────────────────────────────────

\c quickverse

-- Grant all privileges on the database
GRANT ALL PRIVILEGES ON DATABASE quickverse TO quickverse_user;
GRANT ALL ON SCHEMA public TO quickverse_user;

-- ─── 3. Schema ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS vendors (
    id                        SERIAL PRIMARY KEY,
    vendor_id                 VARCHAR(50)      UNIQUE NOT NULL,
    vendor_name               VARCHAR(255)     NOT NULL DEFAULT '',
    vendor_phone              VARCHAR(20)      DEFAULT '',
    vendor_logo_url           TEXT             DEFAULT '',
    store_category            VARCHAR(100)     DEFAULT '',
    custom_commission_percent NUMERIC(5, 2),
    notes                     TEXT             DEFAULT '',
    latitude                  DOUBLE PRECISION,
    longitude                 DOUBLE PRECISION,
    created_at                TIMESTAMP        DEFAULT NOW(),
    updated_at                TIMESTAMP        DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS delivery_persons (
    id                       SERIAL PRIMARY KEY,
    name                     VARCHAR(255) NOT NULL,
    phone                    VARCHAR(20)  NOT NULL,
    active                   BOOLEAN      DEFAULT TRUE,
    vehicle_type             VARCHAR(20)  DEFAULT 'bike',
    salary_per_day_paise     BIGINT       DEFAULT 0,
    per_delivery_bonus_paise BIGINT       DEFAULT 0,
    joining_date             TIMESTAMP    DEFAULT NOW(),
    emergency_contact        VARCHAR(20)  DEFAULT '',
    id_proof_number          VARCHAR(50)  DEFAULT '',
    created_at               TIMESTAMP    DEFAULT NOW(),
    updated_at               TIMESTAMP    DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS delivery_attendance (
    id                 SERIAL PRIMARY KEY,
    delivery_person_id INTEGER      NOT NULL REFERENCES delivery_persons(id),
    attendance_date    TIMESTAMP    NOT NULL DEFAULT NOW(),
    status             VARCHAR(20)  DEFAULT 'present',
    login_time         TIMESTAMP,
    logout_time        TIMESTAMP,
    hours_worked       DECIMAL(4,2) DEFAULT 0,
    notes              TEXT         DEFAULT '',
    created_at         TIMESTAMP    DEFAULT NOW(),
    UNIQUE(delivery_person_id, attendance_date)
);

CREATE TABLE IF NOT EXISTS order_cache (
    id                         SERIAL PRIMARY KEY,
    order_id                   VARCHAR(100) UNIQUE NOT NULL,
    campus_id                  VARCHAR(100),
    shop_id                    INTEGER,
    customer_id                BIGINT,
    customer_name              VARCHAR(255),
    customer_mobile            BIGINT,
    customer_address           TEXT,
    state                      VARCHAR(50),
    total_amount_paise         BIGINT   DEFAULT 0,
    amount_excl_delivery_paise BIGINT   DEFAULT 0,
    delivery_fee_paise         BIGINT   DEFAULT 0,
    invoice_amount_paise       BIGINT   DEFAULT 0,
    payment_method             VARCHAR(50),
    fulfillment_option         VARCHAR(50),
    creation_time              TIMESTAMP,
    accepted_date              TIMESTAMP,
    completed_date             TIMESTAMP,
    rejected_date              TIMESTAMP,
    order_items                JSONB    DEFAULT '[]',
    total_item_count           INTEGER  DEFAULT 0,
    product_count              INTEGER  DEFAULT 0,
    order_description          TEXT     DEFAULT '',
    order_link                 TEXT     DEFAULT '',
    state_label                TEXT     DEFAULT '',
    delivery_person_id         INTEGER  REFERENCES delivery_persons(id),
    synced_at                  TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS settlements (
    id                  SERIAL PRIMARY KEY,
    vendor_id           VARCHAR(50) NOT NULL REFERENCES vendors(vendor_id),
    period_start        TIMESTAMP   NOT NULL,
    period_end          TIMESTAMP   NOT NULL,
    total_orders        INTEGER     DEFAULT 0,
    total_gmv_paise     BIGINT      DEFAULT 0,
    food_value_paise    BIGINT      DEFAULT 0,
    commission_paise    BIGINT      DEFAULT 0,
    delivery_fees_paise BIGINT      DEFAULT 0,
    platform_fees_paise BIGINT      DEFAULT 0,
    adjustments_paise   BIGINT      DEFAULT 0,
    adjustment_reason   TEXT        DEFAULT '',
    net_payable_paise   BIGINT      DEFAULT 0,
    our_earnings_paise  BIGINT      DEFAULT 0,
    status              VARCHAR(20) DEFAULT 'pending',
    settled_at          TIMESTAMP,
    settled_by          VARCHAR(100),
    notes               TEXT        DEFAULT '',
    created_at          TIMESTAMP   DEFAULT NOW(),
    updated_at          TIMESTAMP   DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_config (
    id           SERIAL PRIMARY KEY,
    config_key   VARCHAR(100) UNIQUE NOT NULL,
    config_value VARCHAR(255) NOT NULL,
    description  TEXT         DEFAULT '',
    updated_at   TIMESTAMP    DEFAULT NOW()
);

-- ─── 4. Indexes ──────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_order_cache_delivery_person
    ON order_cache(delivery_person_id);

CREATE INDEX IF NOT EXISTS idx_delivery_attendance_person_date
    ON delivery_attendance(delivery_person_id, attendance_date);

-- ─── 5. Grant table-level access to app user ─────────────────────────────────

GRANT ALL PRIVILEGES ON ALL TABLES    IN SCHEMA public TO quickverse_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO quickverse_user;

-- ─── 6. Seed Data ────────────────────────────────────────────────────────────
-- Provides enough data for every dashboard page to render non-empty on first boot.
-- Sync vendors/orders via the UI after logging in to replace these with live data.

INSERT INTO vendors (vendor_id, vendor_name, vendor_phone, store_category, latitude, longitude) VALUES
  ('1001', 'Campus Canteen',      '9876543210', 'FOOD',    19.8762, 75.3433),
  ('1002', 'Quick Grocery Store', '9876543211', 'GROCERY', 19.8765, 75.3440),
  ('1003', 'Pizza Palace',        '9876543212', 'FOOD',    19.8770, 75.3450),
  ('1004', 'Fresh Mart',          '9876543213', 'GROCERY', 19.8755, 75.3420)
ON CONFLICT (vendor_id) DO NOTHING;

INSERT INTO delivery_persons (name, phone, active, vehicle_type, salary_per_day_paise, per_delivery_bonus_paise, joining_date) VALUES
  ('Rahul Sharma', '9000001111', TRUE, 'bike',    50000, 500, NOW() - INTERVAL '30 days'),
  ('Suresh Kumar', '9000002222', TRUE, 'bike',    45000, 500, NOW() - INTERVAL '20 days'),
  ('Amit Singh',   '9000003333', TRUE, 'scooter', 55000, 750, NOW() - INTERVAL '15 days')
ON CONFLICT DO NOTHING;

-- Amounts in paise (1 Rs = 100 paise). Mix of COMPLETED, CANCELLED, PENDING.
INSERT INTO order_cache (
    order_id, campus_id, shop_id,
    customer_name, customer_mobile, customer_address,
    state,
    total_amount_paise, amount_excl_delivery_paise, delivery_fee_paise,
    payment_method, fulfillment_option,
    creation_time, accepted_date, completed_date,
    order_items, total_item_count, synced_at
) VALUES
  ('DEMO-001', 'campus-1', 1001,
   'Alice Johnson', 9111111111,
   '{name=Alice, addressLine1=Block A Room 101, latitude=19.8760, longitude=75.3430}',
   'COMPLETED', 32000, 30000, 2000, 'ONLINE', 'DELIVERY',
   NOW() - INTERVAL '2 days' + INTERVAL '10 hours',
   NOW() - INTERVAL '2 days' + INTERVAL '10 hours 5 minutes',
   NOW() - INTERVAL '2 days' + INTERVAL '10 hours 35 minutes',
   '[{"name": "Veg Thali", "quantity": 1, "price": 300}]', 1, NOW()),

  ('DEMO-002', 'campus-1', 1001,
   'Bob Mehta', 9222222222,
   '{name=Bob, addressLine1=Block B Room 205, latitude=19.8765, longitude=75.3445}',
   'COMPLETED', 47000, 45000, 2000, 'CASH', 'DELIVERY',
   NOW() - INTERVAL '2 days' + INTERVAL '12 hours',
   NOW() - INTERVAL '2 days' + INTERVAL '12 hours 3 minutes',
   NOW() - INTERVAL '2 days' + INTERVAL '12 hours 28 minutes',
   '[{"name": "Chicken Biryani", "quantity": 1, "price": 450}]', 1, NOW()),

  ('DEMO-003', 'campus-1', 1002,
   'Carol Patel', 9333333333,
   '{name=Carol, addressLine1=Block C Room 310, latitude=19.8770, longitude=75.3450}',
   'COMPLETED', 27000, 25000, 2000, 'ONLINE', 'DELIVERY',
   NOW() - INTERVAL '1 day' + INTERVAL '9 hours',
   NOW() - INTERVAL '1 day' + INTERVAL '9 hours 4 minutes',
   NOW() - INTERVAL '1 day' + INTERVAL '9 hours 40 minutes',
   '[{"name": "Bread", "quantity": 2, "price": 50}, {"name": "Eggs 12pcs", "quantity": 1, "price": 90}]', 3, NOW()),

  ('DEMO-004', 'campus-1', 1003,
   'David Kumar', 9444444444,
   '{name=David, addressLine1=Block D Room 401, latitude=19.8775, longitude=75.3460}',
   'COMPLETED', 44000, 42000, 2000, 'CASH', 'DELIVERY',
   NOW() - INTERVAL '1 day' + INTERVAL '19 hours',
   NOW() - INTERVAL '1 day' + INTERVAL '19 hours 6 minutes',
   NOW() - INTERVAL '1 day' + INTERVAL '19 hours 45 minutes',
   '[{"name": "Margherita Pizza", "quantity": 1, "price": 420}]', 1, NOW()),

  ('DEMO-005', 'campus-1', 1001,
   'Eva Sharma', 9555555555,
   '{name=Eva, addressLine1=Block E Room 502, latitude=19.8778, longitude=75.3435}',
   'COMPLETED', 20000, 18000, 2000, 'ONLINE', 'DELIVERY',
   NOW() - INTERVAL '4 hours',
   NOW() - INTERVAL '4 hours' + INTERVAL '4 minutes',
   NOW() - INTERVAL '4 hours' + INTERVAL '32 minutes',
   '[{"name": "Samosa", "quantity": 4, "price": 40}]', 4, NOW()),

  ('DEMO-006', 'campus-1', 1002,
   'Frank Singh', 9666666666,
   '{name=Frank, addressLine1=Block F Room 601, latitude=19.8780, longitude=75.3442}',
   'COMPLETED', 62000, 60000, 2000, 'ONLINE', 'DELIVERY',
   NOW() - INTERVAL '5 hours',
   NOW() - INTERVAL '5 hours' + INTERVAL '5 minutes',
   NOW() - INTERVAL '5 hours' + INTERVAL '38 minutes',
   '[{"name": "Rice 5kg", "quantity": 1, "price": 350}, {"name": "Lentils 1kg", "quantity": 2, "price": 120}]', 3, NOW()),

  ('DEMO-007', 'campus-1', 1001,
   'Grace Iyer', 9777777777,
   '{name=Grace, addressLine1=Block G Room 702, latitude=19.8769, longitude=75.3432}',
   'CANCELLED', 35000, 33000, 2000, 'ONLINE', 'DELIVERY',
   NOW() - INTERVAL '6 hours',
   NULL, NULL, '[]', 1, NOW()),

  ('DEMO-008', 'campus-1', 1003,
   'Henry Reddy', 9888888888,
   '{name=Henry, addressLine1=Block H Room 801, latitude=19.8762, longitude=75.3448}',
   'PENDING', 50000, 48000, 2000, 'CASH', 'DELIVERY',
   NOW() - INTERVAL '25 minutes',
   NULL, NULL,
   '[{"name": "Farm Pizza", "quantity": 1, "price": 480}]', 1, NOW())
ON CONFLICT (order_id) DO NOTHING;

-- Assign delivery persons to completed orders
UPDATE order_cache SET delivery_person_id = 1 WHERE order_id IN ('DEMO-001', 'DEMO-005');
UPDATE order_cache SET delivery_person_id = 2 WHERE order_id IN ('DEMO-002', 'DEMO-006');
UPDATE order_cache SET delivery_person_id = 3 WHERE order_id IN ('DEMO-003', 'DEMO-004');

-- App config defaults
INSERT INTO app_config (config_key, config_value, description) VALUES
  ('default_region_id',      '',   'Default region ID for auto-sync (fill in after first login)'),
  ('sync_interval_minutes',  '15', 'How often orders auto-sync, in minutes'),
  ('max_delivery_radius_km', '5',  'Maximum delivery radius shown on the live map')
ON CONFLICT (config_key) DO NOTHING;
