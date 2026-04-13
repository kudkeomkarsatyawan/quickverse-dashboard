import os
import os
import math
from datetime import datetime, timedelta, date
from typing import Optional
from decimal import Decimal

from fastapi import FastAPI, Depends, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from sqlalchemy import func, cast, Date, extract
from pydantic import BaseModel
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))

from database import get_db, engine, Base
from models import Vendor, DeliveryPerson, DeliveryAttendance, OrderCache, Settlement, AppConfig
import admin_deck

# Create tables if they don't exist
Base.metadata.create_all(bind=engine)

# Auto-migrate: add new columns to existing tables
def run_migrations():
    from sqlalchemy import text, inspect
    with engine.connect() as conn:
        insp = inspect(engine)

        # -- delivery_persons new columns --
        existing = [c["name"] for c in insp.get_columns("delivery_persons")]
        migrations = [
            ("vehicle_type", "VARCHAR(20) DEFAULT 'bike'"),
            ("salary_per_day_paise", "BIGINT DEFAULT 0"),
            ("per_delivery_bonus_paise", "BIGINT DEFAULT 0"),
            ("joining_date", "DATE DEFAULT CURRENT_DATE"),
            ("emergency_contact", "VARCHAR(20) DEFAULT ''"),
            ("id_proof_number", "VARCHAR(50) DEFAULT ''"),
        ]
        for col, col_type in migrations:
            if col not in existing:
                conn.execute(text(f"ALTER TABLE delivery_persons ADD COLUMN {col} {col_type}"))

        # -- delivery_attendance table --
        if "delivery_attendance" not in insp.get_table_names():
            conn.execute(text("""
                CREATE TABLE delivery_attendance (
                    id SERIAL PRIMARY KEY,
                    delivery_person_id INTEGER NOT NULL REFERENCES delivery_persons(id),
                    attendance_date DATE NOT NULL DEFAULT CURRENT_DATE,
                    status VARCHAR(20) DEFAULT 'present',
                    login_time TIMESTAMP,
                    logout_time TIMESTAMP,
                    hours_worked DECIMAL(4,2) DEFAULT 0,
                    notes TEXT DEFAULT '',
                    created_at TIMESTAMP DEFAULT NOW(),
                    UNIQUE(delivery_person_id, attendance_date)
                )
            """))

        # -- indexes --
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_order_cache_delivery_person ON order_cache(delivery_person_id)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_delivery_attendance_person_date ON delivery_attendance(delivery_person_id, attendance_date)"))

        conn.commit()

try:
    run_migrations()
except Exception as e:
    print(f"Migration note: {e}")

app = FastAPI(title="Quickverse Dashboard API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def rupees_to_paise(amount: float) -> int:
    """Convert rupees (float) to paise (int) safely."""
    return int(round(amount * 100))


def paise_to_rupees(paise: int) -> float:
    """Convert paise to rupees for display."""
    return paise / 100


# ─── Pydantic Schemas ────────────────────────────────────────────────

class SendOtpReq(BaseModel):
    phone: str

class VerifyOtpReq(BaseModel):
    phone: str
    otp: str
    verificationId: str

class SyncOrdersReq(BaseModel):
    regionId: str
    sessionKey: str
    timeRange: Optional[str] = "TODAY"

class SyncVendorsReq(BaseModel):
    regionId: str

class VendorUpdateReq(BaseModel):
    custom_commission_percent: Optional[float] = None
    notes: Optional[str] = None

class CreateSettlementReq(BaseModel):
    vendor_id: str
    period_start: str  # YYYY-MM-DD
    period_end: str    # YYYY-MM-DD
    adjustments: float = 0  # in rupees
    adjustment_reason: str = ""
    notes: str = ""

class SettleReq(BaseModel):
    settled_by: str = "admin"

class UpdateSettlementReq(BaseModel):
    adjustments: Optional[float] = None
    adjustment_reason: Optional[str] = None
    notes: Optional[str] = None

class DeliveryPersonReq(BaseModel):
    name: str
    phone: str
    vehicle_type: Optional[str] = "bike"
    salary_per_day: Optional[float] = 0  # in rupees
    per_delivery_bonus: Optional[float] = 0  # in rupees
    joining_date: Optional[str] = None  # YYYY-MM-DD
    emergency_contact: Optional[str] = ""
    id_proof_number: Optional[str] = ""

class AssignDeliveryReq(BaseModel):
    delivery_person_id: int

class AttendanceReq(BaseModel):
    status: str = "present"  # present, absent, half_day
    login_time: Optional[str] = None  # ISO datetime
    logout_time: Optional[str] = None
    notes: Optional[str] = ""

class ConfigUpdateReq(BaseModel):
    value: str


# ─── Auth Routes ─────────────────────────────────────────────────────

@app.post("/api/auth/send-otp")
async def send_otp(req: SendOtpReq):
    try:
        result = await admin_deck.send_otp(req.phone)
        return result
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to send OTP: {str(e)}")


@app.post("/api/auth/verify-otp")
async def verify_otp(req: VerifyOtpReq):
    try:
        result = await admin_deck.verify_otp(req.phone, req.otp, req.verificationId)
        return result
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"OTP verification failed: {str(e)}")


@app.get("/api/auth/regions")
async def get_regions():
    try:
        regions = await admin_deck.fetch_regions()
        return {"regions": regions}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to fetch regions: {str(e)}")

@app.get("/api/pricing-configs")
async def get_pricing_configs(service_type: str = "FOOD"):
    try:
        configs = await admin_deck.fetch_pricing_configs(service_type)
        return {"configs": configs}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to fetch pricing configs: {str(e)}")


# ─── Order Routes ────────────────────────────────────────────────────

