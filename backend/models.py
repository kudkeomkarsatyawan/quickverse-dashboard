from sqlalchemy import Column, Integer, BigInteger, String, Text, Boolean, DateTime, Numeric, ForeignKey, CheckConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import func
from database import Base


class Vendor(Base):
    __tablename__ = "vendors"

    id = Column(Integer, primary_key=True)
    vendor_id = Column(String(50), unique=True, nullable=False)
    vendor_name = Column(String(255), nullable=False, default="")
    vendor_phone = Column(String(20), default="")
    vendor_logo_url = Column(Text, default="")
    store_category = Column(String(100), default="")
    custom_commission_percent = Column(Numeric(5, 2), nullable=True)
    notes = Column(Text, default="")
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class DeliveryPerson(Base):
    __tablename__ = "delivery_persons"

    id = Column(Integer, primary_key=True)
    name = Column(String(255), nullable=False)
    phone = Column(String(20), nullable=False)
    active = Column(Boolean, default=True)
    vehicle_type = Column(String(20), default="bike")
    salary_per_day_paise = Column(BigInteger, default=0)
    per_delivery_bonus_paise = Column(BigInteger, default=0)
    joining_date = Column(DateTime, server_default=func.now())
    emergency_contact = Column(String(20), default="")
    id_proof_number = Column(String(50), default="")
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class DeliveryAttendance(Base):
    __tablename__ = "delivery_attendance"

    id = Column(Integer, primary_key=True)
    delivery_person_id = Column(Integer, ForeignKey("delivery_persons.id"), nullable=False)
    attendance_date = Column(DateTime, nullable=False)
    status = Column(String(20), default="present")
    login_time = Column(DateTime, nullable=True)
    logout_time = Column(DateTime, nullable=True)
    hours_worked = Column(Numeric(4, 2), default=0)
    notes = Column(Text, default="")
    created_at = Column(DateTime, server_default=func.now())


class OrderCache(Base):
    __tablename__ = "order_cache"

    id = Column(Integer, primary_key=True)
    order_id = Column(String(100), unique=True, nullable=False)
    campus_id = Column(String(100))
    shop_id = Column(Integer)
    customer_id = Column(BigInteger)
    customer_name = Column(String(255))
    customer_mobile = Column(BigInteger)
    customer_address = Column(Text)
    state = Column(String(50))
    total_amount_paise = Column(BigInteger, default=0)
    amount_excl_delivery_paise = Column(BigInteger, default=0)
    delivery_fee_paise = Column(BigInteger, default=0)
    invoice_amount_paise = Column(BigInteger, default=0)
    payment_method = Column(String(50))
    fulfillment_option = Column(String(50))
    creation_time = Column(DateTime)
    accepted_date = Column(DateTime)
    completed_date = Column(DateTime)
    rejected_date = Column(DateTime)
    order_items = Column(JSONB, default=[])
    total_item_count = Column(Integer, default=0)
    product_count = Column(Integer, default=0)
    order_description = Column(Text, default="")
    order_link = Column(Text, default="")
    state_label = Column(Text, default="")
    delivery_person_id = Column(Integer, ForeignKey("delivery_persons.id"), nullable=True)
    synced_at = Column(DateTime, server_default=func.now())


class Settlement(Base):
    __tablename__ = "settlements"

    id = Column(Integer, primary_key=True)
    vendor_id = Column(String(50), ForeignKey("vendors.vendor_id"), nullable=False)
    period_start = Column(DateTime, nullable=False)
    period_end = Column(DateTime, nullable=False)
    total_orders = Column(Integer, default=0)
    total_gmv_paise = Column(BigInteger, default=0)
    food_value_paise = Column(BigInteger, default=0)
    commission_paise = Column(BigInteger, default=0)
    delivery_fees_paise = Column(BigInteger, default=0)
    platform_fees_paise = Column(BigInteger, default=0)
    adjustments_paise = Column(BigInteger, default=0)
    adjustment_reason = Column(Text, default="")
    net_payable_paise = Column(BigInteger, default=0)
    our_earnings_paise = Column(BigInteger, default=0)
    status = Column(String(20), default="pending")
    settled_at = Column(DateTime, nullable=True)
    settled_by = Column(String(100), nullable=True)
    notes = Column(Text, default="")
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class AppConfig(Base):
    __tablename__ = "app_config"

    id = Column(Integer, primary_key=True)
    config_key = Column(String(100), unique=True, nullable=False)
    config_value = Column(String(255), nullable=False)
    description = Column(Text, default="")
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
