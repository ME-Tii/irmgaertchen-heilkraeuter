import os
import json
import time
import secrets
import hmac
import hashlib

import stripe
from flask import Flask, jsonify, request, send_from_directory
from werkzeug.security import generate_password_hash, check_password_hash

import db
from products import shipping_fee_cents
import mailer


def load_env():
    env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
    if os.path.exists(env_path):
        with open(env_path) as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, value = line.partition("=")
                os.environ.setdefault(key.strip(), value.strip())


load_env()

STRIPE_SECRET_KEY = os.environ.get("STRIPE_SECRET_KEY")
STRIPE_WEBHOOK_SECRET = os.environ.get("STRIPE_WEBHOOK_SECRET", "")
DOMAIN = os.environ.get("DOMAIN", "http://localhost:5000")
PORT = int(os.environ.get("PORT", "5000"))
ADMIN_USERNAME = os.environ.get("IRM_ADMIN_USERNAME", "admin")
ADMIN_PASSWORD = os.environ.get("IRM_ADMIN_PASSWORD", "")

stripe.api_key = STRIPE_SECRET_KEY

SHOP_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
IMG_DIR = os.path.join(SHOP_DIR, "assets", "img")
ALLOWED_IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp", ".gif"}

app = Flask(__name__, static_folder=SHOP_DIR, static_url_path="")

db.init_db()

ORDER_STATUSES = ["Eingegangen", "In Bearbeitung", "Bereit zur Abholung", "Versandt", "Abgeschlossen"]


def ensure_admin():
    if not ADMIN_PASSWORD:
        return
    if not db.get_user_by_username(ADMIN_USERNAME):
        db.create_user(ADMIN_USERNAME, "admin@irmgaertchen.de", generate_password_hash(ADMIN_PASSWORD))
        db.set_admin_role(ADMIN_USERNAME)


ensure_admin()


# ---------------------------------------------------------------- helpers

def bearer_token():
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        return auth[7:].strip()
    return ""


def require_auth():
    user = db.get_user_by_token(bearer_token()) if bearer_token() else None
    if not user:
        return None
    return user


def require_admin():
    user = require_auth()
    if not user:
        return {"error": "Nicht angemeldet.", "code": 401}
    if user["role"] != "admin":
        return {"error": "Nur für den Administrator.", "code": 403}
    return user


def err(msg, code):
    return jsonify({"error": msg}), code


def order_to_dict(order):
    d = dict(order)
    d["items"] = json.loads(order.get("items_json") or "[]")
    d["subtotal"] = round(d["subtotal_cents"] / 100, 2)
    d["shipping"] = round(d["shipping_cents"] / 100, 2)
    d["total"] = round(d["total_cents"] / 100, 2)
    d["delivery"] = {
        "method": d["delivery_method"],
        "street": d["delivery_street"],
        "zip": d["delivery_zip"],
        "city": d["delivery_city"],
    }
    d.pop("items_json", None)
    d.pop("subtotal_cents", None)
    d.pop("shipping_cents", None)
    d.pop("total_cents", None)
    d.pop("delivery_method", None)
    d.pop("delivery_street", None)
    d.pop("delivery_zip", None)
    d.pop("delivery_city", None)
    d["customerConfirmed"] = bool(d.pop("customer_confirmed"))
    d["customerConfirmedAt"] = d.pop("customer_confirmed_at")
    d["returnRequested"] = bool(d.pop("return_requested"))
    d["returnReason"] = d.pop("return_reason")
    d["returnProcessed"] = bool(d.pop("return_processed"))
    d["refunded"] = bool(d.pop("refunded"))
    d["refundedAt"] = d.pop("refunded_at")
    d["stripeRefundId"] = d.pop("stripe_refund_id")
    return d


def gen_order_no():
    return "IG-" + str(int(time.time() * 1000))[-7:]


@app.after_request
def add_cors_headers(response):
    origin = request.headers.get("Origin", "")
    if origin:
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Vary"] = "Origin"
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, PATCH, DELETE, OPTIONS"
        response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
    return response


# ---------------------------------------------------------------- static

@app.get("/")
def index():
    return send_from_directory(SHOP_DIR, "index.html")


# ---------------------------------------------------------------- auth

@app.post("/api/register")
def register():
    data = request.get_json(silent=True) or {}
    username = (data.get("username") or "").strip()
    email = (data.get("email") or "").strip()
    password = data.get("password") or ""
    if not username or len(password) < 6:
        return err("Bitte Benutzername und ein Passwort mit mindestens 6 Zeichen angeben.", 400)
    if db.get_user_by_username(username):
        return err("Dieser Benutzername ist bereits vergeben.", 400)
    user_id = db.create_user(username, email, generate_password_hash(password))
    token = secrets.token_hex(32)
    db.create_session(token, user_id)
    return jsonify({"token": token, "username": username, "email": email})


