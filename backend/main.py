import os
import math
import asyncio
from datetime import datetime, timedelta, date
from typing import Optional
from decimal import Decimal

from fastapi import FastAPI, Depends, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from sqlalchemy import func, cast, Date, extract, String
from pydantic import BaseModel
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))

from database import get_db, engine, Base
from models import Vendor, DeliveryPerson, DeliveryAttendance, OrderCache, Settlement, AppConfig
import admin_deck

Base.metadata.create_all(bind=engine)


def run_migrations():
    from sqlalchemy import text, inspect
    with engine.connect() as conn:
        insp = inspect(engine)

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

        vendor_existing = [c["name"] for c in insp.get_columns("vendors")]
        vendor_migrations = [
            ("latitude",  "DOUBLE PRECISION DEFAULT NULL"),
            ("longitude", "DOUBLE PRECISION DEFAULT NULL"),
        ]
        for col, col_type in vendor_migrations:
            if col not in vendor_existing:
                conn.execute(text(f"ALTER TABLE vendors ADD COLUMN {col} {col_type}"))

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


# ─── Unit helpers ────────────────────────────────────────────────────

def rupees_to_paise(amount: float) -> int:
    return int(round(amount * 100))


def paise_to_rupees(paise: int) -> float:
    return paise / 100


def _safe_float(val, default: float = 0.0) -> float:
    """Convert val to float, returning default for None / non-numeric values.

    dict.get(key, default) only uses the default when the key is ABSENT.
    If the API sends ``"totalAmount": null`` the key exists and val is None,
    so a bare float() call raises TypeError and aborts the whole sync batch.
    This helper makes every amount field safe.
    """
    if val is None:
        return default
    try:
        return float(val)
    except (TypeError, ValueError):
        return default


# ─── Pricing config helpers ──────────────────────────────────────────

FOOD_DEFAULTS    = {'DELIVERY_CHARGE': 20.0, 'PLATFORM_FEE': 5.0, 'COMMISSION': 10.0, 'SERVICE_TAX': 18.0}
GROCERY_DEFAULTS = {'DELIVERY_CHARGE': 17.0, 'PLATFORM_FEE': 3.0, 'COMMISSION':  2.0, 'SERVICE_TAX': 18.0}


async def get_pricing_lookup():
    """Fetch live pricing configs; return a cfg(is_grocery, key) → float function."""
    try:
        food_list    = await admin_deck.fetch_pricing_configs('FOOD')
        grocery_list = await admin_deck.fetch_pricing_configs('GROCERY')
    except Exception:
        food_list, grocery_list = [], []

    def _parse(lst):
        return {c.get('configKey', ''): float(c.get('actualValue', 0))
                for c in lst if c.get('isActive', True)}

    food_cfg    = _parse(food_list)
    grocery_cfg = _parse(grocery_list)

    def cfg(is_grocery: bool, key: str) -> float:
        source  = grocery_cfg if is_grocery else food_cfg
        default = GROCERY_DEFAULTS if is_grocery else FOOD_DEFAULTS
        return source.get(key, default.get(key, 0.0))

    return cfg


def calc_order_amounts(sub_paise: int, is_grocery: bool, get_cfg):
    """Return (delivery_p, platform_p, commission_p, taxes_p, gmv_p) all in paise."""
    delivery   = int(round(get_cfg(is_grocery, 'DELIVERY_CHARGE') * 100))
    platform   = int(round(get_cfg(is_grocery, 'PLATFORM_FEE')    * 100))
    commission = int(round(sub_paise * get_cfg(is_grocery, 'COMMISSION') / 100))
    taxable    = commission + delivery + platform
    taxes      = int(round(taxable * get_cfg(is_grocery, 'SERVICE_TAX') / 100))
    gmv        = sub_paise + delivery + platform + taxes
    return delivery, platform, commission, taxes, gmv


def build_vendor_cat_map(db: Session) -> dict:
    """Return {shop_id_int: store_category_str} for all vendors."""
    cat_map = {}
    for v in db.query(Vendor).all():
        try:
            cat_map[int(v.vendor_id)] = v.store_category or ''
        except (ValueError, TypeError):
            pass
    return cat_map


def is_grocery_cat(category: str) -> bool:
    return 'grocery' in (category or '').lower()


# ─── Pydantic schemas ────────────────────────────────────────────────

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

class VendorLocationReq(BaseModel):
    lat: float
    lng: float

class CreateSettlementReq(BaseModel):
    vendor_id: str
    period_start: str
    period_end: str
    adjustments: float = 0
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
    salary_per_day: Optional[float] = 0
    per_delivery_bonus: Optional[float] = 0
    joining_date: Optional[str] = None
    emergency_contact: Optional[str] = ""
    id_proof_number: Optional[str] = ""

class AssignDeliveryReq(BaseModel):
    delivery_person_id: int

class AttendanceReq(BaseModel):
    status: str = "present"
    login_time: Optional[str] = None
    logout_time: Optional[str] = None
    notes: Optional[str] = ""

class ConfigUpdateReq(BaseModel):
    value: str


# ─── Auth ────────────────────────────────────────────────────────────

@app.post("/api/auth/send-otp")
async def send_otp(req: SendOtpReq):
    try:
        return await admin_deck.send_otp(req.phone)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to send OTP: {e}")


@app.post("/api/auth/verify-otp")
async def verify_otp(req: VerifyOtpReq):
    try:
        return await admin_deck.verify_otp(req.phone, req.otp, req.verificationId)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"OTP verification failed: {e}")


@app.get("/api/auth/regions")
async def get_regions():
    try:
        regions = await admin_deck.fetch_regions()
        return {"regions": regions}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to fetch regions: {e}")


@app.get("/api/pricing-configs")
async def get_pricing_configs(service_type: str = "FOOD"):
    try:
        configs = await admin_deck.fetch_pricing_configs(service_type)
        return {"configs": configs}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to fetch pricing configs: {e}")


# ─── Orders ──────────────────────────────────────────────────────────

_sync_state: dict = {"running": False, "result": None, "error": None}


