import os
import httpx
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))

BASE_URL = os.getenv("ADMIN_DECK_BASE_URL", "http://prd.quickverse.in/quickVerse")
BASIC_AUTH = "Basic cXZDYXN0bGVFbnRyeTpjYSR0bGVfUGVybWl0QDAx"

# Common headers matching the admin deck app
COMMON_HEADERS = {
    "Content-Type": "application/json",
    "Request-Origin": "CAPTAIN",
}


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


async def fetch_orders(region_id: str, session_key: str, time_range: str = "TODAY") -> list:
    """Fetch orders for a region. time_range: LAST_1_HOUR, LAST_3_HOUR, TODAY, LAST_1_MONTH"""
    url = f"{BASE_URL}/v2/order/region-orders?regionId={region_id}&timeRange={time_range}"

    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.get(
            url,
            headers=_headers(SessionKey=session_key),
        )
        resp.raise_for_status()
        data = resp.json()
        return data.get("orders", {}).get("order", [])


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
