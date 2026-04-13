-- Quickverse Dashboard - Database Initialization
-- Run: psql -U postgres -f init_db.sql

CREATE DATABASE quickverse;

\c quickverse;

-- Vendors (synced from admin deck + our custom fields)
CREATE TABLE vendors (
    id SERIAL PRIMARY KEY,
    vendor_id VARCHAR(50) UNIQUE NOT NULL,
    vendor_name VARCHAR(255) NOT NULL DEFAULT '',
    vendor_phone VARCHAR(20) DEFAULT '',
    vendor_logo_url TEXT DEFAULT '',
    store_category VARCHAR(100) DEFAULT '',
    custom_commission_percent DECIMAL(5,2),
    notes TEXT DEFAULT '',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Delivery persons (manually managed)
CREATE TABLE delivery_persons (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(20) NOT NULL,
    active BOOLEAN DEFAULT TRUE,
    vehicle_type VARCHAR(20) DEFAULT 'bike' CHECK (vehicle_type IN ('bike', 'cycle', 'walk', 'ev')),
    salary_per_day_paise BIGINT DEFAULT 0,
    per_delivery_bonus_paise BIGINT DEFAULT 0,
    joining_date DATE DEFAULT CURRENT_DATE,
    emergency_contact VARCHAR(20) DEFAULT '',
    id_proof_number VARCHAR(50) DEFAULT '',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Delivery attendance (daily check-in/out tracking)
CREATE TABLE delivery_attendance (
    id SERIAL PRIMARY KEY,
    delivery_person_id INTEGER NOT NULL REFERENCES delivery_persons(id),
    attendance_date DATE NOT NULL DEFAULT CURRENT_DATE,
    status VARCHAR(20) DEFAULT 'present' CHECK (status IN ('present', 'absent', 'half_day')),
    login_time TIMESTAMP,
    logout_time TIMESTAMP,
    hours_worked DECIMAL(4,2) DEFAULT 0,
    notes TEXT DEFAULT '',
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(delivery_person_id, attendance_date)
);

-- Order cache (synced from admin deck)
CREATE TABLE order_cache (
    id SERIAL PRIMARY KEY,
    order_id VARCHAR(100) UNIQUE NOT NULL,
    campus_id VARCHAR(100),
    shop_id INTEGER,
    customer_id BIGINT,
    customer_name VARCHAR(255),
    customer_mobile BIGINT,
    customer_address TEXT,
    state VARCHAR(50),
    total_amount_paise BIGINT DEFAULT 0,
    amount_excl_delivery_paise BIGINT DEFAULT 0,
    delivery_fee_paise BIGINT DEFAULT 0,
    invoice_amount_paise BIGINT DEFAULT 0,
    payment_method VARCHAR(50),
    fulfillment_option VARCHAR(50),
    creation_time TIMESTAMP,
    accepted_date TIMESTAMP,
    completed_date TIMESTAMP,
    rejected_date TIMESTAMP,
    order_items JSONB DEFAULT '[]',
    total_item_count INTEGER DEFAULT 0,
    product_count INTEGER DEFAULT 0,
    order_description TEXT DEFAULT '',
    order_link TEXT DEFAULT '',
    state_label TEXT DEFAULT '',
    delivery_person_id INTEGER REFERENCES delivery_persons(id),
    synced_at TIMESTAMP DEFAULT NOW()
);

-- Settlements
CREATE TABLE settlements (
    id SERIAL PRIMARY KEY,
    vendor_id VARCHAR(50) NOT NULL REFERENCES vendors(vendor_id),
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    total_orders INTEGER DEFAULT 0,
    total_gmv_paise BIGINT DEFAULT 0,
    food_value_paise BIGINT DEFAULT 0,
    commission_paise BIGINT DEFAULT 0,
    delivery_fees_paise BIGINT DEFAULT 0,
    platform_fees_paise BIGINT DEFAULT 0,
    adjustments_paise BIGINT DEFAULT 0,
    adjustment_reason TEXT DEFAULT '',
    net_payable_paise BIGINT DEFAULT 0,
    our_earnings_paise BIGINT DEFAULT 0,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'settled')),
    settled_at TIMESTAMP,
    settled_by VARCHAR(100),
    notes TEXT DEFAULT '',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- App config (key-value store)
CREATE TABLE app_config (
    id SERIAL PRIMARY KEY,
    config_key VARCHAR(100) UNIQUE NOT NULL,
    config_value VARCHAR(255) NOT NULL,
    description TEXT DEFAULT '',
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Default config
INSERT INTO app_config (config_key, config_value, description) VALUES
    ('default_commission_percent', '10', 'Default commission % for vendors'),
    ('default_delivery_fee_paise', '2000', 'Default delivery fee in paise (Rs 20)'),
    ('default_platform_fee_paise', '0', 'Platform fee in paise (Rs 0 for now)');

-- Indexes
CREATE INDEX idx_order_cache_shop_id ON order_cache(shop_id);
CREATE INDEX idx_order_cache_state ON order_cache(state);
CREATE INDEX idx_order_cache_creation_time ON order_cache(creation_time);
CREATE INDEX idx_order_cache_payment_method ON order_cache(payment_method);
CREATE INDEX idx_order_cache_delivery_person ON order_cache(delivery_person_id);
CREATE INDEX idx_settlements_vendor_id ON settlements(vendor_id);
CREATE INDEX idx_settlements_status ON settlements(status);
CREATE INDEX idx_settlements_period ON settlements(period_start, period_end);
CREATE INDEX idx_delivery_attendance_person_date ON delivery_attendance(delivery_person_id, attendance_date);
CREATE INDEX idx_delivery_attendance_date ON delivery_attendance(attendance_date);
