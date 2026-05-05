"""
One-time seed script: writes vendor pickup coordinates straight to the DB.
Run from the backend/ directory:  python seed_vendor_locations.py
"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))

from database import SessionLocal
from models import Vendor

# ── Coordinates from the Excel sheet ─────────────────────────────────
# Format: shopId -> (latitude, longitude)
VENDOR_LOCATIONS: dict[int, tuple[float, float]] = {
    95813: (18.99065,    75.74501  ),   # Balaji South Indian Foods
    95606: (18.99725,    75.75719  ),   # Ambika Bhek and Pani Puri
    88411: (18.9951,     75.75414  ),   # Sagar Executive
    85743: (18.999014,   75.75493  ),   # Hotel Anvita
    85393: (18.98961,    75.75589  ),   # Hotel Rajlaxmi
    85599: (18.9856,     75.74878  ),   # GoodLuck Family Restaurant
    86170: (18.9951,     75.75414  ),   # Green Court
    85789: (18.99037,    75.75005  ),   # Hotel Neelkamal
    85567: (18.99409,    75.754    ),   # Hotel Tuljabhawani
    85982: (18.99489,    75.75793  ),   # MACKK N CHEESE CAFE
    85967: (18.98976,    75.74484  ),   # Olive Veg Restaurant
    85404: (18.98961,    75.75589  ),   # Hotel Tuljai biryani
    85591: (18.9875691,  75.7487955),   # Chotu Vadapav
    85562: (18.99434,    75.75476  ),   # Hotel Tuljabhavani Rooftop
    85578: (18.99464,    75.7545   ),   # Barbie's Pizza
    85780: (18.98961,    75.75589  ),   # Hatke Vada
    85991: (18.99551,    75.75784  ),   # Star Queen Cafe
    85784: (18.9955,     75.75662  ),   # The Shrikhand Studio
    86196: (18.99489,    75.75793  ),   # Shree Swami Samarth Bhojnalaya
    90460: (18.99155,    75.74138  ),   # Copisa Fast Food
    94728: (18.990509,   75.745069 ),   # Shree Samarth Food Gallary
    68246: (18.9914391,  75.7459457),   # Daily Essentials (Grocery)
}


def seed():
    db = SessionLocal()
    try:
        updated, skipped = 0, []
        for shop_id, (lat, lng) in VENDOR_LOCATIONS.items():
            vendor = db.query(Vendor).filter(Vendor.vendor_id == str(shop_id)).first()
            if vendor:
                vendor.latitude  = lat
                vendor.longitude = lng
                updated += 1
                print(f"  OK  {shop_id:>6}  {vendor.vendor_name}")
            else:
                skipped.append(shop_id)
                print(f"  --  {shop_id:>6}  (not in DB — will be seeded when vendors are synced)")

        db.commit()
        print(f"\nDone: {updated} updated, {len(skipped)} not yet in DB")
        if skipped:
            print(f"  Skipped IDs: {skipped}")
    finally:
        db.close()


if __name__ == "__main__":
    seed()