async def _do_sync(region_id: str, session_key: str, time_range: str):
    from database import SessionLocal
    _sync_state["running"] = True
    _sync_state["result"] = None
    _sync_state["error"] = None
    try:
        orders = await admin_deck.fetch_orders(region_id, session_key, time_range)

        if not orders:
            _sync_state["result"] = {"synced": 0, "total_fetched": 0}
            return

        def _parse_dt(val):
            if not val:
                return None
            try:
                dt = datetime.fromisoformat(val.replace("Z", "+00:00"))
                # OrderCache DateTime columns are TIMESTAMP WITHOUT TIME ZONE (naive).
                # psycopg2 raises DataError when inserting a tz-aware datetime into a
                # naive column, which aborts the entire db.commit() and leaves the DB
                # permanently empty. Strip tz info here — timestamps are already UTC.
                return dt.replace(tzinfo=None)
            except (ValueError, AttributeError):
                return None

        db = SessionLocal()
        try:
            incoming_ids = [str(o.get("orderId", "")) for o in orders]
            existing_map = {
                r.order_id: r
                for r in db.query(OrderCache).filter(OrderCache.order_id.in_(incoming_ids)).all()
            }

            new_records = []
            skipped    = 0
            now        = datetime.utcnow()

            for o in orders:
                order_id = str(o.get("orderId", ""))
                if not order_id:
                    skipped += 1
                    continue

                try:
                    order_data = {
                        "order_id":                   order_id,
                        "campus_id":                  o.get("campusId", ""),
                        "shop_id":                    o.get("shopId"),
                        "customer_id":                o.get("customerId"),
                        "customer_name":              o.get("customerName", ""),
                        "customer_mobile":            o.get("customerMobile"),
                        "customer_address":           o.get("customerAddress", ""),
                        "state":                      o.get("state", ""),
                        # _safe_float guards against API returning null for any amount
                        # field — dict.get(key, 0) only returns 0 when the key is absent;
                        # if the key exists with a null value, bare float() raises TypeError
                        # and aborts the entire sync batch.
                        "total_amount_paise":         rupees_to_paise(_safe_float(o.get("totalAmount"))),
                        "amount_excl_delivery_paise": rupees_to_paise(_safe_float(o.get("amountExcludingDeliveryFee"))),
                        "delivery_fee_paise":         rupees_to_paise(_safe_float(o.get("deliveryFee"))),
                        "invoice_amount_paise":       rupees_to_paise(_safe_float(o.get("invoiceAmount"))),
                        "payment_method":             o.get("paymentMethod", ""),
                        "fulfillment_option":         o.get("fulfillmentOption", ""),
                        "order_items":                o.get("orderItem") or [],
                        "total_item_count":           o.get("totalItemCount") or 0,
                        "product_count":              o.get("productCount") or 0,
                        "order_description":          o.get("orderDescription", ""),
                        "order_link":                 o.get("orderLink", ""),
                        "state_label":                o.get("stateLabel", ""),
                        "synced_at":                  now,
                        "creation_time":              _parse_dt(o.get("creationTime")),
                        "accepted_date":              _parse_dt(o.get("acceptedDate")),
                        "completed_date":             _parse_dt(o.get("completedDate")),
                        "rejected_date":              _parse_dt(o.get("rejectedDate")),
                    }
                except Exception as per_order_err:
                    print(f"Skipping order {order_id}: {per_order_err}")
                    skipped += 1
                    continue

                existing = existing_map.get(order_id)
                if existing:
                    for k, v in order_data.items():
                        if k != "delivery_person_id":
                            setattr(existing, k, v)
                else:
                    new_records.append(OrderCache(**order_data))

            if new_records:
                db.bulk_save_objects(new_records)
            db.commit()

            # The Smartbiz region-orders endpoint only returns active (non-completed)
            # orders. When an order is delivered in Smartbiz it drops off the response,
            # so our DB never receives the state update and the order stays stuck as
            # SHIPPED or PENDING on the live map. For TODAY syncs we detect these
            # "disappeared" active orders and fetch their current state individually.
            if time_range == "TODAY":
                active_states = ["PENDING", "ACCEPTED", "PACKED", "SHIPPED"]
                today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
                incoming_id_set = {str(o.get("orderId", "")) for o in orders if o.get("orderId")}

                stale_query = db.query(OrderCache).filter(
                    OrderCache.creation_time >= today_start,
                    OrderCache.state.in_(active_states),
                )
                if incoming_id_set:
                    stale_query = stale_query.filter(
                        ~OrderCache.order_id.in_(incoming_id_set)
                    )
                # Cap at 30 to avoid a flood of individual API calls per sync cycle
                stale_actives = stale_query.limit(30).all()

                updated_stale = 0
                for stale in stale_actives:
                    try:
                        details = await admin_deck.fetch_order_details(
                            stale.order_id, session_key=session_key
                        )
                        order_obj = details.get("order", {})
                        new_state = str(
                            order_obj.get("state") or order_obj.get("status") or ""
                        ).strip().upper()
                        if new_state and new_state != stale.state:
                            stale.state = new_state
                            stale.synced_at = datetime.utcnow()
                            completed_raw = order_obj.get("completedDate")
                            if completed_raw and not stale.completed_date:
                                stale.completed_date = _parse_dt(completed_raw)
                            rejected_raw = order_obj.get("rejectedDate")
                            if rejected_raw and not stale.rejected_date:
                                stale.rejected_date = _parse_dt(rejected_raw)
                            updated_stale += 1
                    except Exception as stale_err:
                        print(f"[_do_sync] stale-check failed for {stale.order_id}: {stale_err}")

                if updated_stale:
                    db.commit()
                    print(f"[_do_sync] corrected {updated_stale} stale active orders")

            synced = len(orders) - skipped
            _sync_state["result"] = {"synced": synced, "total_fetched": len(orders)}
        finally:
            db.close()
    except Exception as e:
        _sync_state["error"] = str(e)
    finally:
        _sync_state["running"] = False


@app.post("/api/orders/sync")
async def sync_orders(req: SyncOrdersReq):
    if _sync_state["running"]:
        return {"status": "already_running", "message": "Sync already in progress"}
    asyncio.create_task(_do_sync(req.regionId, req.sessionKey, req.timeRange or "LAST_1_MONTH"))
    return {"status": "started", "synced": None}