@app.post("/api/orders/sync")
async def sync_orders(req: SyncOrdersReq, db: Session = Depends(get_db)):
    """Fetch orders from admin deck and upsert into our DB."""
    try:
        orders = await admin_deck.fetch_orders(req.regionId, req.sessionKey, req.timeRange)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to fetch orders: {str(e)}")

    synced = 0
    for o in orders:
        existing = db.query(OrderCache).filter(OrderCache.order_id == str(o.get("orderId", ""))).first()

        order_data = {
            "order_id": str(o.get("orderId", "")),
            "campus_id": o.get("campusId", ""),
            "shop_id": o.get("shopId"),
            "customer_id": o.get("customerId"),
            "customer_name": o.get("customerName", ""),
            "customer_mobile": o.get("customerMobile"),
            "customer_address": o.get("customerAddress", ""),
            "state": o.get("state", ""),
            "total_amount_paise": rupees_to_paise(float(o.get("totalAmount", 0))),
            "amount_excl_delivery_paise": rupees_to_paise(float(o.get("amountExcludingDeliveryFee", 0))),
            "delivery_fee_paise": rupees_to_paise(float(o.get("deliveryFee", 0))),
            "invoice_amount_paise": rupees_to_paise(float(o.get("invoiceAmount", 0))),
            "payment_method": o.get("paymentMethod", ""),
            "fulfillment_option": o.get("fulfillmentOption", ""),
            "order_items": o.get("orderItem", []),
            "total_item_count": o.get("totalItemCount", 0),
            "product_count": o.get("productCount", 0),
            "order_description": o.get("orderDescription", ""),
            "order_link": o.get("orderLink", ""),
            "state_label": o.get("stateLabel", ""),
            "synced_at": datetime.utcnow(),
        }

        # Parse dates
        for field, key in [("creation_time", "creationTime"), ("accepted_date", "acceptedDate"),
                           ("completed_date", "completedDate"), ("rejected_date", "rejectedDate")]:
            val = o.get(key)
            if val:
                try:
                    order_data[field] = datetime.fromisoformat(val.replace("+00:00", "+00:00").replace("Z", "+00:00"))
                except (ValueError, AttributeError):
                    order_data[field] = None
            else:
                order_data[field] = None

        if existing:
            for k, v in order_data.items():
                if k != "delivery_person_id":  # Don't overwrite manual assignment
                    setattr(existing, k, v)
        else:
            db.add(OrderCache(**order_data))
        synced += 1

    db.commit()
    return {"synced": synced, "total_fetched": len(orders)}


@app.get("/api/orders")
def list_orders(
    vendor_id: Optional[int] = None,
    status: Optional[str] = None,
    payment_method: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    search: Optional[str] = None,
    page: int = 1,
    per_page: int = 50,
    db: Session = Depends(get_db),
):
    q = db.query(OrderCache).order_by(OrderCache.creation_time.desc())

    if vendor_id:
        q = q.filter(OrderCache.shop_id == vendor_id)
    if status:
        q = q.filter(OrderCache.state == status)
    if payment_method:
        q = q.filter(OrderCache.payment_method == payment_method)
    if date_from:
        q = q.filter(OrderCache.creation_time >= datetime.fromisoformat(date_from))
    if date_to:
        q = q.filter(OrderCache.creation_time <= datetime.fromisoformat(date_to) + timedelta(days=1))
    if search:
        q = q.filter(
            (OrderCache.order_id.ilike(f"%{search}%")) |
            (OrderCache.customer_name.ilike(f"%{search}%")) |
            (cast(OrderCache.customer_mobile, String).ilike(f"%{search}%"))
        )

    total = q.count()
    orders = q.offset((page - 1) * per_page).limit(per_page).all()

    result = []
    for o in orders:
        # Calculate delivery time in minutes
        delivery_mins = None
        if o.creation_time and o.completed_date:
            delivery_mins = int((o.completed_date - o.creation_time).total_seconds() / 60)

        result.append({
            "id": o.id,
            "orderId": o.order_id,
            "campusId": o.campus_id,
            "shopId": o.shop_id,
            "customerName": o.customer_name,
            "customerMobile": o.customer_mobile,
            "customerAddress": o.customer_address,
            "state": o.state,
            "totalAmount": paise_to_rupees(o.total_amount_paise),
            "amountExclDelivery": paise_to_rupees(o.amount_excl_delivery_paise),
            "deliveryFee": paise_to_rupees(o.delivery_fee_paise),
            "paymentMethod": o.payment_method,
            "fulfillmentOption": o.fulfillment_option,
            "creationTime": o.creation_time.isoformat() if o.creation_time else None,
            "acceptedDate": o.accepted_date.isoformat() if o.accepted_date else None,
            "completedDate": o.completed_date.isoformat() if o.completed_date else None,
            "rejectedDate": o.rejected_date.isoformat() if o.rejected_date else None,
            "orderItems": o.order_items or [],
            "totalItemCount": o.total_item_count,
            "orderDescription": o.order_description,
            "deliveryPersonId": o.delivery_person_id,
            "deliveryTimeMinutes": delivery_mins,
            "syncedAt": o.synced_at.isoformat() if o.synced_at else None,
        })

    return {"orders": result, "total": total, "page": page, "perPage": per_page}