@app.post("/api/login")
def login():
    data = request.get_json(silent=True) or {}
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""
    user = db.get_user_by_username(username)
    if not user or not check_password_hash(user["password_hash"], password):
        return err("Benutzername oder Passwort ist falsch.", 401)
    token = secrets.token_hex(32)
    db.create_session(token, user["id"])
    return jsonify(
        {
            "token": token,
            "username": user["username"],
            "email": user["email"],
            "name": user["name"],
            "phone": user["phone"],
            "role": user["role"],
        }
    )


@app.post("/api/logout")
def logout():
    token = bearer_token()
    if token:
        db.delete_session(token)
    return jsonify({"ok": True})


def msg_to_dict(m):
    d = dict(m)
    d["read"] = bool(d.pop("read"))
    d["createdAt"] = d.pop("created_at")
    return d


@app.post("/api/contact")
def contact():
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    email = (data.get("email") or "").strip()
    message = (data.get("message") or "").strip()
    if not name or not email or not message:
        return err("Bitte Name, E-Mail und Nachricht angeben.", 400)
    user = require_auth()
    db.create_contact_message(name, email, message, user["id"] if user else None)
    mailer.notify_admin_contact(name, email, message)
    return jsonify({"ok": True})


@app.get("/api/me")
def me():
    user = require_auth()
    if not user:
        return err("Nicht angemeldet.", 401)
    return jsonify(
        {
            "username": user["username"],
            "email": user["email"],
            "name": user["name"],
            "phone": user["phone"],
            "role": user["role"],
        }
    )


@app.put("/api/me")
def update_me():
    user = require_auth()
    if not user:
        return err("Nicht angemeldet.", 401)
    data = request.get_json(silent=True) or {}
    db.update_profile(
        user["id"],
        (data.get("name") or "").strip(),
        (data.get("email") or "").strip(),
        (data.get("phone") or "").strip(),
    )
    return jsonify({"ok": True})


# ---------------------------------------------------------------- products (public)

@app.get("/api/products")
def products():
    out = []
    for p in db.list_products():
        out.append(
            {
                "id": p["slug"],
                "name": p["name"],
                "category": p["category"],
                "price": round(p["price_cents"] / 100, 2),
                "desc": p["desc"] or "",
                "image": p["image"] or "",
                "stock": p["stock"],
                "custom": bool(p["custom"]),
            }
        )
    return jsonify({"products": out})


# ---------------------------------------------------------------- checkout

@app.route("/api/create-checkout-session", methods=["POST", "OPTIONS"])
def create_checkout_session():
    if request.method == "OPTIONS":
        return "", 204
    if not STRIPE_SECRET_KEY:
        return err("STRIPE_SECRET_KEY nicht gesetzt. Siehe server/README.md.", 500)
    user = require_auth()
    if not user:
        return err("Bitte melden Sie sich an, um zu bestellen.", 401)

    data = request.get_json(silent=True) or {}
    cart = data.get("cart") or []
    if not isinstance(cart, list) or not cart:
        return err("Warenkorb ist leer.", 400)

    delivery = bool(data.get("delivery"))
    addr = data.get("shipping_address") or {}

    line_items = []
    resolved = []
    subtotal_cents = 0
    for item in cart:
        slug = item.get("id")
        qty = int(item.get("qty", 1))
        product = db.get_product(slug)
        if not product or not product["visible"]:
            return err(f"Unbekannter Artikel: {slug}", 400)
        if qty < 1:
            return err("Menge muss mindestens 1 sein.", 400)
        if product["stock"] is not None and product["stock"] < qty:
            return err(f"{product['name']} ist nicht mehr in dieser Menge verfügbar.", 400)
        line_total = product["price_cents"] * qty
        subtotal_cents += line_total
        resolved.append(
            {
                "id": slug,
                "name": product["name"],
                "qty": qty,
                "price": round(product["price_cents"] / 100, 2),
                "total": round(line_total / 100, 2),
            }
        )
        line_items.append(
            {
                "price_data": {
                    "currency": "eur",
                    "product_data": {"name": product["name"]},
                    "unit_amount": product["price_cents"],
                },
                "quantity": qty,
            }
        )

    shipping_cents = shipping_fee_cents(subtotal_cents) if delivery else 0
    if shipping_cents:
        line_items.append(
            {
                "price_data": {
                    "currency": "eur",
                    "product_data": {"name": "Versand (Post)"},
                    "unit_amount": shipping_cents,
                },
                "quantity": 1,
            }
        )

    order_no = gen_order_no()
    order = {
        "order_no": order_no,
        "user_id": user["id"],
        "items": resolved,
        "subtotal_cents": subtotal_cents,
        "shipping_cents": shipping_cents,
        "total_cents": subtotal_cents + shipping_cents,
        "delivery_method": "delivery" if delivery else "pickup",
        "delivery_street": addr.get("street", "") if delivery else "",
        "delivery_zip": addr.get("zip", "") if delivery else "",
        "delivery_city": addr.get("city", "") if delivery else "",
        "status": "Zahlung ausstehend",
    }
    db.create_order(order)

    session_kwargs = {
        "mode": "payment",
        "line_items": line_items,
        "success_url": f"{DOMAIN}/bestellung-erfolgreich.html?session_id={{CHECKOUT_SESSION_ID}}",
        "cancel_url": f"{DOMAIN}/cart.html?status=cancel",
        "metadata": {"source": "irmgaertchen_shop", "order_no": order_no},
        "customer_email": user["email"] or None,
    }
    if delivery:
        session_kwargs["shipping_address_collection"] = {"allowed_countries": ["DE"]}

    try:
        session = stripe.checkout.Session.create(**session_kwargs)
    except stripe.StripeError as e:
        return err(str(e), 400)

    db.update_order(order_no, {"stripe_session_id": session.id})
    return jsonify({"url": session.url})