@app.get("/api/orders/sync-status")
def get_sync_status():
    return {
        "running": _sync_state["running"],
        "result":  _sync_state["result"],
        "error":   _sync_state["error"],
    }


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
        q = q.filter(
            OrderCache.creation_time < datetime.fromisoformat(date_to) + timedelta(days=1)
        )
    if search:
        q = q.filter(
            (OrderCache.order_id.ilike(f"%{search}%")) |
            (OrderCache.customer_name.ilike(f"%{search}%")) |
            (cast(OrderCache.customer_mobile, String).ilike(f"%{search}%"))
        )

    total  = q.count()
    orders = q.offset((page - 1) * per_page).limit(per_page).all()

    vendor_cat_map = build_vendor_cat_map(db)

    result = []
    for o in orders:
        delivery_mins = None
        if o.creation_time and o.completed_date:
            delivery_mins = int((o.completed_date - o.creation_time).total_seconds() / 60)

        result.append({
            "id":                o.id,
            "orderId":           o.order_id,
            "campusId":          o.campus_id,
            "shopId":            o.shop_id,
            "storeCategory":     vendor_cat_map.get(o.shop_id, ''),
            "customerName":      o.customer_name,
            "customerMobile":    o.customer_mobile,
            "customerAddress":   o.customer_address,
            "state":             o.state,
            "totalAmount":       paise_to_rupees(o.total_amount_paise),
            "amountExclDelivery":paise_to_rupees(o.amount_excl_delivery_paise),
            "deliveryFee":       paise_to_rupees(o.delivery_fee_paise),
            "paymentMethod":     o.payment_method,
            "fulfillmentOption": o.fulfillment_option,
            "creationTime":      o.creation_time.isoformat()  if o.creation_time  else None,
            "acceptedDate":      o.accepted_date.isoformat()  if o.accepted_date  else None,
            "completedDate":     o.completed_date.isoformat() if o.completed_date else None,
            "rejectedDate":      o.rejected_date.isoformat()  if o.rejected_date  else None,
            "orderItems":        o.order_items or [],
            "totalItemCount":    o.total_item_count,
            "orderDescription":  o.order_description,
            "deliveryPersonId":  o.delivery_person_id,
            "deliveryTimeMinutes": delivery_mins,
            "syncedAt":          o.synced_at.isoformat() if o.synced_at else None,
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
    return {"message": "Delivery person assigned", "orderId": order_id,
            "deliveryPersonId": req.delivery_person_id}


# ─── Live Map ────────────────────────────────────────────────────────

def _parse_address_field(raw: str) -> dict:
    """Parse the serialized address string from the admin deck.
    Format: {name=John, addressLine1=Room 101, ..., latitude=19.86, longitude=75.75}
    Returns a dict of the key-value pairs.
    """
    if not raw:
        return {}
    try:
        cleaned = raw.strip().strip("{}")
        parts = cleaned.split(", ")
        result = {}
        for part in parts:
            if "=" in part:
                key, _, value = part.partition("=")
                result[key.strip()] = value.strip()
        return result
    except Exception:
        return {}


@app.get("/api/orders/live-map")
def live_map_orders(db: Session = Depends(get_db)):
    """Today's incomplete orders with parsed lat/lng for map rendering."""
    # _parse_dt stores timestamps as UTC-naive values in the DateTime column
    # (SQLAlchemy strips tz info from aware datetimes on write).  Using
    # datetime.utcnow() here ensures we compare UTC against UTC regardless of
    # the server's local timezone — the previous datetime.combine(date.today())
    # used local midnight which is wrong on non-UTC hosts.
    today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)

    # PACKED is a live intermediate state (PENDING→ACCEPTED→PACKED→SHIPPED).
    # Omitting it caused packed orders to disappear from the map entirely.
    active_states = ["PENDING", "ACCEPTED", "PACKED", "SHIPPED"]

    orders = db.query(OrderCache).filter(
        OrderCache.creation_time >= today_start,
        OrderCache.state.in_(active_states),
    ).order_by(OrderCache.creation_time.desc()).all()

    vendor_names: dict = {}
    vendor_locations: dict = {}
    for v in db.query(Vendor).all():
        try:
            vid = int(v.vendor_id)
            vendor_names[vid] = v.vendor_name
            if v.latitude is not None and v.longitude is not None:
                vendor_locations[vid] = (float(v.latitude), float(v.longitude))
        except (ValueError, TypeError):
            pass

    result = []
    for o in orders:
        addr = _parse_address_field(o.customer_address or "")
        lat_str = addr.get("latitude")
        lng_str = addr.get("longitude")
        try:
            lat = float(lat_str) if lat_str else None
            lng = float(lng_str) if lng_str else None
        except (ValueError, TypeError):
            lat = lng = None

        vendor_loc = vendor_locations.get(o.shop_id)
        result.append({
            "orderId":       o.order_id,
            "state":         o.state,
            "customerName":  o.customer_name or "",
            "customerAddress": addr.get("addressLine1", ""),
            "lat":           lat,
            "lng":           lng,
            "creationTime":  o.creation_time.isoformat() if o.creation_time else None,
            "shopId":        o.shop_id,
            "vendorName":    vendor_names.get(o.shop_id, ""),
            "totalAmount":   paise_to_rupees(o.total_amount_paise),
            "paymentMethod": o.payment_method or "",
            "totalItemCount": o.total_item_count or 0,
            "orderDescription": o.order_description or "",
            "vendorLat":     vendor_loc[0] if vendor_loc else None,
            "vendorLng":     vendor_loc[1] if vendor_loc else None,
        })

    return {
        "orders": result,
        "summary": {
            "pending":  sum(1 for o in result if o["state"] == "PENDING"),
            "accepted": sum(1 for o in result if o["state"] == "ACCEPTED"),
            "packed":   sum(1 for o in result if o["state"] == "PACKED"),
            "shipped":  sum(1 for o in result if o["state"] == "SHIPPED"),
            "total":    len(result),
            "withCoordinates": sum(1 for o in result if o["lat"] is not None),
        },
    }


# ─── Vendors ─────────────────────────────────────────────────────────

@app.post("/api/vendors/sync")
async def sync_vendors(req: SyncVendorsReq, db: Session = Depends(get_db)):
    try:
        vendors = await admin_deck.fetch_vendors(req.regionId)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to fetch vendors: {e}")

    synced = 0
    for v in vendors:
        vid      = str(v.get("shopId", v.get("vendorId", "")))
        existing = db.query(Vendor).filter(Vendor.vendor_id == vid).first()

        vname    = v.get("name",     v.get("vendorName",     ""))
        vphone   = v.get("phone",    v.get("vendorPhone",    ""))
        vlogo    = v.get("logo",     v.get("vendorLogoUrl",  ""))
        vcategory= v.get("category", v.get("storeCategory",  ""))

        if existing:
            existing.vendor_name     = vname     or existing.vendor_name
            existing.vendor_phone    = vphone    or existing.vendor_phone
            existing.vendor_logo_url = vlogo     or existing.vendor_logo_url
            existing.store_category  = vcategory or existing.store_category
        else:
            db.add(Vendor(
                vendor_id=vid, vendor_name=vname, vendor_phone=vphone,
                vendor_logo_url=vlogo, store_category=vcategory,
            ))
        synced += 1

    db.commit()
    return {"synced": synced}


@app.get("/api/vendors")
def list_vendors(db: Session = Depends(get_db)):
    vendors = db.query(Vendor).order_by(Vendor.vendor_name).all()
    result = []
    for v in vendors:
        try:
            sid = int(v.vendor_id)
        except (ValueError, TypeError):
            sid = None

        total_orders     = db.query(OrderCache).filter(OrderCache.shop_id == sid).count() if sid else 0
        completed_orders = db.query(OrderCache).filter(
            OrderCache.shop_id == sid, OrderCache.state == "COMPLETED"
        ).count() if sid else 0

        result.append({
            "vendorId":               v.vendor_id,
            "vendorName":             v.vendor_name,
            "vendorPhone":            v.vendor_phone,
            "vendorLogoUrl":          v.vendor_logo_url,
            "storeCategory":          v.store_category,
            "customCommissionPercent":float(v.custom_commission_percent) if v.custom_commission_percent else None,
            "notes":                  v.notes,
            "totalOrders":            total_orders,
            "completedOrders":        completed_orders,
            "lat":                    float(v.latitude)  if v.latitude  is not None else None,
            "lng":                    float(v.longitude) if v.longitude is not None else None,
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


@app.put("/api/vendors/{vendor_id}/location")
def update_vendor_location(vendor_id: str, req: VendorLocationReq, db: Session = Depends(get_db)):
    vendor = db.query(Vendor).filter(Vendor.vendor_id == vendor_id).first()
    if not vendor:
        raise HTTPException(status_code=404, detail="Vendor not found")
    vendor.latitude  = req.lat
    vendor.longitude = req.lng
    vendor.updated_at = datetime.utcnow()
    db.commit()
    return {"message": "Vendor location updated", "vendorId": vendor_id, "lat": req.lat, "lng": req.lng}


# ─── Settlements ─────────────────────────────────────────────────────

@app.post("/api/settlements/calculate")
async def calculate_settlement(req: CreateSettlementReq, db: Session = Depends(get_db)):
    vendor = db.query(Vendor).filter(Vendor.vendor_id == req.vendor_id).first()
    if not vendor:
        raise HTTPException(status_code=404, detail="Vendor not found in DB. Sync vendors first.")

    period_start = datetime.strptime(req.period_start, "%Y-%m-%d")
    period_end   = datetime.strptime(req.period_end,   "%Y-%m-%d") + timedelta(days=1) - timedelta(seconds=1)

    try:
        shop_id = int(req.vendor_id)
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="Invalid vendor ID format")

    overlapping = db.query(Settlement).filter(
        Settlement.vendor_id == req.vendor_id,
        Settlement.status    == "settled",
        Settlement.period_end   >= period_start,
        Settlement.period_start <= period_end,
    ).first()
    if overlapping:
        raise HTTPException(
            status_code=400,
            detail=f"A settled settlement already covers this period (cleared till {overlapping.period_end.strftime('%Y-%m-%d')}). Delete it first if you need to recalculate."
        )

    orders = db.query(OrderCache).filter(
        OrderCache.shop_id     == shop_id,
        OrderCache.state       == "COMPLETED",
        OrderCache.creation_time >= period_start,
        OrderCache.creation_time <= period_end,
    ).all()

    if not orders:
        raise HTTPException(
            status_code=400,
            detail="No completed orders found for this vendor in the given date range"
        )

    get_cfg    = await get_pricing_lookup()
    is_grocery = is_grocery_cat(vendor.store_category or '')

    # Use vendor-specific commission override if set
    if vendor.custom_commission_percent:
        custom_comm_rate = float(vendor.custom_commission_percent) / 100
    else:
        custom_comm_rate = None

    food_value_p = delivery_p = platform_p = commission_p = gmv_p = 0

    for o in orders:
        sub = o.amount_excl_delivery_paise
        deliv, plat, comm, taxes, gmv = calc_order_amounts(sub, is_grocery, get_cfg)

        # Apply custom commission override per order if set
        if custom_comm_rate is not None:
            comm = int(round(sub * custom_comm_rate))
            taxable = comm + deliv + plat
            taxes   = int(round(taxable * get_cfg(is_grocery, 'SERVICE_TAX') / 100))
            gmv     = sub + deliv + plat + taxes

        food_value_p  += sub
        delivery_p    += deliv
        platform_p    += plat
        commission_p  += comm
        gmv_p         += gmv

    adjustments_p   = rupees_to_paise(req.adjustments)
    net_payable_p   = food_value_p - commission_p - platform_p + adjustments_p
    our_earnings_p  = commission_p + delivery_p + platform_p - adjustments_p

    settlement = Settlement(
        vendor_id=req.vendor_id,
        period_start=period_start,
        period_end=period_end,
        total_orders=len(orders),
        total_gmv_paise=gmv_p,
        food_value_paise=food_value_p,
        commission_paise=commission_p,
        delivery_fees_paise=delivery_p,
        platform_fees_paise=platform_p,
        adjustments_paise=adjustments_p,
        adjustment_reason=req.adjustment_reason,
        net_payable_paise=net_payable_p,
        our_earnings_paise=our_earnings_p,
        status="pending",
        notes=req.notes,
    )
    db.add(settlement)
    db.commit()
    db.refresh(settlement)
    return _settlement_to_dict(settlement)


@app.post("/api/settlements/clear-till-today/{vendor_id}")
async def clear_till_today(vendor_id: str, db: Session = Depends(get_db)):
    vendor = db.query(Vendor).filter(Vendor.vendor_id == vendor_id).first()
    if not vendor:
        raise HTTPException(status_code=404, detail="Vendor not found")

    try:
        shop_id = int(vendor_id)
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="Invalid vendor ID format")

    latest_settled = db.query(Settlement).filter(
        Settlement.vendor_id == vendor_id, Settlement.status == "settled"
    ).order_by(Settlement.period_end.desc()).first()

    if latest_settled:
        cleared_date = latest_settled.period_end.date()
        if cleared_date >= date.today():
            raise HTTPException(status_code=400, detail="Already cleared till today — no new orders to settle")
        period_start = datetime.combine(cleared_date + timedelta(days=1), datetime.min.time())
    else:
        period_start = datetime.combine(date.today() - timedelta(days=90), datetime.min.time())

    period_end = datetime.combine(date.today(), datetime.min.time()) + timedelta(days=1) - timedelta(seconds=1)

    get_cfg    = await get_pricing_lookup()
    is_grocery = is_grocery_cat(vendor.store_category or '')

    if vendor.custom_commission_percent:
        custom_comm_rate = float(vendor.custom_commission_percent) / 100
    else:
        custom_comm_rate = None

    orders = db.query(OrderCache).filter(
        OrderCache.shop_id    == shop_id,
        OrderCache.state      == "COMPLETED",
        cast(OrderCache.creation_time, Date) >= period_start.date(),
        cast(OrderCache.creation_time, Date) <= date.today(),
    ).all()

    if not orders:
        raise HTTPException(status_code=400, detail="No completed orders found to settle for this period")

    food_value_p = delivery_p = platform_p = commission_p = gmv_p = 0
    for o in orders:
        sub = o.amount_excl_delivery_paise
        deliv, plat, comm, taxes, gmv = calc_order_amounts(sub, is_grocery, get_cfg)
        if custom_comm_rate is not None:
            comm    = int(round(sub * custom_comm_rate))
            taxable = comm + deliv + plat
            taxes   = int(round(taxable * get_cfg(is_grocery, 'SERVICE_TAX') / 100))
            gmv     = sub + deliv + plat + taxes
        food_value_p  += sub
        delivery_p    += deliv
        platform_p    += plat
        commission_p  += comm
        gmv_p         += gmv

    net_payable_p  = food_value_p - commission_p - platform_p
    our_earnings_p = commission_p + delivery_p + platform_p

    settlement = Settlement(
        vendor_id=vendor_id,
        period_start=period_start,
        period_end=period_end,
        total_orders=len(orders),
        total_gmv_paise=gmv_p,
        food_value_paise=food_value_p,
        commission_paise=commission_p,
        delivery_fees_paise=delivery_p,
        platform_fees_paise=platform_p,
        adjustments_paise=0,
        adjustment_reason="",
        net_payable_paise=net_payable_p,
        our_earnings_paise=our_earnings_p,
        status="settled",
        settled_at=datetime.utcnow(),
        settled_by="admin",
        notes="Cleared till today",
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
    return {"settlements": [_settlement_to_dict(s) for s in q.all()]}


@app.get("/api/settlements/vendor-summary")
async def vendor_settlement_summary(db: Session = Depends(get_db)):
    vendors = db.query(Vendor).order_by(Vendor.vendor_name).all()
    get_cfg = await get_pricing_lookup()
    result  = []

    for v in vendors:
        vid = v.vendor_id
        try:
            shop_id = int(vid)
        except (ValueError, TypeError):
            continue

        is_grocery = is_grocery_cat(v.store_category or '')

        if v.custom_commission_percent:
            custom_comm_rate = float(v.custom_commission_percent) / 100
            comm_pct         = float(v.custom_commission_percent)
        else:
            custom_comm_rate = None
            comm_pct         = get_cfg(is_grocery, 'COMMISSION')

        latest_settled = db.query(Settlement).filter(
            Settlement.vendor_id == vid, Settlement.status == "settled"
        ).order_by(Settlement.period_end.desc()).first()

        cleared_till = latest_settled.period_end if latest_settled else None

        q = db.query(OrderCache).filter(
            OrderCache.shop_id == shop_id, OrderCache.state == "COMPLETED"
        )
        if cleared_till:
            cleared_till_date = cleared_till.date() if isinstance(cleared_till, datetime) else cleared_till
            q = q.filter(cast(OrderCache.creation_time, Date) > cleared_till_date)

        remaining_orders = q.all()

        food_p = delivery_p = platform_p = commission_p = gmv_p = 0
        for o in remaining_orders:
            sub = o.amount_excl_delivery_paise
            deliv, plat, comm, taxes, gmv = calc_order_amounts(sub, is_grocery, get_cfg)
            if custom_comm_rate is not None:
                comm    = int(round(sub * custom_comm_rate))
                taxable = comm + deliv + plat
                taxes   = int(round(taxable * get_cfg(is_grocery, 'SERVICE_TAX') / 100))
                gmv     = sub + deliv + plat + taxes
            food_p       += sub
            delivery_p   += deliv
            platform_p   += plat
            commission_p += comm
            gmv_p        += gmv

        payable_p  = food_p - commission_p - platform_p
        earnings_p = commission_p + delivery_p + platform_p

        pending_count = db.query(Settlement).filter(
            Settlement.vendor_id == vid, Settlement.status == "pending"
        ).count()

        total_settled_p = db.query(
            func.coalesce(func.sum(Settlement.net_payable_paise), 0)
        ).filter(Settlement.vendor_id == vid, Settlement.status == "settled").scalar()

        result.append({
            "vendorId":                vid,
            "vendorName":              v.vendor_name,
            "vendorPhone":             v.vendor_phone,
            "vendorLogoUrl":           v.vendor_logo_url,
            "commissionPercent":       comm_pct,
            "customCommission":        float(v.custom_commission_percent) if v.custom_commission_percent else None,
            "clearedTill":             cleared_till.strftime("%Y-%m-%d") if cleared_till else None,
            "remainingOrders":         len(remaining_orders),
            "remainingGmv":            paise_to_rupees(gmv_p),
            "remainingFoodValue":      paise_to_rupees(food_p),
            "remainingCommission":     paise_to_rupees(commission_p),
            "remainingDeliveryFees":   paise_to_rupees(delivery_p),
            "remainingPayable":        paise_to_rupees(payable_p),
            "remainingEarnings":       paise_to_rupees(earnings_p),
            "pendingSettlements":      pending_count,
            "totalHistoricallySettled":paise_to_rupees(total_settled_p),
            "notes":                   v.notes,
        })

    return {"vendors": result}


@app.put("/api/settlements/{settlement_id}/settle")
def mark_settled(settlement_id: int, req: SettleReq, db: Session = Depends(get_db)):
    s = db.query(Settlement).filter(Settlement.id == settlement_id).first()
    if not s:
        raise HTTPException(status_code=404, detail="Settlement not found")
    s.status     = "settled"
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
        s.adjustments_paise  = rupees_to_paise(req.adjustments)
        s.net_payable_paise  = s.food_value_paise - s.commission_paise - s.platform_fees_paise + s.adjustments_paise
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
        "id":               s.id,
        "vendorId":         s.vendor_id,
        "periodStart":      s.period_start.strftime("%Y-%m-%d") if s.period_start else None,
        "periodEnd":        s.period_end.strftime("%Y-%m-%d")   if s.period_end   else None,
        "totalOrders":      s.total_orders,
        "totalGmv":         paise_to_rupees(s.total_gmv_paise),
        "foodValue":        paise_to_rupees(s.food_value_paise),
        "commission":       paise_to_rupees(s.commission_paise),
        "deliveryFees":     paise_to_rupees(s.delivery_fees_paise),
        "platformFees":     paise_to_rupees(s.platform_fees_paise),
        "adjustments":      paise_to_rupees(s.adjustments_paise),
        "adjustmentReason": s.adjustment_reason,
        "netPayable":       paise_to_rupees(s.net_payable_paise),
        "ourEarnings":      paise_to_rupees(s.our_earnings_paise),
        "status":           s.status,
        "settledAt":        s.settled_at.isoformat() if s.settled_at else None,
        "settledBy":        s.settled_by,
        "notes":            s.notes,
        "createdAt":        s.created_at.isoformat() if s.created_at else None,
    }


# ─── Delivery persons ────────────────────────────────────────────────

def _delivery_person_stats(db: Session, dp_id: int, start: datetime, end: datetime):
    base_q = db.query(OrderCache).filter(
        OrderCache.delivery_person_id == dp_id,
        OrderCache.state == "COMPLETED",
        OrderCache.completed_date >= start,
        OrderCache.completed_date < end,
    )
    deliveries = base_q.count()

    gmv_paise = base_q.with_entities(
        func.coalesce(func.sum(OrderCache.total_amount_paise), 0)
    ).scalar()

    cash_paise = base_q.filter(OrderCache.payment_method == "CASH").with_entities(
        func.coalesce(func.sum(OrderCache.total_amount_paise), 0)
    ).scalar()

    delivery_fees_paise = base_q.with_entities(
        func.coalesce(func.sum(OrderCache.delivery_fee_paise), 0)
    ).scalar()

    timed_orders = base_q.filter(
        OrderCache.creation_time.isnot(None),
        OrderCache.completed_date.isnot(None),
    ).all()
    avg_time = fastest = slowest = None
    if timed_orders:
        times    = [(o.completed_date - o.creation_time).total_seconds() / 60 for o in timed_orders]
        avg_time = round(sum(times) / len(times), 1)
        fastest  = round(min(times), 1)
        slowest  = round(max(times), 1)

    failed_orders = db.query(OrderCache).filter(
        OrderCache.delivery_person_id == dp_id,
        OrderCache.state.in_(["CANCELLED", "REJECTED"]),
        OrderCache.creation_time >= start,
        OrderCache.creation_time < end,
    ).count()

    return {
        "deliveries":              deliveries,
        "gmvPaise":                int(gmv_paise),
        "cashCollectedPaise":      int(cash_paise),
        "deliveryFeesPaise":       int(delivery_fees_paise),
        "avgDeliveryTimeMinutes":  avg_time,
        "fastestDeliveryMinutes":  fastest,
        "slowestDeliveryMinutes":  slowest,
        "failedOrders":            failed_orders,
    }


@app.get("/api/delivery-persons")
def list_delivery_persons(db: Session = Depends(get_db)):
    persons     = db.query(DeliveryPerson).order_by(DeliveryPerson.active.desc(), DeliveryPerson.name).all()
    today_start = datetime.combine(date.today(), datetime.min.time())
    today_end   = today_start + timedelta(days=1)
    week_start  = today_start - timedelta(days=today_start.weekday())
    month_start = today_start.replace(day=1)

    result = []
    for dp in persons:
        today_stats = _delivery_person_stats(db, dp.id, today_start, today_end)
        week_stats  = _delivery_person_stats(db, dp.id, week_start,  today_end)
        month_stats = _delivery_person_stats(db, dp.id, month_start, today_end)

        all_timed = db.query(OrderCache).filter(
            OrderCache.delivery_person_id == dp.id,
            OrderCache.state == "COMPLETED",
            OrderCache.creation_time.isnot(None),
            OrderCache.completed_date.isnot(None),
        ).all()
        all_avg_time = None
        if all_timed:
            times        = [(o.completed_date - o.creation_time).total_seconds() / 60 for o in all_timed]
            all_avg_time = round(sum(times) / len(times), 1)

        total_lifetime = db.query(OrderCache).filter(
            OrderCache.delivery_person_id == dp.id, OrderCache.state == "COMPLETED"
        ).count()

        today_att = db.query(DeliveryAttendance).filter(
            DeliveryAttendance.delivery_person_id == dp.id,
            DeliveryAttendance.attendance_date    == date.today(),
        ).first()

        month_present = db.query(DeliveryAttendance).filter(
            DeliveryAttendance.delivery_person_id == dp.id,
            DeliveryAttendance.attendance_date    >= month_start.date(),
            DeliveryAttendance.status.in_(["present", "half_day"]),
        ).count()

        salary_today = dp.salary_per_day_paise if (today_att and today_att.status in ("present", "half_day")) else 0
        bonus_today  = today_stats["deliveries"] * dp.per_delivery_bonus_paise
        cost_today   = salary_today + bonus_today

        result.append({
            "id":                  dp.id,
            "name":                dp.name,
            "phone":               dp.phone,
            "active":              dp.active,
            "vehicleType":         dp.vehicle_type,
            "salaryPerDay":        paise_to_rupees(dp.salary_per_day_paise),
            "perDeliveryBonus":    paise_to_rupees(dp.per_delivery_bonus_paise),
            "joiningDate":         dp.joining_date.isoformat() if dp.joining_date else None,
            "emergencyContact":    dp.emergency_contact,
            "idProofNumber":       dp.id_proof_number,
            "todayDeliveries":     today_stats["deliveries"],
            "weekDeliveries":      week_stats["deliveries"],
            "monthDeliveries":     month_stats["deliveries"],
            "totalDeliveries":     total_lifetime,
            "avgDeliveryTimeMinutes": all_avg_time,
            "todayStats":          today_stats,
            "weekStats":           week_stats,
            "monthStats":          month_stats,
            "todayAttendance":     today_att.status if today_att else None,
            "monthPresentDays":    month_present,
            "todayCostPaise":      cost_today,
            "costPerDelivery":     round(paise_to_rupees(cost_today) / today_stats["deliveries"], 1)
                                   if today_stats["deliveries"] > 0 else None,
        })
    return {"deliveryPersons": result}


@app.post("/api/delivery-persons")
def create_delivery_person(req: DeliveryPersonReq, db: Session = Depends(get_db)):
    dp = DeliveryPerson(
        name=req.name, phone=req.phone,
        vehicle_type=req.vehicle_type or "bike",
        salary_per_day_paise=rupees_to_paise(req.salary_per_day or 0),
        per_delivery_bonus_paise=rupees_to_paise(req.per_delivery_bonus or 0),
        joining_date=datetime.strptime(req.joining_date, "%Y-%m-%d")
            if (req.joining_date and req.joining_date.strip()) else datetime.utcnow(),
        emergency_contact=req.emergency_contact or "",
        id_proof_number=req.id_proof_number or "",
    )
    db.add(dp); db.commit(); db.refresh(dp)
    return {"id": dp.id, "name": dp.name, "phone": dp.phone, "active": dp.active}


@app.put("/api/delivery-persons/{person_id}")
def update_delivery_person(person_id: int, req: DeliveryPersonReq, db: Session = Depends(get_db)):
    dp = db.query(DeliveryPerson).filter(DeliveryPerson.id == person_id).first()
    if not dp:
        raise HTTPException(status_code=404, detail="Delivery person not found")
    dp.name                   = req.name
    dp.phone                  = req.phone
    dp.vehicle_type           = req.vehicle_type or dp.vehicle_type
    dp.salary_per_day_paise   = rupees_to_paise(req.salary_per_day or 0)
    dp.per_delivery_bonus_paise = rupees_to_paise(req.per_delivery_bonus or 0)
    if req.joining_date and req.joining_date.strip():
        dp.joining_date = datetime.strptime(req.joining_date, "%Y-%m-%d")
    dp.emergency_contact = req.emergency_contact or dp.emergency_contact
    dp.id_proof_number   = req.id_proof_number   or dp.id_proof_number
    dp.updated_at        = datetime.utcnow()
    db.commit()
    return {"id": dp.id, "name": dp.name, "phone": dp.phone, "active": dp.active}


@app.delete("/api/delivery-persons/{person_id}")
def deactivate_delivery_person(person_id: int, db: Session = Depends(get_db)):
    dp = db.query(DeliveryPerson).filter(DeliveryPerson.id == person_id).first()
    if not dp:
        raise HTTPException(status_code=404, detail="Delivery person not found")
    dp.active     = False
    dp.updated_at = datetime.utcnow()
    db.commit()
    return {"message": "Delivery person deactivated"}


@app.put("/api/delivery-persons/{person_id}/reactivate")
def reactivate_delivery_person(person_id: int, db: Session = Depends(get_db)):
    dp = db.query(DeliveryPerson).filter(DeliveryPerson.id == person_id).first()
    if not dp:
        raise HTTPException(status_code=404, detail="Delivery person not found")
    dp.active     = True
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
    dp = db.query(DeliveryPerson).filter(DeliveryPerson.id == person_id).first()
    if not dp:
        raise HTTPException(status_code=404, detail="Delivery person not found")

    q = db.query(OrderCache).filter(OrderCache.delivery_person_id == person_id)
    if date_from:
        q = q.filter(OrderCache.creation_time >= datetime.strptime(date_from, "%Y-%m-%d"))
    if date_to:
        q = q.filter(OrderCache.creation_time < datetime.strptime(date_to, "%Y-%m-%d") + timedelta(days=1))

    total  = q.count()
    orders = q.order_by(OrderCache.creation_time.desc()).offset((page - 1) * per_page).limit(per_page).all()

    result = []
    for o in orders:
        delivery_mins = None
        if o.creation_time and o.completed_date:
            delivery_mins = round((o.completed_date - o.creation_time).total_seconds() / 60, 1)
        result.append({
            "orderId":           o.order_id,
            "customerName":      o.customer_name,
            "customerAddress":   o.customer_address,
            "state":             o.state,
            "totalAmount":       paise_to_rupees(o.total_amount_paise),
            "deliveryFee":       paise_to_rupees(o.delivery_fee_paise),
            "paymentMethod":     o.payment_method,
            "creationTime":      o.creation_time.isoformat()  if o.creation_time  else None,
            "completedDate":     o.completed_date.isoformat() if o.completed_date else None,
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
    dp = db.query(DeliveryPerson).filter(DeliveryPerson.id == person_id).first()
    if not dp:
        raise HTTPException(status_code=404, detail="Delivery person not found")

    start = datetime.strptime(date_from, "%Y-%m-%d") if date_from \
            else datetime.combine(date.today().replace(day=1), datetime.min.time())
    end   = (datetime.strptime(date_to, "%Y-%m-%d") + timedelta(days=1)) if date_to \
            else datetime.combine(date.today() + timedelta(days=1), datetime.min.time())

    stats = _delivery_person_stats(db, dp.id, start, end)

    attendance = db.query(DeliveryAttendance).filter(
        DeliveryAttendance.delivery_person_id == dp.id,
        DeliveryAttendance.attendance_date    >= start.date(),
        DeliveryAttendance.attendance_date    <= end.date(),
    ).all()

    present_days = sum(1 for a in attendance if a.status == "present")
    half_days    = sum(1 for a in attendance if a.status == "half_day")
    absent_days  = sum(1 for a in attendance if a.status == "absent")
    total_hours  = sum(float(a.hours_worked or 0) for a in attendance)

    salary_paise = (present_days * dp.salary_per_day_paise) + (half_days * dp.salary_per_day_paise // 2)
    bonus_paise  = stats["deliveries"] * dp.per_delivery_bonus_paise
    total_cost_p = salary_paise + bonus_paise

    daily_data = []
    current    = start.date()
    end_date   = (end - timedelta(days=1)).date()
    while current <= end_date:
        day_start  = datetime.combine(current, datetime.min.time())
        day_end    = day_start + timedelta(days=1)
        day_stats  = _delivery_person_stats(db, dp.id, day_start, day_end)
        day_att    = next((a for a in attendance if a.attendance_date == current), None)
        daily_data.append({
            "date":          current.isoformat(),
            "deliveries":    day_stats["deliveries"],
            "gmv":           paise_to_rupees(day_stats["gmvPaise"]),
            "cashCollected": paise_to_rupees(day_stats["cashCollectedPaise"]),
            "attendance":    day_att.status if day_att else None,
            "hoursWorked":   float(day_att.hours_worked) if day_att else 0,
            "salary":        paise_to_rupees(dp.salary_per_day_paise)
                             if (day_att and day_att.status == "present")
                             else (paise_to_rupees(dp.salary_per_day_paise // 2)
                                   if (day_att and day_att.status == "half_day") else 0),
            "bonus":         paise_to_rupees(day_stats["deliveries"] * dp.per_delivery_bonus_paise),
        })
        current += timedelta(days=1)

    return {
        "personId":   dp.id,
        "personName": dp.name,
        "period":     {"from": start.date().isoformat(), "to": (end - timedelta(days=1)).date().isoformat()},
        "summary": {
            "totalDeliveries":    stats["deliveries"],
            "totalGmv":           paise_to_rupees(stats["gmvPaise"]),
            "cashCollected":      paise_to_rupees(stats["cashCollectedPaise"]),
            "deliveryFeesEarned": paise_to_rupees(stats["deliveryFeesPaise"]),
            "avgDeliveryTime":    stats["avgDeliveryTimeMinutes"],
            "presentDays":        present_days,
            "halfDays":           half_days,
            "absentDays":         absent_days,
            "totalHoursWorked":   round(total_hours, 1),
            "salaryPaid":         paise_to_rupees(salary_paise),
            "bonusPaid":          paise_to_rupees(bonus_paise),
            "totalCost":          paise_to_rupees(total_cost_p),
            "costPerDelivery":    round(paise_to_rupees(total_cost_p) / stats["deliveries"], 1)
                                  if stats["deliveries"] > 0 else None,
            "revenuePerDelivery": round(paise_to_rupees(stats["deliveryFeesPaise"]) / stats["deliveries"], 1)
                                  if stats["deliveries"] > 0 else None,
            "profitPerDelivery":  round(
                (paise_to_rupees(stats["deliveryFeesPaise"]) - paise_to_rupees(total_cost_p))
                / stats["deliveries"], 1
            ) if stats["deliveries"] > 0 else None,
            "failedOrders":       stats["failedOrders"],
        },
        "daily": daily_data,
    }


@app.get("/api/delivery-persons/leaderboard")
def delivery_leaderboard(period: str = Query("today"), db: Session = Depends(get_db)):
    today_start = datetime.combine(date.today(), datetime.min.time())
    today_end   = today_start + timedelta(days=1)
    if period == "week":
        start = today_start - timedelta(days=today_start.weekday())
    elif period == "month":
        start = today_start.replace(day=1)
    else:
        start = today_start

    board = []
    for dp in db.query(DeliveryPerson).filter(DeliveryPerson.active == True).all():
        stats     = _delivery_person_stats(db, dp.id, start, today_end)
        cost_p    = dp.salary_per_day_paise + stats["deliveries"] * dp.per_delivery_bonus_paise
        board.append({
            "id":           dp.id,
            "name":         dp.name,
            "vehicleType":  dp.vehicle_type,
            "deliveries":   stats["deliveries"],
            "gmv":          paise_to_rupees(stats["gmvPaise"]),
            "cashCollected":paise_to_rupees(stats["cashCollectedPaise"]),
            "avgTime":      stats["avgDeliveryTimeMinutes"],
            "fastestTime":  stats["fastestDeliveryMinutes"],
            "failedOrders": stats["failedOrders"],
            "costPerDelivery": round(paise_to_rupees(cost_p) / stats["deliveries"], 1)
                               if stats["deliveries"] > 0 else None,
            "successRate":  round(
                stats["deliveries"] / (stats["deliveries"] + stats["failedOrders"]) * 100, 1
            ) if (stats["deliveries"] + stats["failedOrders"]) > 0 else None,
        })

    board.sort(key=lambda x: x["deliveries"], reverse=True)
    for i, b in enumerate(board):
        b["rank"] = i + 1
    return {"leaderboard": board, "period": period}


# ─── Attendance ──────────────────────────────────────────────────────

@app.post("/api/delivery-persons/{person_id}/attendance")
def mark_attendance(person_id: int, req: AttendanceReq, db: Session = Depends(get_db)):
    dp = db.query(DeliveryPerson).filter(DeliveryPerson.id == person_id).first()
    if not dp:
        raise HTTPException(status_code=404, detail="Delivery person not found")

    existing  = db.query(DeliveryAttendance).filter(
        DeliveryAttendance.delivery_person_id == person_id,
        DeliveryAttendance.attendance_date    == date.today(),
    ).first()

    login_dt  = datetime.fromisoformat(req.login_time)  if req.login_time  else None
    logout_dt = datetime.fromisoformat(req.logout_time) if req.logout_time else None
    hours     = 0
    if login_dt and logout_dt:
        hours = round((logout_dt - login_dt).total_seconds() / 3600, 2)

    if existing:
        existing.status = req.status
        if login_dt:  existing.login_time  = login_dt
        if logout_dt:
            existing.logout_time = logout_dt
            if existing.login_time:
                hours = round((logout_dt - existing.login_time).total_seconds() / 3600, 2)
        existing.hours_worked = hours
        existing.notes        = req.notes or existing.notes
    else:
        db.add(DeliveryAttendance(
            delivery_person_id=person_id,
            attendance_date=date.today(),
            status=req.status,
            login_time=login_dt or datetime.utcnow(),
            logout_time=logout_dt,
            hours_worked=hours,
            notes=req.notes or "",
        ))

    db.commit()
    return {"message": "Attendance marked", "date": date.today().isoformat(), "status": req.status}


@app.get("/api/delivery-persons/{person_id}/attendance")
def get_attendance(person_id: int, month: Optional[str] = None, db: Session = Depends(get_db)):
    dp = db.query(DeliveryPerson).filter(DeliveryPerson.id == person_id).first()
    if not dp:
        raise HTTPException(status_code=404, detail="Delivery person not found")

    if month:
        year, mon = map(int, month.split("-"))
        start = date(year, mon, 1)
        end   = date(year + 1, 1, 1) if mon == 12 else date(year, mon + 1, 1)
    else:
        start = date.today().replace(day=1)
        end   = date(start.year + 1, 1, 1) if start.month == 12 else date(start.year, start.month + 1, 1)

    records = db.query(DeliveryAttendance).filter(
        DeliveryAttendance.delivery_person_id == person_id,
        DeliveryAttendance.attendance_date    >= start,
        DeliveryAttendance.attendance_date    <  end,
    ).order_by(DeliveryAttendance.attendance_date).all()

    present     = sum(1 for r in records if r.status == "present")
    half        = sum(1 for r in records if r.status == "half_day")
    absent      = sum(1 for r in records if r.status == "absent")
    total_hours = sum(float(r.hours_worked or 0) for r in records)

    return {
        "personId": person_id,
        "month":    start.strftime("%Y-%m"),
        "summary":  {"present": present, "halfDay": half, "absent": absent,
                     "totalHoursWorked": round(total_hours, 1)},
        "records": [{
            "date":        r.attendance_date.isoformat(),
            "status":      r.status,
            "loginTime":   r.login_time.isoformat()  if r.login_time  else None,
            "logoutTime":  r.logout_time.isoformat() if r.logout_time else None,
            "hoursWorked": float(r.hours_worked or 0),
            "notes":       r.notes,
        } for r in records],
    }


@app.post("/api/delivery-persons/bulk-attendance")
def bulk_mark_attendance(db: Session = Depends(get_db)):
    active = db.query(DeliveryPerson).filter(DeliveryPerson.active == True).all()
    marked = 0
    for dp in active:
        existing = db.query(DeliveryAttendance).filter(
            DeliveryAttendance.delivery_person_id == dp.id,
            DeliveryAttendance.attendance_date    == date.today(),
        ).first()
        if not existing:
            db.add(DeliveryAttendance(
                delivery_person_id=dp.id,
                attendance_date=date.today(),
                status="present",
                login_time=datetime.utcnow(),
            ))
            marked += 1
    db.commit()
    return {"message": f"Attendance marked for {marked} persons", "markedCount": marked}


# ─── Analytics ───────────────────────────────────────────────────────

def _period_stats_calc(orders_all, vendor_cat: dict, get_cfg):
    """
    Compute period analytics from a list of OrderCache objects.
    Returns dict with GMV (recalculated via pricing configs), revenue, taxes, etc.
    ourRevenue excludes taxes (taxes shown separately).
    """
    completed = [o for o in orders_all if o.state == "COMPLETED"]

    gmv_p = commission_p = delivery_p = platform_p = taxes_p = 0

    for o in completed:
        cat        = vendor_cat.get(o.shop_id, '')
        is_grocery = is_grocery_cat(cat)
        sub        = o.amount_excl_delivery_paise
        deliv, plat, comm, tax, gmv = calc_order_amounts(sub, is_grocery, get_cfg)
        gmv_p        += gmv
        commission_p += comm
        delivery_p   += deliv
        platform_p   += plat
        taxes_p      += tax

    our_rev = commission_p + delivery_p + platform_p

    delivery_times = []
    for o in completed:
        if o.creation_time and o.completed_date:
            delivery_times.append((o.completed_date - o.creation_time).total_seconds() / 60)
    avg_del = round(sum(delivery_times) / len(delivery_times), 1) if delivery_times else None

    return {
        "totalOrders":    len(orders_all),
        "completedOrders":len(completed),
        "totalGmv":       paise_to_rupees(gmv_p),
        "ourRevenue":     paise_to_rupees(our_rev),
        "commission":     paise_to_rupees(commission_p),
        "deliveryFees":   paise_to_rupees(delivery_p),
        "platformFees":   paise_to_rupees(platform_p),
        "taxes":          paise_to_rupees(taxes_p),
        "avgDeliveryTime":avg_del,
        "avgOrderValue":  paise_to_rupees(gmv_p // len(completed)) if completed else 0,
    }


@app.get("/api/analytics/summary")
async def analytics_summary(days: int = 30, db: Session = Depends(get_db)):
    """
    Returns period (last `days` days), today, week, month stats.
    All GMV and revenue figures use live pricing configs per vendor category.
    ourRevenue excludes taxes; taxes shown as separate field.
    """
    get_cfg     = await get_pricing_lookup()
    vendor_cat  = build_vendor_cat_map(db)

    today_start  = datetime.combine(date.today(), datetime.min.time())
    week_start   = today_start - timedelta(days=today_start.weekday())
    month_start  = today_start.replace(day=1)
    period_start = datetime.combine(date.today() - timedelta(days=days), datetime.min.time())

    def fetch_period(start):
        return db.query(OrderCache).filter(OrderCache.creation_time >= start).all()

    return {
        "period": _period_stats_calc(fetch_period(period_start), vendor_cat, get_cfg),
        "today":  _period_stats_calc(fetch_period(today_start),  vendor_cat, get_cfg),
        "week":   _period_stats_calc(fetch_period(week_start),   vendor_cat, get_cfg),
        "month":  _period_stats_calc(fetch_period(month_start),  vendor_cat, get_cfg),
    }


@app.get("/api/analytics/daily-orders")
async def daily_orders(
    days: int = 30,
    exact_date: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """
    Returns per-day order counts and GMV (recalculated with pricing configs, COMPLETED only).
    Pass exact_date=YYYY-MM-DD to get a single-day result.
    """
    get_cfg    = await get_pricing_lookup()
    vendor_cat = build_vendor_cat_map(db)

    if exact_date:
        day     = datetime.strptime(exact_date, "%Y-%m-%d")
        day_end = day + timedelta(days=1)
        orders  = db.query(OrderCache).filter(
            OrderCache.creation_time >= day,
            OrderCache.creation_time <  day_end,
            OrderCache.state         == "COMPLETED",
        ).all()
        gmv = 0
        for o in orders:
            cat = vendor_cat.get(o.shop_id, '')
            _, _, _, _, order_gmv = calc_order_amounts(
                o.amount_excl_delivery_paise, is_grocery_cat(cat), get_cfg
            )
            gmv += order_gmv
        return {"dailyOrders": [{"date": exact_date, "orders": len(orders), "gmv": paise_to_rupees(gmv)}]}

    start  = datetime.combine(date.today() - timedelta(days=days), datetime.min.time())
    orders = db.query(OrderCache).filter(
        OrderCache.creation_time >= start,
        OrderCache.state         == "COMPLETED",
    ).all()

    daily: dict = {}
    for o in orders:
        if not o.creation_time:
            continue
        day_key = o.creation_time.strftime("%Y-%m-%d")
        if day_key not in daily:
            daily[day_key] = {"date": day_key, "orders": 0, "gmv": 0}
        cat = vendor_cat.get(o.shop_id, '')
        _, _, _, _, order_gmv = calc_order_amounts(
            o.amount_excl_delivery_paise, is_grocery_cat(cat), get_cfg
        )
        daily[day_key]["orders"] += 1
        daily[day_key]["gmv"]    += paise_to_rupees(order_gmv)

    result = []
    for i in range(days):
        d = (date.today() - timedelta(days=days - 1 - i)).strftime("%Y-%m-%d")
        result.append(daily.get(d, {"date": d, "orders": 0, "gmv": 0}))
    return {"dailyOrders": result}


@app.get("/api/analytics/date-detail")
async def date_detail(target_date: str, db: Session = Depends(get_db)):
    """Full analytics for a single specific date (exact day view)."""
    try:
        day = datetime.strptime(target_date, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD")

    day_end    = day + timedelta(days=1)
    get_cfg    = await get_pricing_lookup()
    vendor_cat = build_vendor_cat_map(db)

    all_orders = db.query(OrderCache).filter(
        OrderCache.creation_time >= day,
        OrderCache.creation_time <  day_end,
    ).all()

    completed = [o for o in all_orders if o.state == "COMPLETED"]
    cancelled = [o for o in all_orders if o.state in ("CANCELLED", "REJECTED")]

    gmv_p = commission_p = delivery_p = platform_p = taxes_p = 0
    for o in completed:
        cat        = vendor_cat.get(o.shop_id, '')
        is_grocery = is_grocery_cat(cat)
        sub        = o.amount_excl_delivery_paise
        deliv, plat, comm, tax, gmv = calc_order_amounts(sub, is_grocery, get_cfg)
        gmv_p        += gmv
        commission_p += comm
        delivery_p   += deliv
        platform_p   += plat
        taxes_p      += tax

    hourly: dict = {h: {"total": 0, "completed": 0} for h in range(24)}
    for o in all_orders:
        if o.creation_time:
            h = o.creation_time.hour
            hourly[h]["total"] += 1
            if o.state == "COMPLETED":
                hourly[h]["completed"] += 1

    our_rev = commission_p + delivery_p + platform_p

    return {
        "date":             target_date,
        "totalOrders":      len(all_orders),
        "completedOrders":  len(completed),
        "cancelledOrders":  len(cancelled),
        "totalGmv":         paise_to_rupees(gmv_p),
        "ourRevenue":       paise_to_rupees(our_rev),
        "commission":       paise_to_rupees(commission_p),
        "deliveryFees":     paise_to_rupees(delivery_p),
        "platformFees":     paise_to_rupees(platform_p),
        "taxes":            paise_to_rupees(taxes_p),
        "avgOrderValue":    paise_to_rupees(gmv_p // len(completed)) if completed else 0,
        "hourlyBreakdown":  [{"hour": h, "orders": v["total"], "completed": v["completed"]}
                             for h, v in hourly.items()],
    }


@app.get("/api/analytics/peak-hours")
def peak_hours(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    db: Session = Depends(get_db),
):
    q = db.query(OrderCache).filter(OrderCache.creation_time.isnot(None))
    if date_from:
        q = q.filter(OrderCache.creation_time >= datetime.fromisoformat(date_from))
    if date_to:
        q = q.filter(OrderCache.creation_time < datetime.fromisoformat(date_to) + timedelta(days=1))

    hourly = {h: 0 for h in range(24)}
    for o in q.all():
        if o.creation_time:
            hourly[o.creation_time.hour] += 1

    return {"peakHours": [{"hour": h, "orders": c} for h, c in hourly.items()]}


@app.get("/api/analytics/vendor-ranking")
async def vendor_ranking(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    db: Session = Depends(get_db),
):
    get_cfg    = await get_pricing_lookup()
    vendor_cat = build_vendor_cat_map(db)
    vendors    = db.query(Vendor).all()
    result     = []

    for v in vendors:
        try:
            shop_id = int(v.vendor_id)
        except (ValueError, TypeError):
            continue

        q = db.query(OrderCache).filter(
            OrderCache.shop_id == shop_id,
            OrderCache.state   == "COMPLETED",
        )
        if date_from:
            q = q.filter(OrderCache.creation_time >= datetime.fromisoformat(date_from))
        if date_to:
            q = q.filter(OrderCache.creation_time < datetime.fromisoformat(date_to) + timedelta(days=1))

        completed_orders = q.all()
        if not completed_orders:
            result.append({
                "vendorId": v.vendor_id, "vendorName": v.vendor_name,
                "totalOrders": 0, "totalGmv": 0, "foodValue": 0, "avgOrderValue": 0,
            })
            continue

        is_grocery = is_grocery_cat(vendor_cat.get(shop_id, ''))
        gmv_p = food_p = 0
        for o in completed_orders:
            sub = o.amount_excl_delivery_paise
            _, _, _, _, order_gmv = calc_order_amounts(sub, is_grocery, get_cfg)
            gmv_p  += order_gmv
            food_p += sub

        n = len(completed_orders)
        result.append({
            "vendorId":     v.vendor_id,
            "vendorName":   v.vendor_name,
            "totalOrders":  n,
            "totalGmv":     paise_to_rupees(gmv_p),
            "foodValue":    paise_to_rupees(food_p),
            "avgOrderValue":paise_to_rupees(gmv_p // n),
        })

    result.sort(key=lambda x: x["totalOrders"], reverse=True)
    return {"vendorRanking": result}


@app.get("/api/analytics/payment-split")
def payment_split(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    db: Session = Depends(get_db),
):
    q = db.query(OrderCache).filter(OrderCache.state == "COMPLETED")
    if date_from:
        q = q.filter(OrderCache.creation_time >= datetime.fromisoformat(date_from))
    if date_to:
        q = q.filter(OrderCache.creation_time < datetime.fromisoformat(date_to) + timedelta(days=1))

    cod_count = cod_amount = prepaid_count = prepaid_amount = 0
    for o in q.all():
        if o.payment_method == "COD":
            cod_count  += 1
            cod_amount += o.total_amount_paise
        else:
            prepaid_count  += 1
            prepaid_amount += o.total_amount_paise

    return {
        "cash":    {"count": cod_count,     "amount": paise_to_rupees(cod_amount)},
        "prepaid": {"count": prepaid_count, "amount": paise_to_rupees(prepaid_amount)},
        "total":   {"count": cod_count + prepaid_count,
                    "amount": paise_to_rupees(cod_amount + prepaid_amount)},
    }


# ─── Config ──────────────────────────────────────────────────────────

@app.get("/api/config")
def get_config(db: Session = Depends(get_db)):
    configs = db.query(AppConfig).all()
    return {"config": {c.config_key: {"value": c.config_value, "description": c.description}
                       for c in configs}}


@app.put("/api/config/{key}")
def update_config(key: str, req: ConfigUpdateReq, db: Session = Depends(get_db)):
    cfg = db.query(AppConfig).filter(AppConfig.config_key == key).first()
    if not cfg:
        raise HTTPException(status_code=404, detail="Config key not found")
    cfg.config_value = req.value
    cfg.updated_at   = datetime.utcnow()
    db.commit()
    return {"key": key, "value": req.value}


# ─── Health ───────────────────────────────────────────────────────────

@app.get("/api/health")
def health():
    return {"status": "ok", "timestamp": datetime.utcnow().isoformat()}


# ─── Debug ────────────────────────────────────────────────────────────

@app.get("/api/debug/raw-orders")
async def debug_raw_orders(region_id: str, session_key: str, time_range: str = "TODAY"):
    """Hit the external API directly and return the raw response for debugging."""
    import httpx
    url = f"{admin_deck.BASE_URL}/v2/order/region-orders?regionId={region_id}&timeRange={time_range}"
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(url, headers={
                "Content-Type": "application/json",
                "Request-Origin": "CAPTAIN",
                "SessionKey": session_key,
            })
            return {
                "status_code": resp.status_code,
                "url": url,
                "response_keys": list(resp.json().keys()) if isinstance(resp.json(), dict) else f"type={type(resp.json()).__name__}",
                "raw_response": resp.json(),
            }
    except Exception as e:
        return {"error": str(e), "url": url}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
