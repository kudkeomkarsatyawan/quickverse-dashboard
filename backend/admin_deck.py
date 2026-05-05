import os
import httpx
from datetime import datetime, timedelta, timezone
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))

BASE_URL = os.getenv("ADMIN_DECK_BASE_URL", "http://prd.quickverse.in/quickVerse")
BASIC_AUTH = "Basic cXZDYXN0bGVFbnRyeTpjYSR0bGVfUGVybWl0QDAx"

# Common headers matching the admin deck app
COMMON_HEADERS = {
    "Content-Type": "application/json",
    "Request-Origin": "CAPTAIN",
}

# All order statuses that exist on the platform
_ALL_STATUSES = ["PENDING", "ACCEPTED", "PACKED", "SHIPPED", "COMPLETED", "CANCELLED", "REJECTED"]


def _headers(**extra):
    h = {**COMMON_HEADERS, **extra}
    return h


async def send_otp(phone: str) -> dict:
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"{BASE_URL}/v1/requestOtp",
            json={"phone": phone},
            headers=_headers(Authorization=BASIC_AUTH),
        )
        resp.raise_for_status()
        data = resp.json()
        return {"verificationId": data.get("response", {}).get("verificationId", "")}


async def verify_otp(phone: str, otp: str, verification_id: str) -> dict:
    """Login. Phone should be 10-digit; we prepend '91'."""
    full_phone = f"91{phone}" if not phone.startswith("91") else phone

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"{BASE_URL}/v1/login",
            json={
                "phone": full_phone,
                "otp": otp,
                "verificationId": verification_id,
            },
            headers=_headers(Authorization=BASIC_AUTH),
        )
        resp.raise_for_status()
        data = resp.json()
        # dev-keshav: flat response (not nested under session)
        return {
            "token": data.get("jwt", ""),
            "phone": data.get("phone", ""),
            "empId": data.get("empId", ""),
            "newUser": data.get("newUser", False),
        }


async def fetch_regions() -> list:
    """Fetch all regions (replaces campuses)."""
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(
            f"{BASE_URL}/v3/regions",
            headers=_headers(Authorization=BASIC_AUTH),
        )
        resp.raise_for_status()
        data = resp.json()
        # Returns Region[] directly
        return data if isinstance(data, list) else data.get("regions", data)


async def fetch_vendors(region_id: str) -> list:
    """Fetch shops/vendors for a region."""
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(
            f"{BASE_URL}/v3/regions/shops?regionId={region_id}",
            headers=_headers(Authorization=BASIC_AUTH),
        )
        resp.raise_for_status()
        data = resp.json()
        # Returns Vendor[] directly
        return data if isinstance(data, list) else data.get("vendors", data)


# ─── Helpers for full-month paginated sync ───────────────────────────

def _normalise_order(o: dict) -> dict:
    """
    Map an order dict to the canonical field names used throughout the rest of
    the codebase (_do_sync in main.py expects orderId, state, customerMobile, etc.).
    Handles both the qvadmin Order interface names and the simplified names that
    the /v2/order/OrderStatus endpoint may return.
    """
    return {
        "orderId":                    str(o.get("orderId") or o.get("id") or ""),
        "campusId":                   o.get("campusId", ""),
        "shopId":                     o.get("shopId") or o.get("vendorId"),
        "customerId":                 o.get("customerId"),
        "customerName":               o.get("customerName", ""),
        "customerMobile":             o.get("customerMobile") or o.get("customerPhone"),
        "customerAddress":            o.get("customerAddress") or o.get("deliveryAddress", ""),
        "state":                      o.get("state") or o.get("status", ""),
        "totalAmount":                o.get("totalAmount", 0),
        "amountExcludingDeliveryFee": o.get("amountExcludingDeliveryFee", 0),
        "deliveryFee":                o.get("deliveryFee", 0),
        "invoiceAmount":              o.get("invoiceAmount", 0),
        "paymentMethod":              o.get("paymentMethod", ""),
        "fulfillmentOption":          o.get("fulfillmentOption", ""),
        "orderItem":                  o.get("orderItem") or o.get("items", []),
        "totalItemCount":             o.get("totalItemCount", 0),
        "productCount":               o.get("productCount", 0),
        "orderDescription":           o.get("orderDescription", ""),
        "orderLink":                  o.get("orderLink", ""),
        "stateLabel":                 o.get("stateLabel", ""),
        "creationTime":               o.get("creationTime") or o.get("createdAt"),
        "acceptedDate":               o.get("acceptedDate"),
        "completedDate":              o.get("completedDate"),
        "rejectedDate":               o.get("rejectedDate"),
    }


def _check_api_error(data: dict) -> None:
    """Raise RuntimeError for application-level auth failures.

    The external API returns HTTP 200 with an error code in the body for
    expired / invalid sessions (codes 1042, 1047 per qvadmin reference).
    raise_for_status() misses these; we must inspect the body ourselves.
    """
    if not isinstance(data, dict):
        return
    code = data.get("code") or data.get("statusCode") or data.get("errorCode")
    try:
        code = int(code) if code is not None else None
    except (TypeError, ValueError):
        code = None
    if code in (1042, 1047, 401, 403):
        msg = data.get("message") or data.get("error") or f"API auth error"
        raise RuntimeError(f"Session expired or unauthorized (code={code}): {msg}. Please log in again.")
    # If the response wrapper is null AND there's a non-success code, treat as error
    if data.get("response") is None and code and code not in (200, 0, None):
        msg = data.get("message", f"API error code {code}")
        raise RuntimeError(f"API error (code={code}): {msg}")