@app.put("/api/orders/{order_id}/assign-delivery")
def assign_delivery(order_id: str, req: AssignDeliveryReq, db: Session = Depends(get_db)):
    order = db.query(OrderCache).filter(OrderCache.order_id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    dp = db.query(DeliveryPerson).filter(DeliveryPerson.id == req.delivery_person_id).first()
    if not dp:
        raise HTTPException(status_code=404, detail="Delivery person not found")

    order.delivery_person_id = req.delivery_person_id
    db.commit()
    return {"message": "Delivery person assigned", "orderId": order_id, "deliveryPersonId": req.delivery_person_id}


# ─── Vendor Routes ───────────────────────────────────────────────────

@app.post("/api/vendors/sync")
async def sync_vendors(req: SyncVendorsReq, db: Session = Depends(get_db)):
    """Fetch vendors from admin deck and upsert into our DB."""
    try:
        vendors = await admin_deck.fetch_vendors(req.regionId)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to fetch vendors: {str(e)}")

    synced = 0
    for v in vendors:
        # dev-keshav uses shopId/name instead of vendorId/vendorName
        vid = str(v.get("shopId", v.get("vendorId", "")))
        existing = db.query(Vendor).filter(Vendor.vendor_id == vid).first()

        vname = v.get("name", v.get("vendorName", ""))
        vphone = v.get("phone", v.get("vendorPhone", ""))
        vlogo = v.get("logo", v.get("vendorLogoUrl", ""))
        vcategory = v.get("category", v.get("storeCategory", ""))

        if existing:
            existing.vendor_name = vname or existing.vendor_name
            existing.vendor_phone = vphone or existing.vendor_phone
            existing.vendor_logo_url = vlogo or existing.vendor_logo_url
            existing.store_category = vcategory or existing.store_category
        else:
            db.add(Vendor(
                vendor_id=vid,
                vendor_name=vname,
                vendor_phone=vphone,
                vendor_logo_url=vlogo,
                store_category=vcategory,
            ))
        synced += 1

    db.commit()
    return {"synced": synced}


@app.get("/api/vendors")
def list_vendors(db: Session = Depends(get_db)):
    vendors = db.query(Vendor).order_by(Vendor.vendor_name).all()
    result = []
    for v in vendors:
        # Get order counts for this vendor
        total_orders = db.query(OrderCache).filter(OrderCache.shop_id == int(v.vendor_id)).count()
        completed_orders = db.query(OrderCache).filter(
            OrderCache.shop_id == int(v.vendor_id),
            OrderCache.state == "COMPLETED"
        ).count()

        result.append({
            "vendorId": v.vendor_id,
            "vendorName": v.vendor_name,
            "vendorPhone": v.vendor_phone,
            "vendorLogoUrl": v.vendor_logo_url,
            "storeCategory": v.store_category,
            "customCommissionPercent": float(v.custom_commission_percent) if v.custom_commission_percent else None,
            "notes": v.notes,
            "totalOrders": total_orders,
            "completedOrders": completed_orders,
        })

    return {"vendors": result}


@app.put("/api/vendors/{vendor_id}")
def update_vendor(vendor_id: str, req: VendorUpdateReq, db: Session = Depends(get_db)):
    vendor = db.query(Vendor).filter(Vendor.vendor_id == vendor_id).first()
    if not vendor:
        raise HTTPException(status_code=404, detail="Vendor not found")

    if req.custom_commission_percent is not None:
        vendor.custom_commission_percent = Decimal(str(req.custom_commission_percent))
    if req.notes is not None:
        vendor.notes = req.notes

    vendor.updated_at = datetime.utcnow()
    db.commit()
    return {"message": "Vendor updated"}


# ─── Settlement Routes ───────────────────────────────────────────────

def get_config_value(db: Session, key: str, default: str = "0") -> str:
    cfg = db.query(AppConfig).filter(AppConfig.config_key == key).first()
    return cfg.config_value if cfg else default


@app.post("/api/settlements/calculate")
def calculate_settlement(req: CreateSettlementReq, db: Session = Depends(get_db)):
    """Calculate and create a settlement for a vendor over a date range."""
    vendor = db.query(Vendor).filter(Vendor.vendor_id == req.vendor_id).first()
    if not vendor:
        raise HTTPException(status_code=404, detail="Vendor not found in DB. Sync vendors first.")

    period_start = datetime.strptime(req.period_start, "%Y-%m-%d")
    period_end = datetime.strptime(req.period_end, "%Y-%m-%d") + timedelta(days=1) - timedelta(seconds=1)

    # Get completed orders for this vendor in the date range
    orders = db.query(OrderCache).filter(
        OrderCache.shop_id == int(req.vendor_id),
        OrderCache.state == "COMPLETED",
        OrderCache.creation_time >= period_start,
        OrderCache.creation_time <= period_end,
    ).all()

    if not orders:
        raise HTTPException(status_code=400, detail="No completed orders found for this vendor in the given date range")

    # Calculate totals
    total_gmv_paise = sum(o.total_amount_paise for o in orders)
    food_value_paise = sum(o.amount_excl_delivery_paise for o in orders)
    delivery_fees_paise = sum(o.delivery_fee_paise for o in orders)

    # Commission: vendor-specific override or default
    commission_pct = float(vendor.custom_commission_percent) if vendor.custom_commission_percent else float(get_config_value(db, "default_commission_percent", "10"))
    commission_paise = int(round(food_value_paise * commission_pct / 100))

    # Platform fee per order
    platform_fee_per_order = int(get_config_value(db, "default_platform_fee_paise", "0"))
    platform_fees_paise = platform_fee_per_order * len(orders)

    # Adjustments (input in rupees, convert to paise)
    adjustments_paise = rupees_to_paise(req.adjustments)

    # Net payable to vendor = food value - commission - platform fees + adjustments
    net_payable_paise = food_value_paise - commission_paise - platform_fees_paise + adjustments_paise

    # Our earnings = commission + delivery fees + platform fees - adjustments
    our_earnings_paise = commission_paise + delivery_fees_paise + platform_fees_paise - adjustments_paise

    settlement = Settlement(
        vendor_id=req.vendor_id,
        period_start=period_start,
        period_end=period_end,
        total_orders=len(orders),
        total_gmv_paise=total_gmv_paise,
        food_value_paise=food_value_paise,
        commission_paise=commission_paise,
        delivery_fees_paise=delivery_fees_paise,
        platform_fees_paise=platform_fees_paise,
        adjustments_paise=adjustments_paise,
        adjustment_reason=req.adjustment_reason,
        net_payable_paise=net_payable_paise,
        our_earnings_paise=our_earnings_paise,
        status="pending",
        notes=req.notes,
    )

    db.add(settlement)
    db.commit()
    db.refresh(settlement)

    return _settlement_to_dict(settlement)


@app.get("/api/settlements")
def list_settlements(
    vendor_id: Optional[str] = None,
    status: Optional[str] = None,
    db: Session = Depends(get_db),
):
    q = db.query(Settlement).order_by(Settlement.created_at.desc())
    if vendor_id:
        q = q.filter(Settlement.vendor_id == vendor_id)
    if status:
        q = q.filter(Settlement.status == status)

    settlements = q.all()
    return {"settlements": [_settlement_to_dict(s) for s in settlements]}


@app.get("/api/settlements/vendor-summary")
def vendor_settlement_summary(db: Session = Depends(get_db)):
    """For each vendor: last settled date, remaining orders/amount since then."""
    vendors = db.query(Vendor).order_by(Vendor.vendor_name).all()
    default_pct = float(get_config_value(db, "default_commission_percent", "10"))
    platform_fee_per_order = int(get_config_value(db, "default_platform_fee_paise", "0"))
    result = []

    for v in vendors:
        vid = v.vendor_id

        latest_settled = db.query(Settlement).filter(
            Settlement.vendor_id == vid, Settlement.status == "settled",
        ).order_by(Settlement.period_end.desc()).first()

        cleared_till = latest_settled.period_end if latest_settled else None

        q = db.query(OrderCache).filter(
            OrderCache.shop_id == int(vid), OrderCache.state == "COMPLETED",
        )
        if cleared_till:
            q = q.filter(OrderCache.creation_time > cleared_till)

        remaining_orders = q.all()
        remaining_food_paise = sum(o.amount_excl_delivery_paise for o in remaining_orders)
        remaining_delivery_paise = sum(o.delivery_fee_paise for o in remaining_orders)
        remaining_gmv_paise = sum(o.total_amount_paise for o in remaining_orders)

        comm_pct = float(v.custom_commission_percent) if v.custom_commission_percent else default_pct
        remaining_commission_paise = int(round(remaining_food_paise * comm_pct / 100))
        remaining_platform_paise = platform_fee_per_order * len(remaining_orders)
        remaining_payable_paise = remaining_food_paise - remaining_commission_paise - remaining_platform_paise
        remaining_earnings_paise = remaining_commission_paise + remaining_delivery_paise + remaining_platform_paise

        pending_count = db.query(Settlement).filter(
            Settlement.vendor_id == vid, Settlement.status == "pending"
        ).count()

        total_settled_paise = db.query(func.coalesce(func.sum(Settlement.net_payable_paise), 0)).filter(
            Settlement.vendor_id == vid, Settlement.status == "settled"
        ).scalar()

        result.append({
            "vendorId": vid, "vendorName": v.vendor_name,
            "vendorPhone": v.vendor_phone, "vendorLogoUrl": v.vendor_logo_url,
            "commissionPercent": comm_pct,
            "customCommission": float(v.custom_commission_percent) if v.custom_commission_percent else None,
            "clearedTill": cleared_till.strftime("%Y-%m-%d") if cleared_till else None,
            "remainingOrders": len(remaining_orders),
            "remainingGmv": paise_to_rupees(remaining_gmv_paise),
            "remainingFoodValue": paise_to_rupees(remaining_food_paise),
            "remainingCommission": paise_to_rupees(remaining_commission_paise),
            "remainingDeliveryFees": paise_to_rupees(remaining_delivery_paise),
            "remainingPayable": paise_to_rupees(remaining_payable_paise),
            "remainingEarnings": paise_to_rupees(remaining_earnings_paise),
            "pendingSettlements": pending_count,
            "totalHistoricallySettled": paise_to_rupees(total_settled_paise),
            "notes": v.notes,
        })

    return {"vendors": result}


@app.put("/api/settlements/{settlement_id}/settle")
def mark_settled(settlement_id: int, req: SettleReq, db: Session = Depends(get_db)):
    s = db.query(Settlement).filter(Settlement.id == settlement_id).first()
    if not s:
        raise HTTPException(status_code=404, detail="Settlement not found")

    s.status = "settled"
    s.settled_at = datetime.utcnow()
    s.settled_by = req.settled_by
    s.updated_at = datetime.utcnow()
    db.commit()
    return _settlement_to_dict(s)


@app.put("/api/settlements/{settlement_id}")
def update_settlement(settlement_id: int, req: UpdateSettlementReq, db: Session = Depends(get_db)):
    s = db.query(Settlement).filter(Settlement.id == settlement_id).first()
    if not s:
        raise HTTPException(status_code=404, detail="Settlement not found")

    if req.adjustments is not None:
        s.adjustments_paise = rupees_to_paise(req.adjustments)
        # Recalculate
        s.net_payable_paise = s.food_value_paise - s.commission_paise - s.platform_fees_paise + s.adjustments_paise
        s.our_earnings_paise = s.commission_paise + s.delivery_fees_paise + s.platform_fees_paise - s.adjustments_paise
    if req.adjustment_reason is not None:
        s.adjustment_reason = req.adjustment_reason
    if req.notes is not None:
        s.notes = req.notes

    s.updated_at = datetime.utcnow()
    db.commit()
    return _settlement_to_dict(s)


@app.delete("/api/settlements/{settlement_id}")
def delete_settlement(settlement_id: int, db: Session = Depends(get_db)):
    s = db.query(Settlement).filter(Settlement.id == settlement_id).first()
    if not s:
        raise HTTPException(status_code=404, detail="Settlement not found")
    db.delete(s)
    db.commit()
    return {"message": "Settlement deleted"}


def _settlement_to_dict(s: Settlement) -> dict:
    return {
        "id": s.id,
        "vendorId": s.vendor_id,
        "periodStart": s.period_start.strftime("%Y-%m-%d") if s.period_start else None,
        "periodEnd": s.period_end.strftime("%Y-%m-%d") if s.period_end else None,
        "totalOrders": s.total_orders,
        "totalGmv": paise_to_rupees(s.total_gmv_paise),
        "foodValue": paise_to_rupees(s.food_value_paise),
        "commission": paise_to_rupees(s.commission_paise),
        "deliveryFees": paise_to_rupees(s.delivery_fees_paise),
        "platformFees": paise_to_rupees(s.platform_fees_paise),
        "adjustments": paise_to_rupees(s.adjustments_paise),
        "adjustmentReason": s.adjustment_reason,
        "netPayable": paise_to_rupees(s.net_payable_paise),
        "ourEarnings": paise_to_rupees(s.our_earnings_paise),
        "status": s.status,
        "settledAt": s.settled_at.isoformat() if s.settled_at else None,
        "settledBy": s.settled_by,
        "notes": s.notes,
        "createdAt": s.created_at.isoformat() if s.created_at else None,
    }


# ─── Delivery Person Routes ──────────────────────────────────────────

def _delivery_person_stats(db: Session, dp_id: int, start: datetime, end: datetime):
    """Helper: compute delivery stats for a person within a date range."""
    base_q = db.query(OrderCache).filter(
        OrderCache.delivery_person_id == dp_id,
        OrderCache.state == "COMPLETED",
        OrderCache.completed_date >= start,
        OrderCache.completed_date < end,
    )
    deliveries = base_q.count()

    # GMV handled by this person
    gmv_paise = base_q.with_entities(func.coalesce(func.sum(OrderCache.total_amount_paise), 0)).scalar()

    # Cash collected
    cash_paise = base_q.filter(OrderCache.payment_method == "CASH").with_entities(
        func.coalesce(func.sum(OrderCache.total_amount_paise), 0)
    ).scalar()

    # Delivery fees earned for the platform
    delivery_fees_paise = base_q.with_entities(
        func.coalesce(func.sum(OrderCache.delivery_fee_paise), 0)
    ).scalar()

    # Average delivery time
    timed_orders = base_q.filter(
        OrderCache.creation_time.isnot(None),
        OrderCache.completed_date.isnot(None),
    ).all()
    avg_time = None
    fastest = None
    slowest = None
    if timed_orders:
        times = [(o.completed_date - o.creation_time).total_seconds() / 60 for o in timed_orders]
        avg_time = round(sum(times) / len(times), 1)
        fastest = round(min(times), 1)
        slowest = round(max(times), 1)

    # Cancelled / rejected orders assigned to this person
    failed_orders = db.query(OrderCache).filter(
        OrderCache.delivery_person_id == dp_id,
        OrderCache.state.in_(["CANCELLED", "REJECTED"]),
        OrderCache.creation_time >= start,
        OrderCache.creation_time < end,
    ).count()

    return {
        "deliveries": deliveries,
        "gmvPaise": int(gmv_paise),
        "cashCollectedPaise": int(cash_paise),
        "deliveryFeesPaise": int(delivery_fees_paise),
        "avgDeliveryTimeMinutes": avg_time,
        "fastestDeliveryMinutes": fastest,
        "slowestDeliveryMinutes": slowest,
        "failedOrders": failed_orders,
    }


@app.get("/api/delivery-persons")
def list_delivery_persons(db: Session = Depends(get_db)):
    persons = db.query(DeliveryPerson).order_by(DeliveryPerson.active.desc(), DeliveryPerson.name).all()
    result = []
    today_start = datetime.combine(date.today(), datetime.min.time())
    today_end = today_start + timedelta(days=1)
    week_start = today_start - timedelta(days=today_start.weekday())
    month_start = today_start.replace(day=1)

    for dp in persons:
        today_stats = _delivery_person_stats(db, dp.id, today_start, today_end)
        week_stats = _delivery_person_stats(db, dp.id, week_start, today_end)
        month_stats = _delivery_person_stats(db, dp.id, month_start, today_end)

        # All-time avg delivery time
        all_timed = db.query(OrderCache).filter(
            OrderCache.delivery_person_id == dp.id,
            OrderCache.state == "COMPLETED",
            OrderCache.creation_time.isnot(None),
            OrderCache.completed_date.isnot(None),
        ).all()
        all_avg_time = None
        total_lifetime_deliveries = db.query(OrderCache).filter(
            OrderCache.delivery_person_id == dp.id,
            OrderCache.state == "COMPLETED",
        ).count()
        if all_timed:
            times = [(o.completed_date - o.creation_time).total_seconds() / 60 for o in all_timed]
            all_avg_time = round(sum(times) / len(times), 1)

        # Today's attendance
        today_attendance = db.query(DeliveryAttendance).filter(
            DeliveryAttendance.delivery_person_id == dp.id,
            DeliveryAttendance.attendance_date == date.today(),
        ).first()

        # This month's attendance count
        month_present = db.query(DeliveryAttendance).filter(
            DeliveryAttendance.delivery_person_id == dp.id,
            DeliveryAttendance.attendance_date >= month_start.date(),
            DeliveryAttendance.status.in_(["present", "half_day"]),
        ).count()

        # Earnings calculation
        salary_today = dp.salary_per_day_paise if (today_attendance and today_attendance.status in ("present", "half_day")) else 0
        bonus_today = today_stats["deliveries"] * dp.per_delivery_bonus_paise
        cost_today = salary_today + bonus_today

        result.append({
            "id": dp.id,
            "name": dp.name,
            "phone": dp.phone,
            "active": dp.active,
            "vehicleType": dp.vehicle_type,
            "salaryPerDay": paise_to_rupees(dp.salary_per_day_paise),
            "perDeliveryBonus": paise_to_rupees(dp.per_delivery_bonus_paise),
            "joiningDate": dp.joining_date.isoformat() if dp.joining_date else None,
            "emergencyContact": dp.emergency_contact,
            "idProofNumber": dp.id_proof_number,
            "todayDeliveries": today_stats["deliveries"],
            "weekDeliveries": week_stats["deliveries"],
            "monthDeliveries": month_stats["deliveries"],
            "totalDeliveries": total_lifetime_deliveries,
            "avgDeliveryTimeMinutes": all_avg_time,
            "todayStats": today_stats,
            "weekStats": week_stats,
            "monthStats": month_stats,
            "todayAttendance": today_attendance.status if today_attendance else None,
            "monthPresentDays": month_present,
            "todayCostPaise": cost_today,
            "costPerDelivery": round(paise_to_rupees(cost_today) / today_stats["deliveries"], 1) if today_stats["deliveries"] > 0 else None,
        })

    return {"deliveryPersons": result}


@app.post("/api/delivery-persons")
def create_delivery_person(req: DeliveryPersonReq, db: Session = Depends(get_db)):
    dp = DeliveryPerson(
        name=req.name,
        phone=req.phone,
        vehicle_type=req.vehicle_type or "bike",
        salary_per_day_paise=rupees_to_paise(req.salary_per_day or 0),
        per_delivery_bonus_paise=rupees_to_paise(req.per_delivery_bonus or 0),
        joining_date=datetime.strptime(req.joining_date, "%Y-%m-%d") if (req.joining_date and req.joining_date.strip()) else datetime.utcnow(),
        emergency_contact=req.emergency_contact or "",
        id_proof_number=req.id_proof_number or "",
    )
    db.add(dp)
    db.commit()
    db.refresh(dp)
    return {"id": dp.id, "name": dp.name, "phone": dp.phone, "active": dp.active}


@app.put("/api/delivery-persons/{person_id}")
def update_delivery_person(person_id: int, req: DeliveryPersonReq, db: Session = Depends(get_db)):
    dp = db.query(DeliveryPerson).filter(DeliveryPerson.id == person_id).first()
    if not dp:
        raise HTTPException(status_code=404, detail="Delivery person not found")
    dp.name = req.name
    dp.phone = req.phone
    dp.vehicle_type = req.vehicle_type or dp.vehicle_type
    dp.salary_per_day_paise = rupees_to_paise(req.salary_per_day or 0)
    dp.per_delivery_bonus_paise = rupees_to_paise(req.per_delivery_bonus or 0)
    if req.joining_date and req.joining_date.strip():
        dp.joining_date = datetime.strptime(req.joining_date, "%Y-%m-%d")
    dp.emergency_contact = req.emergency_contact or dp.emergency_contact
    dp.id_proof_number = req.id_proof_number or dp.id_proof_number
    dp.updated_at = datetime.utcnow()
    db.commit()
    return {"id": dp.id, "name": dp.name, "phone": dp.phone, "active": dp.active}


@app.delete("/api/delivery-persons/{person_id}")
def deactivate_delivery_person(person_id: int, db: Session = Depends(get_db)):
    dp = db.query(DeliveryPerson).filter(DeliveryPerson.id == person_id).first()
    if not dp:
        raise HTTPException(status_code=404, detail="Delivery person not found")
    dp.active = False
    dp.updated_at = datetime.utcnow()
    db.commit()
    return {"message": "Delivery person deactivated"}


@app.put("/api/delivery-persons/{person_id}/reactivate")
def reactivate_delivery_person(person_id: int, db: Session = Depends(get_db)):
    dp = db.query(DeliveryPerson).filter(DeliveryPerson.id == person_id).first()
    if not dp:
        raise HTTPException(status_code=404, detail="Delivery person not found")
    dp.active = True
    dp.updated_at = datetime.utcnow()
    db.commit()
    return {"message": "Delivery person reactivated"}


@app.get("/api/delivery-persons/{person_id}/history")
def delivery_person_history(
    person_id: int,
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """Paginated delivery history for a specific delivery person."""
    dp = db.query(DeliveryPerson).filter(DeliveryPerson.id == person_id).first()
    if not dp:
        raise HTTPException(status_code=404, detail="Delivery person not found")

    q = db.query(OrderCache).filter(OrderCache.delivery_person_id == person_id)

    if date_from:
        q = q.filter(OrderCache.creation_time >= datetime.strptime(date_from, "%Y-%m-%d"))
    if date_to:
        q = q.filter(OrderCache.creation_time < datetime.strptime(date_to, "%Y-%m-%d") + timedelta(days=1))

    total = q.count()
    orders = q.order_by(OrderCache.creation_time.desc()).offset((page - 1) * per_page).limit(per_page).all()

    result = []
    for o in orders:
        delivery_mins = None
        if o.creation_time and o.completed_date:
            delivery_mins = round((o.completed_date - o.creation_time).total_seconds() / 60, 1)
        result.append({
            "orderId": o.order_id,
            "customerName": o.customer_name,
            "customerAddress": o.customer_address,
            "state": o.state,
            "totalAmount": paise_to_rupees(o.total_amount_paise),
            "deliveryFee": paise_to_rupees(o.delivery_fee_paise),
            "paymentMethod": o.payment_method,
            "creationTime": o.creation_time.isoformat() if o.creation_time else None,
            "completedDate": o.completed_date.isoformat() if o.completed_date else None,
            "deliveryTimeMinutes": delivery_mins,
        })

    return {"orders": result, "total": total, "page": page, "perPage": per_page}


@app.get("/api/delivery-persons/{person_id}/earnings")
def delivery_person_earnings(
    person_id: int,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """Earnings and cost breakdown for a delivery person."""
    dp = db.query(DeliveryPerson).filter(DeliveryPerson.id == person_id).first()
    if not dp:
        raise HTTPException(status_code=404, detail="Delivery person not found")

    start = datetime.strptime(date_from, "%Y-%m-%d") if date_from else datetime.combine(date.today().replace(day=1), datetime.min.time())
    end = (datetime.strptime(date_to, "%Y-%m-%d") + timedelta(days=1)) if date_to else datetime.combine(date.today() + timedelta(days=1), datetime.min.time())

    stats = _delivery_person_stats(db, dp.id, start, end)

    # Count attendance days in range
    attendance = db.query(DeliveryAttendance).filter(
        DeliveryAttendance.delivery_person_id == dp.id,
        DeliveryAttendance.attendance_date >= start.date(),
        DeliveryAttendance.attendance_date <= end.date(),
    ).all()

    present_days = sum(1 for a in attendance if a.status == "present")
    half_days = sum(1 for a in attendance if a.status == "half_day")
    absent_days = sum(1 for a in attendance if a.status == "absent")
    total_hours = sum(float(a.hours_worked or 0) for a in attendance)

    salary_paise = (present_days * dp.salary_per_day_paise) + (half_days * dp.salary_per_day_paise // 2)
    bonus_paise = stats["deliveries"] * dp.per_delivery_bonus_paise
    total_cost_paise = salary_paise + bonus_paise

    # Daily breakdown
    daily_data = []
    current = start.date()
    end_date = (end - timedelta(days=1)).date()
    while current <= end_date:
        day_start = datetime.combine(current, datetime.min.time())
        day_end = day_start + timedelta(days=1)
        day_stats = _delivery_person_stats(db, dp.id, day_start, day_end)
        day_att = next((a for a in attendance if a.attendance_date == current), None)
        daily_data.append({
            "date": current.isoformat(),
            "deliveries": day_stats["deliveries"],
            "gmv": paise_to_rupees(day_stats["gmvPaise"]),
            "cashCollected": paise_to_rupees(day_stats["cashCollectedPaise"]),
            "attendance": day_att.status if day_att else None,
            "hoursWorked": float(day_att.hours_worked) if day_att else 0,
            "salary": paise_to_rupees(dp.salary_per_day_paise) if (day_att and day_att.status == "present") else (paise_to_rupees(dp.salary_per_day_paise // 2) if (day_att and day_att.status == "half_day") else 0),
            "bonus": paise_to_rupees(day_stats["deliveries"] * dp.per_delivery_bonus_paise),
        })
        current += timedelta(days=1)

    return {
        "personId": dp.id,
        "personName": dp.name,
        "period": {"from": start.date().isoformat(), "to": (end - timedelta(days=1)).date().isoformat()},
        "summary": {
            "totalDeliveries": stats["deliveries"],
            "totalGmv": paise_to_rupees(stats["gmvPaise"]),
            "cashCollected": paise_to_rupees(stats["cashCollectedPaise"]),
            "deliveryFeesEarned": paise_to_rupees(stats["deliveryFeesPaise"]),
            "avgDeliveryTime": stats["avgDeliveryTimeMinutes"],
            "presentDays": present_days,
            "halfDays": half_days,
            "absentDays": absent_days,
            "totalHoursWorked": round(total_hours, 1),
            "salaryPaid": paise_to_rupees(salary_paise),
            "bonusPaid": paise_to_rupees(bonus_paise),
            "totalCost": paise_to_rupees(total_cost_paise),
            "costPerDelivery": round(paise_to_rupees(total_cost_paise) / stats["deliveries"], 1) if stats["deliveries"] > 0 else None,
            "revenuePerDelivery": round(paise_to_rupees(stats["deliveryFeesPaise"]) / stats["deliveries"], 1) if stats["deliveries"] > 0 else None,
            "profitPerDelivery": round((paise_to_rupees(stats["deliveryFeesPaise"]) - paise_to_rupees(total_cost_paise)) / stats["deliveries"], 1) if stats["deliveries"] > 0 else None,
            "failedOrders": stats["failedOrders"],
        },
        "daily": daily_data,
    }


@app.get("/api/delivery-persons/leaderboard")
def delivery_leaderboard(
    period: str = Query("today"),  # today, week, month
    db: Session = Depends(get_db),
):
    """Ranked leaderboard of active delivery persons."""
    today_start = datetime.combine(date.today(), datetime.min.time())
    today_end = today_start + timedelta(days=1)
    if period == "week":
        start = today_start - timedelta(days=today_start.weekday())
    elif period == "month":
        start = today_start.replace(day=1)
    else:
        start = today_start

    active_persons = db.query(DeliveryPerson).filter(DeliveryPerson.active == True).all()
    board = []
    for dp in active_persons:
        stats = _delivery_person_stats(db, dp.id, start, today_end)
        cost_paise = (dp.salary_per_day_paise + stats["deliveries"] * dp.per_delivery_bonus_paise)
        board.append({
            "id": dp.id,
            "name": dp.name,
            "vehicleType": dp.vehicle_type,
            "deliveries": stats["deliveries"],
            "gmv": paise_to_rupees(stats["gmvPaise"]),
            "cashCollected": paise_to_rupees(stats["cashCollectedPaise"]),
            "avgTime": stats["avgDeliveryTimeMinutes"],
            "fastestTime": stats["fastestDeliveryMinutes"],
            "failedOrders": stats["failedOrders"],
            "costPerDelivery": round(paise_to_rupees(cost_paise) / stats["deliveries"], 1) if stats["deliveries"] > 0 else None,
            "successRate": round(stats["deliveries"] / (stats["deliveries"] + stats["failedOrders"]) * 100, 1) if (stats["deliveries"] + stats["failedOrders"]) > 0 else None,
        })

    board.sort(key=lambda x: x["deliveries"], reverse=True)
    for i, b in enumerate(board):
        b["rank"] = i + 1

    return {"leaderboard": board, "period": period}


# ─── Attendance Routes ───────────────────────────────────────────────

@app.post("/api/delivery-persons/{person_id}/attendance")
def mark_attendance(person_id: int, req: AttendanceReq, db: Session = Depends(get_db)):
    dp = db.query(DeliveryPerson).filter(DeliveryPerson.id == person_id).first()
    if not dp:
        raise HTTPException(status_code=404, detail="Delivery person not found")

    existing = db.query(DeliveryAttendance).filter(
        DeliveryAttendance.delivery_person_id == person_id,
        DeliveryAttendance.attendance_date == date.today(),
    ).first()

    login_dt = datetime.fromisoformat(req.login_time) if req.login_time else None
    logout_dt = datetime.fromisoformat(req.logout_time) if req.logout_time else None
    hours = 0
    if login_dt and logout_dt:
        hours = round((logout_dt - login_dt).total_seconds() / 3600, 2)

    if existing:
        existing.status = req.status
        if login_dt:
            existing.login_time = login_dt
        if logout_dt:
            existing.logout_time = logout_dt
            if existing.login_time:
                hours = round((logout_dt - existing.login_time).total_seconds() / 3600, 2)
        existing.hours_worked = hours
        existing.notes = req.notes or existing.notes
    else:
        att = DeliveryAttendance(
            delivery_person_id=person_id,
            attendance_date=date.today(),
            status=req.status,
            login_time=login_dt or datetime.utcnow(),
            logout_time=logout_dt,
            hours_worked=hours,
            notes=req.notes or "",
        )
        db.add(att)

    db.commit()
    return {"message": "Attendance marked", "date": date.today().isoformat(), "status": req.status}


@app.get("/api/delivery-persons/{person_id}/attendance")
def get_attendance(
    person_id: int,
    month: Optional[str] = None,  # YYYY-MM
    db: Session = Depends(get_db),
):
    dp = db.query(DeliveryPerson).filter(DeliveryPerson.id == person_id).first()
    if not dp:
        raise HTTPException(status_code=404, detail="Delivery person not found")

    if month:
        year, mon = map(int, month.split("-"))
        start = date(year, mon, 1)
        if mon == 12:
            end = date(year + 1, 1, 1)
        else:
            end = date(year, mon + 1, 1)
    else:
        start = date.today().replace(day=1)
        if start.month == 12:
            end = date(start.year + 1, 1, 1)
        else:
            end = date(start.year, start.month + 1, 1)

    records = db.query(DeliveryAttendance).filter(
        DeliveryAttendance.delivery_person_id == person_id,
        DeliveryAttendance.attendance_date >= start,
        DeliveryAttendance.attendance_date < end,
    ).order_by(DeliveryAttendance.attendance_date).all()

    present = sum(1 for r in records if r.status == "present")
    half = sum(1 for r in records if r.status == "half_day")
    absent = sum(1 for r in records if r.status == "absent")
    total_hours = sum(float(r.hours_worked or 0) for r in records)

    return {
        "personId": person_id,
        "month": start.strftime("%Y-%m"),
        "summary": {
            "present": present,
            "halfDay": half,
            "absent": absent,
            "totalHoursWorked": round(total_hours, 1),
        },
        "records": [{
            "date": r.attendance_date.isoformat(),
            "status": r.status,
            "loginTime": r.login_time.isoformat() if r.login_time else None,
            "logoutTime": r.logout_time.isoformat() if r.logout_time else None,
            "hoursWorked": float(r.hours_worked or 0),
            "notes": r.notes,
        } for r in records],
    }


@app.post("/api/delivery-persons/bulk-attendance")
def bulk_mark_attendance(db: Session = Depends(get_db)):
    """Mark all active delivery persons as present for today (quick check-in)."""
    active = db.query(DeliveryPerson).filter(DeliveryPerson.active == True).all()
    marked = 0
    for dp in active:
        existing = db.query(DeliveryAttendance).filter(
            DeliveryAttendance.delivery_person_id == dp.id,
            DeliveryAttendance.attendance_date == date.today(),
        ).first()
        if not existing:
            att = DeliveryAttendance(
                delivery_person_id=dp.id,
                attendance_date=date.today(),
                status="present",
                login_time=datetime.utcnow(),
            )
            db.add(att)
            marked += 1
    db.commit()
    return {"message": f"Attendance marked for {marked} persons", "markedCount": marked}


# ─── Analytics Routes ────────────────────────────────────────────────

@app.get("/api/analytics/summary")
def analytics_summary(db: Session = Depends(get_db)):
    today_start = datetime.combine(date.today(), datetime.min.time())
    week_start = today_start - timedelta(days=today_start.weekday())
    month_start = today_start.replace(day=1)

    def period_stats(start: datetime):
        orders = db.query(OrderCache).filter(OrderCache.creation_time >= start).all()
        completed = [o for o in orders if o.state == "COMPLETED"]

        total_gmv = sum(o.total_amount_paise for o in completed)
        food_value = sum(o.amount_excl_delivery_paise for o in completed)
        delivery_fees = sum(o.delivery_fee_paise for o in completed)

        default_pct = float(get_config_value(db, "default_commission_percent", "10"))
        commission = int(round(food_value * default_pct / 100))

        # Average delivery time
        avg_delivery = None
        delivery_times = []
        for o in completed:
            if o.creation_time and o.completed_date:
                mins = (o.completed_date - o.creation_time).total_seconds() / 60
                delivery_times.append(mins)
        if delivery_times:
            avg_delivery = round(sum(delivery_times) / len(delivery_times), 1)

        return {
            "totalOrders": len(orders),
            "completedOrders": len(completed),
            "totalGmv": paise_to_rupees(total_gmv),
            "ourRevenue": paise_to_rupees(commission + delivery_fees),
            "commission": paise_to_rupees(commission),
            "deliveryFees": paise_to_rupees(delivery_fees),
            "avgDeliveryTime": avg_delivery,
            "avgOrderValue": paise_to_rupees(total_gmv // len(completed)) if completed else 0,
        }

    return {
        "today": period_stats(today_start),
        "week": period_stats(week_start),
        "month": period_stats(month_start),
    }


@app.get("/api/analytics/daily-orders")
def daily_orders(days: int = 30, db: Session = Depends(get_db)):
    start = datetime.combine(date.today() - timedelta(days=days), datetime.min.time())
    orders = db.query(OrderCache).filter(OrderCache.creation_time >= start).all()

    daily = {}
    for o in orders:
        if o.creation_time:
            day_key = o.creation_time.strftime("%Y-%m-%d")
            if day_key not in daily:
                daily[day_key] = {"date": day_key, "orders": 0, "gmv": 0}
            daily[day_key]["orders"] += 1
            daily[day_key]["gmv"] += paise_to_rupees(o.total_amount_paise)

    # Fill missing days
    result = []
    for i in range(days):
        d = (date.today() - timedelta(days=days - 1 - i)).strftime("%Y-%m-%d")
        if d in daily:
            result.append(daily[d])
        else:
            result.append({"date": d, "orders": 0, "gmv": 0})

    return {"dailyOrders": result}


@app.get("/api/analytics/peak-hours")
def peak_hours(db: Session = Depends(get_db)):
    orders = db.query(OrderCache).filter(OrderCache.creation_time.isnot(None)).all()

    hourly = {h: 0 for h in range(24)}
    for o in orders:
        if o.creation_time:
            hourly[o.creation_time.hour] += 1

    return {"peakHours": [{"hour": h, "orders": c} for h, c in hourly.items()]}


@app.get("/api/analytics/vendor-ranking")
def vendor_ranking(db: Session = Depends(get_db)):
    vendors = db.query(Vendor).all()
    result = []

    for v in vendors:
        completed_orders = db.query(OrderCache).filter(
            OrderCache.shop_id == int(v.vendor_id),
            OrderCache.state == "COMPLETED",
        ).all()

        total_gmv = sum(o.total_amount_paise for o in completed_orders)
        food_value = sum(o.amount_excl_delivery_paise for o in completed_orders)
        aov = total_gmv // len(completed_orders) if completed_orders else 0

        result.append({
            "vendorId": v.vendor_id,
            "vendorName": v.vendor_name,
            "totalOrders": len(completed_orders),
            "totalGmv": paise_to_rupees(total_gmv),
            "foodValue": paise_to_rupees(food_value),
            "avgOrderValue": paise_to_rupees(aov),
        })

    result.sort(key=lambda x: x["totalOrders"], reverse=True)
    return {"vendorRanking": result}


@app.get("/api/analytics/payment-split")
def payment_split(db: Session = Depends(get_db)):
    orders = db.query(OrderCache).filter(OrderCache.state == "COMPLETED").all()

    cod_count = 0
    cod_amount = 0
    prepaid_count = 0
    prepaid_amount = 0

    for o in orders:
        if o.payment_method == "COD":
            cod_count += 1
            cod_amount += o.total_amount_paise
        else:
            prepaid_count += 1
            prepaid_amount += o.total_amount_paise

    return {
        "cash": {"count": cod_count, "amount": paise_to_rupees(cod_amount)},
        "prepaid": {"count": prepaid_count, "amount": paise_to_rupees(prepaid_amount)},
        "total": {"count": cod_count + prepaid_count, "amount": paise_to_rupees(cod_amount + prepaid_amount)},
    }


# ─── Config Routes ───────────────────────────────────────────────────

@app.get("/api/config")
def get_config(db: Session = Depends(get_db)):
    configs = db.query(AppConfig).all()
    return {"config": {c.config_key: {"value": c.config_value, "description": c.description} for c in configs}}


@app.put("/api/config/{key}")
def update_config(key: str, req: ConfigUpdateReq, db: Session = Depends(get_db)):
    cfg = db.query(AppConfig).filter(AppConfig.config_key == key).first()
    if not cfg:
        raise HTTPException(status_code=404, detail="Config key not found")
    cfg.config_value = req.value
    cfg.updated_at = datetime.utcnow()
    db.commit()
    return {"key": key, "value": req.value}


# ─── Health Check ─────────────────────────────────────────────────────

@app.get("/api/health")
def health():
    return {"status": "ok", "timestamp": datetime.utcnow().isoformat()}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