# ---------------------------------------------------------------- webhook

def _verify_webhook(payload, sig_header):
    if not STRIPE_WEBHOOK_SECRET:
        return None
    try:
        return stripe.Webhook.construct_event(payload, sig_header, STRIPE_WEBHOOK_SECRET)
    except stripe.error.SignatureVerificationError:
        return False


@app.post("/api/stripe/webhook")
def stripe_webhook():
    payload = request.get_data()
    sig_header = request.headers.get("Stripe-Signature", "")
    if STRIPE_WEBHOOK_SECRET:
        event = _verify_webhook(payload, sig_header)
        if event is False:
            return err("Webhook-Signatur ungültig.", 400)
    else:
        event = json.loads(payload or "{}")

    if not isinstance(event, dict):
        event = event.to_dict()

    etype = event.get("type")
    obj = event.get("data", {}).get("object", {})

    if etype == "checkout.session.completed":
        session_id = obj.get("id")
        order_no = (obj.get("metadata") or {}).get("order_no")
        order = db.get_order(order_no) if order_no else db.get_order_by_session(session_id)
        if order:
            order = order_to_dict(order)
        if order and order["status"] == "Zahlung ausstehend":
            db.update_order(
                order["order_no"],
                {
                    "status": "Eingegangen",
                    "stripe_session_id": session_id,
                    "stripe_payment_intent": obj.get("payment_intent"),
                },
            )
            db.decrement_stock(order["items"])
            user = db.get_user_by_id(order["user_id"]) if order["user_id"] else None
            mailer.notify_admin_order(
                order["order_no"],
                f"{order['total']:.2f}".replace(".", ","),
                "Versand an " + order["delivery"]["street"] if order["delivery"]["method"] == "delivery" else "Abholung",
            )
            if user:
                mailer.notify_customer_order(user["email"], order["order_no"], f"{order['total']:.2f} EUR")
        return jsonify({"received": True})

    if etype == "charge.refunded":
        refund = obj
        pi_id = refund.get("payment_intent")
        order = db.get_order_by_payment_intent(pi_id) if pi_id else None
        if not order and pi_id:
            for candidate in db.list_all_orders():
                if candidate["stripe_session_id"]:
                    try:
                        session = stripe.checkout.Session.retrieve(candidate["stripe_session_id"])
                        if getattr(session, "payment_intent", None) == pi_id:
                            order = candidate
                            break
                    except stripe.StripeError:
                        continue
        if order and not order["refunded"]:
            db.update_order(
                order["order_no"],
                {
                    "refunded": 1,
                    "refunded_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    "stripe_refund_id": refund.get("id"),
                },
            )
        return jsonify({"received": True})

    return jsonify({"received": True, "ignored": True})


# ---------------------------------------------------------------- customer orders

@app.get("/api/orders")
def my_orders():
    user = require_auth()
    if not user:
        return err("Nicht angemeldet.", 401)
    return jsonify({"orders": [order_to_dict(o) for o in db.list_orders_for_user(user["id"])]})


