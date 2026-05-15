import os
import asyncio
import httpx
from datetime import datetime, timedelta, timezone
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))

BASE_URL = os.getenv("ADMIN_DECK_BASE_URL", "http://prd.quickverse.in/quickVerse")
BASIC_AUTH = os.getenv("ADMIN_DECK_BASIC_AUTH", "Basic cXZDYXN0bGVFbnRyeTpjYSR0bGVfUGVybWl0QDAx")

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

def _parse_shops_from_response(data: dict) -> tuple:
    """Return (shops_list, result_obj) from an API response dict."""
    if not isinstance(data, dict):
        return [], {}
    result_obj = data.get("result")
    if not isinstance(result_obj, dict):
        inner = data.get("response") or {}
        result_obj = inner.get("result") if isinstance(inner, dict) else None
        if not isinstance(result_obj, dict):
            result_obj = {}
    shops = result_obj.get("shops", [])
    return (shops if isinstance(shops, list) else []), result_obj


def _flatten_shops_to_raw(shops: list) -> list:
    """Flatten a shops array into a flat list of raw order dicts."""
    raw = []
    for shop in shops:
        if not isinstance(shop, dict):
            continue
        shop_id = shop.get("shopId") or (shop.get("shopDetails") or {}).get("shopId")
        shop_name = shop.get("shopName") or (shop.get("shopDetails") or {}).get("name", "")
        for o in (shop.get("orders") or []):
            if not isinstance(o, dict):
                continue
            if not o.get("shopId") and not o.get("vendorId"):
                o = {**o, "shopId": shop_id}
            if not o.get("shopName") and not o.get("vendorName"):
                o = {**o, "shopName": shop_name}
            raw.append(o)
    return raw


async def fetch_orders(region_id: str, session_key: str, time_range: str = "TODAY") -> list:
    """
    Fetch orders from /v2/order/region-orders.

    Strategy
    --------
    1. Primary call: send LAST_1_MONTH (or TODAY) with a large pageSize so we
       get as many orders as the API allows in one shot.  Also send both
       page=0 and pageNo=1 to cover either 0-indexed or 1-indexed pagination.

    2. Pagination loop: if result_obj carries hasNextPage / totalCount, walk
       the pages.  Stop when we get zero new unique orders on a page.

    3. Date-chunking (LAST_1_MONTH only): many APIs cap their timeRange
       responses to the most recent N orders.  To guarantee full coverage we
       fire one parallel request per day for the last 30 days using an ISO
       date string (YYYY-MM-DD) as timeRange — a common alternative the
       Quickverse API supports.  Batched in groups of 5 to be API-friendly.
       All results are merged with deduplication so nothing is double-counted.
    """
    seen:   set  = set()
    merged: list = []

    def _add_unique(raw_list: list) -> int:
        added = 0
        for o in raw_list:
            oid = str(o.get("orderId") or o.get("id") or "")
            if oid and oid not in seen:
                seen.add(oid)
                merged.append(_normalise_order(o))
                added += 1
        return added

    # ── 1 & 2: Primary fetch with pagination ────────────────────────────
    page_no = 1
    while page_no <= 50:
        url = (
            f"{BASE_URL}/v2/order/region-orders"
            f"?regionId={region_id}"
            f"&timeRange={time_range}"
            f"&page={page_no - 1}&pageNo={page_no}"
            f"&pageSize=1000&size=1000&limit=1000"
        )
        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.get(url, headers=_headers(SessionKey=session_key))
            resp.raise_for_status()
            data = resp.json()

        print(f"[fetch_orders] timeRange={time_range} pageNo={page_no} keys={list(data.keys()) if isinstance(data, dict) else type(data).__name__}")
        _check_api_error(data)

        shops, result_obj = _parse_shops_from_response(data)
        raw = _flatten_shops_to_raw(shops)
        page_new = _add_unique(raw)

        non_shop = {k: v for k, v in result_obj.items() if k != "shops"} if result_obj else {}
        print(f"[fetch_orders] pageNo={page_no} shops={len(shops)} +{page_new} new (total={len(merged)}) meta={non_shop}")

        has_next = result_obj.get("hasNextPage") or result_obj.get("hasMore") or result_obj.get("nextPage")
        total_count = result_obj.get("totalCount") or result_obj.get("total") or result_obj.get("totalOrders")

        if has_next:
            page_no += 1
            continue
        if total_count and isinstance(total_count, int) and len(merged) < total_count:
            page_no += 1
            continue
        if page_new == 0:
            break
        page_no += 1

    print(f"[fetch_orders] primary fetch done: {len(merged)} orders after {page_no} page(s)")

    # ── 3: Date-chunking supplement for LAST_1_MONTH ────────────────────
    # Fire one request per day for the last 30 days using ISO date strings.
    # This covers the full month even when the LAST_1_MONTH keyword only
    # returns a capped/recent slice from the API.
    if time_range == "LAST_1_MONTH":
        today = datetime.utcnow().date()
        dates = [(today - timedelta(days=i)).isoformat() for i in range(30)]

        async def _fetch_one_date(d: str) -> list:
            url = (
                f"{BASE_URL}/v2/order/region-orders"
                f"?regionId={region_id}&timeRange={d}"
                f"&pageSize=1000&size=1000&limit=1000"
            )
            try:
                async with httpx.AsyncClient(timeout=20) as client:
                    resp = await client.get(url, headers=_headers(SessionKey=session_key))
                    if not resp.is_success:
                        return []
                    data = resp.json()
                if not isinstance(data, dict):
                    return []
                shops, _ = _parse_shops_from_response(data)
                return _flatten_shops_to_raw(shops)
            except Exception as e:
                print(f"[fetch_orders] date {d} error: {e}")
                return []

        BATCH = 5
        for batch_start in range(0, len(dates), BATCH):
            batch = dates[batch_start: batch_start + BATCH]
            results = await asyncio.gather(*[_fetch_one_date(d) for d in batch])
            batch_added = sum(_add_unique(r) for r in results)
            if batch_added:
                print(f"[fetch_orders] date batch {batch_start // BATCH + 1} ({batch[0]}→{batch[-1]}): +{batch_added} new (total={len(merged)})")

    print(f"[fetch_orders] returning {len(merged)} total orders")
    return merged


async def fetch_order_details(order_id: str, session_key: str = None) -> dict:
    """Fetch single order details including shop info."""
    auth_headers = _headers(SessionKey=session_key) if session_key else _headers(Authorization=BASIC_AUTH)
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(
            f"{BASE_URL}/v2/order/{order_id}",
            headers=auth_headers,
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