def _extract_orders_list(payload: dict) -> list:
    """
    Safely extract a flat list of order dicts from whatever the API returns.

    The /v2/order/OrderStatus endpoint has historically returned two shapes:
      Shape A – direct list:   { "response": { "orders": [...], "totalCount": N } }
      Shape B – nested object: { "response": { "orders": { "ordersAsList": [...],
                                                            "order": [...] } } }

    Both shapes are handled here so that a server-side schema change does not
    silently return zero orders.
    """
    orders_raw = payload.get("orders")

    # Shape A – already a flat list
    if isinstance(orders_raw, list):
        return orders_raw

    # Shape B – nested object with ordersAsList / order sub-keys
    if isinstance(orders_raw, dict):
        list_a = orders_raw.get("ordersAsList") or []
        list_b = orders_raw.get("order") or []
        if not isinstance(list_a, list):
            list_a = []
        if not isinstance(list_b, list):
            list_b = []
        return list_a + list_b

    return []


# ─── Public entry point ──────────────────────────────────────────────

async def fetch_orders(region_id: str, session_key: str, time_range: str = "TODAY") -> list:
    """
    Fetch orders from /v2/order/region-orders.

    Actual API response shape (confirmed via debug):
      { "result": { "shops": [ { "shopId": "...", "shopName": "...", "orders": [...] } ] } }

    Orders are grouped by shop/vendor; we flatten them into a single list and
    inject shopId from the parent shop object so downstream code can join with
    the vendors table.
    """
    url = f"{BASE_URL}/v2/order/region-orders?regionId={region_id}&timeRange={time_range}"

    async with httpx.AsyncClient(timeout=120) as client:
        resp = await client.get(url, headers=_headers(SessionKey=session_key))
        resp.raise_for_status()
        data = resp.json()

    print(f"[fetch_orders] timeRange={time_range} top-level keys: {list(data.keys()) if isinstance(data, dict) else type(data).__name__}")
    _check_api_error(data)

    # ── Extract the shops list ───────────────────────────────────────
    # Primary shape:  {"result": {"shops": [...]}}
    # Fallback shape: {"response": {"result": {"shops": [...]}}}
    result_obj = data.get("result") if isinstance(data, dict) else None
    if not isinstance(result_obj, dict):
        inner = data.get("response", {}) if isinstance(data, dict) else {}
        result_obj = inner.get("result", {}) if isinstance(inner, dict) else {}

    shops = result_obj.get("shops", []) if isinstance(result_obj, dict) else []
    print(f"[fetch_orders] shops in response: {len(shops)}")

    # ── Flatten vendor-grouped orders ────────────────────────────────
    raw_list: list = []
    if isinstance(shops, list):
        for shop in shops:
            if not isinstance(shop, dict):
                continue
            shop_id = (
                shop.get("shopId")
                or (shop.get("shopDetails") or {}).get("shopId")
            )
            shop_name = (
                shop.get("shopName")
                or (shop.get("shopDetails") or {}).get("name", "")
            )
            orders_in_shop = shop.get("orders") or []
            if not isinstance(orders_in_shop, list):
                continue
            for o in orders_in_shop:
                if not isinstance(o, dict):
                    continue
                # Inject parent-shop fields so _normalise_order can pick them up
                if not o.get("shopId") and not o.get("vendorId"):
                    o = {**o, "shopId": shop_id}
                if not o.get("shopName") and not o.get("vendorName"):
                    o = {**o, "shopName": shop_name}
                raw_list.append(o)

    print(f"[fetch_orders] {len(raw_list)} raw orders before dedup/normalise")

    # ── Deduplicate and normalise ────────────────────────────────────
    seen:   set  = set()
    merged: list = []
    for o in raw_list:
        oid = str(o.get("orderId") or o.get("id") or "")
        if not oid or oid in seen:
            continue
        seen.add(oid)
        merged.append(_normalise_order(o))

    print(f"[fetch_orders] returning {len(merged)} normalised orders")
    return merged


async def fetch_order_details(order_id: str) -> dict:
    """Fetch single order details including shop info."""
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(
            f"{BASE_URL}/v2/order/{order_id}",
            headers=_headers(Authorization=BASIC_AUTH),
        )
        resp.raise_for_status()
        data = resp.json()
        response = data.get("response", {})
        return {
            "order": response.get("order", {}),
            "shop": response.get("shop", {}),
        }


async def fetch_pricing_configs(service_type: str = "FOOD") -> list:
    """Fetch pricing configurations (commission, delivery charge, platform fee, etc.)."""
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(
            f"{BASE_URL}/v3/pricing-configurations?serviceType={service_type}",
            headers=_headers(Authorization=BASIC_AUTH),
        )
        resp.raise_for_status()
        data = resp.json()
        return data if isinstance(data, list) else []