@app.get("/api/orders/session/<session_id>")
def order_by_session(session_id):
    user = require_auth()
    if not user:
        return err("Nicht angemeldet.", 401)
    order = db.get_order_by_session(session_id)
    if not order or order["user_id"] != user["id"]:
        return err("Bestellung nicht gefunden.", 404)
    return jsonify({"order": order_to_dict(order)})


@app.post("/api/orders/confirm")
def confirm_order():
    user = require_auth()
    if not user:
        return err("Nicht angemeldet.", 401)
    data = request.get_json(silent=True) or {}
    order = db.get_order(data.get("order_no") or "")
    if not order or order["user_id"] != user["id"]:
        return err("Bestellung nicht gefunden.", 404)
    db.update_order(
        order["order_no"],
        {"customer_confirmed": 1, "customer_confirmed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())},
    )
    return jsonify({"ok": True})


@app.post("/api/orders/return")
def request_return():
    user = require_auth()
    if not user:
        return err("Nicht angemeldet.", 401)
    data = request.get_json(silent=True) or {}
    order = db.get_order(data.get("order_no") or "")
    if not order or order["user_id"] != user["id"]:
        return err("Bestellung nicht gefunden.", 404)
    db.update_order(
        order["order_no"],
        {"return_requested": 1, "return_reason": (data.get("reason") or "").strip()},
    )
    return jsonify({"ok": True})


# ---------------------------------------------------------------- admin

def _admin_ok(user):
    if isinstance(user, dict) and "error" in user:
        return err(user["error"], user.get("code", 403))
    return None


@app.get("/api/admin/orders")
def admin_orders():
    bad = _admin_ok(require_admin())
    if bad:
        return bad
    out = []
    for o in db.list_all_orders():
        d = order_to_dict(o)
        user = db.get_user_by_id(o["user_id"]) if o["user_id"] else None
        d["user"] = user["username"] if user else ""
        out.append(d)
    return jsonify({"orders": out})


@app.patch("/api/admin/orders/<order_no>")
def admin_update_order(order_no):
    bad = _admin_ok(require_admin())
    if bad:
        return bad
    data = request.get_json(silent=True) or {}
    order = db.get_order(order_no)
    if not order:
        return err("Bestellung nicht gefunden.", 404)
    if "status" in data:
        db.update_order(order_no, {"status": data["status"]})
        user = db.get_user_by_id(order["user_id"]) if order["user_id"] else None
        if user:
            mailer.notify_customer_status(user["email"], order_no, data["status"])
    return jsonify({"ok": True})


@app.post("/api/admin/orders/<order_no>/return-done")
def admin_return_done(order_no):
    bad = _admin_ok(require_admin())
    if bad:
        return bad
    order = db.get_order(order_no)
    if not order:
        return err("Bestellung nicht gefunden.", 404)
    db.update_order(order_no, {"return_processed": 1})
    return jsonify({"ok": True})


@app.post("/api/admin/orders/<order_no>/refund")
def admin_refund(order_no):
    bad = _admin_ok(require_admin())
    if bad:
        return bad
    if not STRIPE_SECRET_KEY:
        return err("STRIPE_SECRET_KEY nicht gesetzt.", 500)
    order = db.get_order(order_no)
    if not order:
        return err("Bestellung nicht gefunden.", 404)
    if order["refunded"]:
        return err("Bestellung bereits erstattet.", 400)
    if not order["stripe_session_id"]:
        return err("Keine Zahlungsreferenz für diese Bestellung.", 400)
    try:
        payment_intent = order.get("stripe_payment_intent")
        if not payment_intent and order["stripe_session_id"]:
            session = stripe.checkout.Session.retrieve(order["stripe_session_id"])
            payment_intent = getattr(session, "payment_intent", None)
        if not payment_intent:
            return err("Für diese Bestellung wurde keine Zahlung gefunden.", 400)
        refund = stripe.Refund.create(payment_intent=payment_intent)
    except stripe.StripeError as e:
        return err(str(e), 400)
    db.update_order(
        order_no,
        {
            "refunded": 1,
            "refunded_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "stripe_refund_id": refund.id,
        },
    )
    return jsonify({"ok": True, "refund_id": refund.id, "amount": refund.amount})


@app.delete("/api/admin/orders/<order_no>")
def admin_delete_order(order_no):
    bad = _admin_ok(require_admin())
    if bad:
        return bad
    order = db.get_order(order_no)
    if not order:
        return err("Bestellung nicht gefunden.", 404)
    if order["status"] != "Zahlung ausstehend":
        db.restore_stock(json.loads(order.get("items_json") or "[]"))
    db.delete_order(order_no)
    return jsonify({"ok": True})


@app.get("/api/admin/messages")
def admin_messages():
    bad = _admin_ok(require_admin())
    if bad:
        return bad
    return jsonify({"messages": [msg_to_dict(m) for m in db.list_contact_messages()]})


@app.post("/api/admin/messages/<int:message_id>/read")
def admin_message_read(message_id):
    bad = _admin_ok(require_admin())
    if bad:
        return bad
    db.mark_contact_message_read(message_id)
    return jsonify({"ok": True})


@app.delete("/api/admin/messages/<int:message_id>")
def admin_delete_message(message_id):
    bad = _admin_ok(require_admin())
    if bad:
        return bad
    db.delete_contact_message(message_id)
    return jsonify({"ok": True})


@app.get("/api/admin/products")
def admin_products():
    bad = _admin_ok(require_admin())
    if bad:
        return bad
    out = []
    for p in db.admin_list_products():
        out.append(
            {
                "id": p["slug"],
                "name": p["name"],
                "category": p["category"],
                "price": round(p["price_cents"] / 100, 2),
                "desc": p["desc"] or "",
                "image": p["image"] or "",
                "stock": p["stock"],
                "custom": bool(p["custom"]),
                "visible": bool(p["visible"]),
            }
        )
    return jsonify({"products": out})


@app.post("/api/admin/products")
def admin_add_product():
    bad = _admin_ok(require_admin())
    if bad:
        return bad
    data = request.get_json(silent=True) or {}
    slug = (data.get("id") or "").strip().lower().replace(" ", "-")
    name = (data.get("name") or "").strip()
    if not slug or not name:
        return err("Bitte Name und Artikel-ID angeben.", 400)
    try:
        price_cents = int(round(float(data.get("price", 0)) * 100))
    except (TypeError, ValueError):
        return err("Ungültiger Preis.", 400)
    if db.get_product(slug):
        return err("Diese Artikel-ID existiert bereits.", 400)
    stock = data.get("stock")
    db.add_product(slug, name, (data.get("category") or "Sonstiges").strip(), price_cents, stock, (data.get("desc") or "").strip(), (data.get("image") or "").strip())
    return jsonify({"ok": True})


@app.patch("/api/admin/products/<slug>")
def admin_update_product(slug):
    bad = _admin_ok(require_admin())
    if bad:
        return bad
    data = request.get_json(silent=True) or {}
    product = db.get_product(slug)
    if not product:
        return err("Produkt nicht gefunden.", 404)
    name = (data.get("name") or product["name"]).strip()
    category = (data.get("category") or product["category"]).strip()
    price_cents = int(round(float(data.get("price", product["price_cents"] / 100)) * 100))
    stock = data["stock"] if "stock" in data else product["stock"]
    desc = (data.get("desc") if data.get("desc") is not None else product.get("desc") or "").strip()
    image = (data.get("image") if data.get("image") is not None else product.get("image") or "").strip()
    db.update_product(slug, name, category, price_cents, stock, desc, image)
    return jsonify({"ok": True})


@app.post("/api/admin/products/<slug>/image")
def admin_upload_product_image(slug):
    bad = _admin_ok(require_admin())
    if bad:
        return bad
    product = db.get_product(slug)
    if not product:
        return err("Produkt nicht gefunden.", 404)
    file = request.files.get("file")
    if not file or not file.filename:
        return err("Keine Datei angehängt.", 400)
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in ALLOWED_IMAGE_EXT:
        return err("Nur JPG, PNG, WebP oder GIF erlaubt.", 400)
    if file.content_length and file.content_length > 3 * 1024 * 1024:
        return err("Bild zu groß (max. 3 MB).", 400)
    filename = slug + ext
    os.makedirs(IMG_DIR, exist_ok=True)
    file.save(os.path.join(IMG_DIR, filename))
    db.set_product_image(slug, filename)
    return jsonify({"ok": True, "image": filename})


@app.delete("/api/admin/products/<slug>")
def admin_delete_product(slug):
    bad = _admin_ok(require_admin())
    if bad:
        return bad
    db.delete_product(slug)
    return jsonify({"ok": True})


# ---------------------------------------------------------------- misc

@app.get("/api/health")
def health():
    return jsonify(
        {
            "ok": True,
            "stripe_ready": bool(STRIPE_SECRET_KEY),
            "db": os.environ.get("DATABASE_URL", "").strip() or db.DB_PATH,
        }
    )


if __name__ == "__main__":
    print(f"Irmgaertchen Shop Backend auf http://localhost:{PORT} (Shop: {DOMAIN})")
    app.run(host="127.0.0.1", port=PORT, debug=os.environ.get("FLASK_DEBUG") == "1")
