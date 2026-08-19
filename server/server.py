import os
import io
import json
import time
import calendar
import secrets
import hmac
import hashlib
import re
import base64
import threading
import zipfile
from urllib.parse import quote, urlencode
from xml.sax.saxutils import escape

import requests


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

import stripe
from flask import Flask, Response, jsonify, request, redirect, render_template, send_from_directory
from werkzeug.security import generate_password_hash, check_password_hash

import db
from products import shipping_fee_cents
import mailer
from invoice import generate_invoice_pdf


STRIPE_SECRET_KEY = os.environ.get("STRIPE_SECRET_KEY")
STRIPE_WEBHOOK_SECRET = os.environ.get("STRIPE_WEBHOOK_SECRET", "")
DOMAIN = os.environ.get("DOMAIN", "http://localhost:5000")
PORT = int(os.environ.get("PORT", "5000"))
ADMIN_USERNAME = os.environ.get("IRM_ADMIN_USERNAME", "admin")
ADMIN_PASSWORD = os.environ.get("IRM_ADMIN_PASSWORD", "")
GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET", "")

stripe.api_key = STRIPE_SECRET_KEY

SHOP_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SERVER_DIR = os.path.dirname(os.path.abspath(__file__))
IMG_DIR = os.path.join(SHOP_DIR, "assets", "img")
ALLOWED_IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp", ".gif"}

SITE_URL = DOMAIN.rstrip("/")
GOOGLE_REDIRECT_URI = f"{SITE_URL}/api/auth/google/callback"

app = Flask(
    __name__,
    static_folder=SHOP_DIR,
    static_url_path="",
    template_folder=os.path.join(SERVER_DIR, "templates"),
)

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


def _client_ip():
    xff = request.headers.get("X-Forwarded-For", "")
    if xff:
        return xff.split(",")[0].strip()
    return request.remote_addr or "unknown"


EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
SAFE_FILENAME_RE = re.compile(r"^[A-Za-z0-9._-]+$")
SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


def _is_valid_email(email):
    return bool(EMAIL_RE.match(email)) and len(email) <= 254


def _clean_text(value, max_len):
    value = (value or "").strip()
    return value.replace("\x00", "")[:max_len]


# ---------------------------------------------------------------- rate limiting

# Einfacher In-Memory-Limiter (pro Prozess; gunicorn: mehrere Worker => Grenze je Worker).
_rate_lock = threading.Lock()
_rate_hits = {}


def _rate_limit(bucket, limit, window):
    global _rate_hits
    now = time.time()
    key = (bucket, _client_ip())
    with _rate_lock:
        hits = [t for t in _rate_hits.get(key, []) if now - t < window]
        if len(hits) >= limit:
            _rate_hits[key] = hits
            return False
        hits.append(now)
        _rate_hits[key] = hits
        if len(_rate_hits) > 10000:
            cutoff = now - max(window, 3600)
            _rate_hits = {k: [t for t in v if t > cutoff] for k, v in _rate_hits.items()}
        return True


def _parse_price_cents(raw):
    try:
        val = float(raw)
        if not val or val != val or val in (float("inf"), float("-inf")):
            return None
        cents = int(round(val * 100))
    except (TypeError, ValueError, OverflowError):
        return None
    if cents < 0 or cents > 10_000_000_000:
        return None
    return cents


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


@app.errorhandler(404)
def handle_404(e):
    if request.path.startswith("/api/"):
        return err("Ressource nicht gefunden.", 404)
    return e


@app.errorhandler(500)
def handle_500(e):
    app.logger.exception("Interner Serverfehler bei %s", request.path)
    if request.path.startswith("/api/"):
        return err("Interner Serverfehler.", 500)
    raise e


@app.after_request
def track_page_view(response):
    path = request.path
    if (
        request.method == "GET"
        and not path.startswith("/api/")
        and not path.startswith("/assets/")
        and path not in ("/admin.html", "/admin", "/robots.txt", "/sitemap.xml", "/favicon.ico")
        and response.status_code < 400
    ):
        try:
            db.record_view(path)
            visitor_id = request.cookies.get("irm_visitor", "")
            if not visitor_id:
                visitor_id = secrets.token_urlsafe(16)
                response.set_cookie(
                    "irm_visitor",
                    visitor_id,
                    max_age=63072000,
                    path="/",
                    httponly=True,
                    samesite="Lax",
                    secure=request.is_secure,
                )
            day = time.strftime("%Y-%m-%d", time.gmtime())
            db.record_visitor(visitor_id, day)
        except Exception:
            pass
    return response


def order_to_dict(order):
    d = dict(order)
    d["items"] = json.loads(order.get("items_json") or "[]")
    d["subtotal"] = round(d["subtotal_cents"] / 100, 2)
    d["shipping"] = round(d["shipping_cents"] / 100, 2)
    d["discount"] = round((d.get("discount_cents") or 0) / 100, 2)
    d["couponCode"] = d.get("coupon_code") or ""
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
    d.pop("discount_cents", None)
    d.pop("total_cents", None)
    d.pop("coupon_code", None)
    d.pop("delivery_method", None)
    d.pop("delivery_street", None)
    d.pop("delivery_zip", None)
    d.pop("delivery_city", None)
    d["customerConfirmed"] = bool(d.pop("customer_confirmed"))
    d["customerConfirmedAt"] = d.pop("customer_confirmed_at")
    d["customerName"] = d.pop("customer_name", "") or ""
    d["customerEmail"] = d.pop("customer_email", "") or ""
    d["customerPhone"] = d.pop("customer_phone", "") or ""
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
def add_security_headers(response):
    if request.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; "
        "script-src 'self' https://cdn.jsdelivr.net 'unsafe-inline'; "
        "style-src 'self' https://cdn.jsdelivr.net 'unsafe-inline'; "
        "img-src 'self' data:; "
        "font-src 'self' https://cdn.jsdelivr.net; "
        "connect-src 'self'; "
        "object-src 'none'; "
        "base-uri 'self'; "
        "form-action 'self'; "
        "frame-ancestors 'none'"
    )
    if request.is_secure:
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    return response


@app.after_request
def add_cors_headers(response):
    origin = request.headers.get("Origin", "")
    if not origin:
        return response
    allowed = {SITE_URL, f"https://{request.host}", f"http://{request.host}"}
    if origin not in allowed:
        return response
    response.headers["Access-Control-Allow-Origin"] = origin
    response.headers["Vary"] = "Origin"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, PATCH, DELETE, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
    return response


# ---------------------------------------------------------------- static

@app.get("/")
def index():
    return send_from_directory(SHOP_DIR, "index.html")


# ---------------------------------------------------------------- SEO

DEFAULT_PRODUCT_IMAGES = {
    "salbei": "salbei.jpg",
    "thymian": "thymian.jpg",
    "rosmarin": "rosmarin.jpg",
    "melisse": "melisse.jpg",
    "kamille": "kamille.jpg",
    "lavendel": "lavendel.jpg",
    "minze": "minze.jpg",
    "basilikum": "basilikum.jpg",
    "salbeitee": "kraeutertee.jpg",
    "kamillentee": "kamille.jpg",
    "minztee": "minze.jpg",
    "melissentee": "melisse.jpg",
    "kraeuterbuendel": "kraeuterbuendel.jpg",
    "ringelblume": "ringelblume.jpg",
    "kapuzinerkresse": "kapuzinerkresse.jpg",
}

SITEMAP_PAGES = [
    ("", "1.0", "daily"),
    ("shop.html", "0.9", "daily"),
    ("ueber-uns.html", "0.7", "monthly"),
    ("kontakt.html", "0.6", "monthly"),
    ("impressum.html", "0.2", "yearly"),
    ("datenschutz.html", "0.2", "yearly"),
    ("agb.html", "0.2", "yearly"),
]


def default_product_image(product):
    if product.get("image"):
        return product["image"]
    return DEFAULT_PRODUCT_IMAGES.get(product["slug"], "kraeutergarten.jpg")


@app.get("/robots.txt")
def robots_txt():
    body = (
        "User-agent: *\n"
        "Allow: /\n"
        "Disallow: /api/\n"
        "Disallow: /admin.html\n"
        "Disallow: /cart.html\n"
        "Disallow: /konto.html\n"
        "Disallow: /bestellung-erfolgreich.html\n"
        "Disallow: /forgot-password.html\n"
        f"Sitemap: {SITE_URL}/sitemap.xml\n"
    )
    return Response(body, mimetype="text/plain")


@app.get("/sitemap.xml")
def sitemap_xml():
    entries = []
    for path, priority, changefreq in SITEMAP_PAGES:
        entries.append(
            f"  <url>\n"
            f"    <loc>{escape(SITE_URL + '/' + path)}</loc>\n"
            f"    <changefreq>{changefreq}</changefreq>\n"
            f"    <priority>{priority}</priority>\n"
            f"  </url>"
        )
    for p in db.list_products():
        loc = escape(f"{SITE_URL}/produkt/{p['slug']}")
        entries.append(
            f"  <url>\n"
            f"    <loc>{loc}</loc>\n"
            f"    <changefreq>weekly</changefreq>\n"
            f"    <priority>0.7</priority>\n"
            f"  </url>"
        )
    xml = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        + "\n".join(entries)
        + "\n</urlset>\n"
    )
    return Response(xml, mimetype="application/xml")


@app.get("/produkt/<slug>")
def product_page(slug):
    product = db.get_product(slug)
    if not product or not product["visible"]:
        return "Produkt nicht gefunden.", 404
    image = default_product_image(product)
    return render_template(
        "product.html",
        site_url=SITE_URL,
        product=product,
        image=image,
        price="{:,.2f}".format(product["price_cents"] / 100).replace(",", "X").replace(".", ",").replace("X", "."),
    )


# ---------------------------------------------------------------- auth

# ---------------------------------------------------------------- Google-Login

def _google_oauth_url(state):
    params = {
        "client_id": GOOGLE_CLIENT_ID,
        "redirect_uri": GOOGLE_REDIRECT_URI,
        "response_type": "code",
        "scope": "openid email profile",
        "access_type": "online",
        "prompt": "select_account",
        "state": state,
    }
    return "https://accounts.google.com/o/oauth2/v2/auth?" + urlencode(params)


def _google_fetch_userinfo(code):
    try:
        tok = requests.post(
            "https://oauth2.googleapis.com/token",
            data={
                "code": code,
                "client_id": GOOGLE_CLIENT_ID,
                "client_secret": GOOGLE_CLIENT_SECRET,
                "redirect_uri": GOOGLE_REDIRECT_URI,
                "grant_type": "authorization_code",
            },
            timeout=10,
        ).json()
        access_token = tok.get("access_token")
        if not access_token:
            return None
        info = requests.get(
            "https://www.googleapis.com/oauth2/v2/userinfo",
            headers={"Authorization": "Bearer " + access_token},
            timeout=10,
        ).json()
        if not info.get("id") or not info.get("verified_email"):
            return None
        return info
    except (requests.RequestException, ValueError):
        return None


def _unique_google_username(email):
    base = re.sub(r"[^a-z0-9._-]+", "", (email.split("@")[0] or "user").lower())[:30] or "user"
    candidate, i = base, 1
    while db.get_user_by_username(candidate):
        i += 1
        candidate = f"{base}{i}"
    return candidate


@app.get("/api/auth/google")
def auth_google():
    if not GOOGLE_CLIENT_ID or not GOOGLE_CLIENT_SECRET:
        return err("Google-Anmeldung ist nicht konfiguriert.", 500)
    state = secrets.token_urlsafe(32)
    resp = redirect(_google_oauth_url(state))
    resp.set_cookie(
        "google_oauth_state",
        state,
        max_age=600,
        httponly=True,
        samesite="Lax",
        secure=request.is_secure,
    )
    return resp


@app.get("/api/auth/google/callback")
def auth_google_callback():
    target = f"{SITE_URL}/konto.html"

    def clear(resp):
        resp.delete_cookie("google_oauth_state", path="/")
        return resp

    if request.args.get("error"):
        return clear(redirect(f"{target}#google_error=access_denied"))
    state = request.args.get("state", "")
    if not state or not hmac.compare_digest(state, request.cookies.get("google_oauth_state", "")):
        return clear(redirect(f"{target}#google_error=invalid_state"))
    info = _google_fetch_userinfo(request.args.get("code", ""))
    if not info:
        return clear(redirect(f"{target}#google_error=oauth_failed"))
    email = (info.get("email") or "").lower()
    if not _is_valid_email(email):
        return clear(redirect(f"{target}#google_error=no_email"))
    user = db.get_user_by_email_ci(email)
    if not user:
        user_id = db.create_user(
            _unique_google_username(email), email, generate_password_hash(secrets.token_urlsafe(32))
        )
        user = db.get_user_by_id(user_id)
        name = _clean_text(info.get("name"), 100)
        if name:
            db.update_profile(user["id"], name, email, "")
    token = secrets.token_hex(32)
    db.create_session(token, user["id"])
    fragment = f"google_token={token}&google_user={quote(user['username'])}"
    return clear(redirect(f"{target}#{fragment}"))


@app.post("/api/register")
def register():
    if not _rate_limit("register", 5, 3600):
        return err("Zu viele Registrierungen. Bitte später erneut versuchen.", 429)
    data = request.get_json(silent=True) or {}
    username = _clean_text(data.get("username"), 50)
    email = _clean_text(data.get("email"), 254)
    password = data.get("password") or ""
    if not username or len(password) < 6:
        return err("Bitte Benutzername und ein Passwort mit mindestens 6 Zeichen angeben.", 400)
    if len(password) > 128:
        return err("Das Passwort ist zu lang.", 400)
    if email and not _is_valid_email(email):
        return err("Bitte eine gültige E-Mail-Adresse angeben.", 400)
    if db.get_user_by_username(username):
        return err("Dieser Benutzername ist bereits vergeben.", 400)
    newsletter = 1 if data.get("newsletter") else 0
    user_id = db.create_user(username, email, generate_password_hash(password), newsletter)
    token = secrets.token_hex(32)
    db.create_session(token, user_id)
    return jsonify({"token": token, "username": username, "email": email})


@app.post("/api/login")
def login():
    if not _rate_limit("login", 10, 300):
        return err("Zu viele Anmeldeversuche. Bitte kurz warten.", 429)
    data = request.get_json(silent=True) or {}
    username = _clean_text(data.get("username"), 50)
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
    if not _rate_limit("contact", 5, 600):
        return err("Zu viele Nachrichten. Bitte später erneut versuchen.", 429)
    data = request.get_json(silent=True) or {}
    name = _clean_text(data.get("name"), 100)
    email = _clean_text(data.get("email"), 254)
    message = _clean_text(data.get("message"), 2000)
    if not name or not email or not message:
        return err("Bitte Name, E-Mail und Nachricht angeben.", 400)
    if not _is_valid_email(email):
        return err("Bitte eine gültige E-Mail-Adresse angeben.", 400)
    user = require_auth()
    db.create_contact_message(name, email, message, user["id"] if user else None)
    mailer.notify_admin_contact(name, email, message)
    return jsonify({"ok": True})


@app.post("/api/coupon/validate")
def coupon_validate():
    data = request.get_json(silent=True) or {}
    code = _clean_text(data.get("code"), 30)
    subtotal = int(data.get("subtotal_cents") or 0)
    if not code:
        return err("Bitte geben Sie einen Gutscheincode ein.", 400)
    coupon = db.get_coupon(code)
    if not coupon or not coupon["active"]:
        return err("Dieser Gutscheincode ist nicht gültig.", 400)
    now_iso = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    if coupon.get("valid_from") and coupon["valid_from"] > now_iso:
        return err("Dieser Gutscheincode ist noch nicht gültig.", 400)
    if coupon.get("valid_until") and coupon["valid_until"] < now_iso:
        return err("Dieser Gutscheincode ist abgelaufen.", 400)
    if coupon["max_uses"] > 0 and coupon["used_count"] >= coupon["max_uses"]:
        return err("Dieser Gutscheincode wurde bereits maximal oft verwendet.", 400)
    if subtotal < coupon["min_total_cents"]:
        min_total = coupon["min_total_cents"] / 100
        return err(f"Der Mindestbestellwert für diesen Gutschein beträgt {min_total:.2f} €.", 400)
    if coupon["discount_type"] == "percent":
        discount_cents = int(subtotal * coupon["discount_value"] / 100)
    else:
        discount_cents = min(coupon["discount_value"], subtotal)
    return jsonify({
        "code": coupon["code"],
        "discount_type": coupon["discount_type"],
        "discount_value": coupon["discount_value"],
        "discount_cents": discount_cents,
    })


@app.get("/api/config")
def api_config():
    return jsonify({"googleLogin": bool(GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET)})


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
    name = _clean_text(data.get("name"), 100)
    email = _clean_text(data.get("email"), 254)
    phone = _clean_text(data.get("phone"), 40)
    if email and not _is_valid_email(email):
        return err("Bitte eine gültige E-Mail-Adresse angeben.", 400)
    db.update_profile(user["id"], name, email, phone)
    return jsonify({"ok": True})


# ---------------------------------------------------------------- password reset

RESET_TOKEN_TTL = 60 * 60


@app.post("/api/forgot-password")
def forgot_password():
    if not _rate_limit("forgot", 5, 3600):
        return err("Zu viele Anfragen. Bitte später erneut versuchen.", 429)
    data = request.get_json(silent=True) or {}
    email = _clean_text(data.get("email"), 254).lower()
    user = db.get_user_by_email(email) if email else None
    if user:
        db.clear_password_resets(user["id"])
        token = secrets.token_urlsafe(32)
        expires_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() + RESET_TOKEN_TTL))
        db.create_password_reset(user["id"], token, expires_at)
        mailer.send_password_reset(
            user["email"],
            user.get("name") or user["username"],
            f"{DOMAIN}/forgot-password.html?token={token}",
        )
    return jsonify({"ok": True})


@app.post("/api/reset-password")
def reset_password():
    if not _rate_limit("reset", 5, 3600):
        return err("Zu viele Anfragen. Bitte später erneut versuchen.", 429)
    data = request.get_json(silent=True) or {}
    token = (data.get("token") or "").strip()
    password = data.get("password") or ""
    if len(password) < 6:
        return err("Das Passwort muss mindestens 6 Zeichen haben.", 400)
    if len(password) > 128:
        return err("Das Passwort ist zu lang.", 400)
    rec = db.get_password_reset(token)
    if not rec or rec["used"]:
        return err("Der Link ist ungültig oder wurde bereits verwendet.", 400)
    try:
        expires = calendar.timegm(time.strptime(rec["expires_at"], "%Y-%m-%dT%H:%M:%SZ"))
    except (TypeError, ValueError):
        return err("Der Link ist abgelaufen.", 400)
    if expires < time.time():
        return err("Der Link ist abgelaufen.", 400)
    db.set_user_password(rec["user_id"], generate_password_hash(password))
    db.consume_password_reset(token)
    db.delete_user_sessions(rec["user_id"])
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
    phone = (data.get("phone") or "").strip() or (user.get("phone") or "").strip()
    if not phone:
        return err("Bitte geben Sie eine Telefonnummer an.", 400)
    customer_name = (data.get("name") or "").strip() or (user.get("name") or "").strip()
    customer_email = (user.get("email") or "").strip()

    line_items = []
    resolved = []
    subtotal_cents = 0
    for item in cart:
        slug = item.get("id")
        if not isinstance(slug, str) or not slug or len(slug) > 120:
            return err("Ungültiger Artikel.", 400)
        try:
            qty = int(item.get("qty", 1))
        except (TypeError, ValueError):
            return err("Ungültige Menge.", 400)
        if qty < 1 or qty > 999:
            return err("Ungültige Menge.", 400)
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

    coupon_code = ""
    discount_cents = 0
    coupon_data = data.get("coupon_code")
    if coupon_data:
        coupon_data = _clean_text(str(coupon_data), 30)
        coupon = db.get_coupon(coupon_data)
        if coupon and coupon["active"]:
            now_iso = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            if (not coupon.get("valid_from") or coupon["valid_from"] <= now_iso) and \
               (not coupon.get("valid_until") or coupon["valid_until"] >= now_iso) and \
               (coupon["max_uses"] == 0 or coupon["used_count"] < coupon["max_uses"]) and \
               subtotal_cents >= coupon["min_total_cents"]:
                if coupon["discount_type"] == "percent":
                    discount_cents = int(subtotal_cents * coupon["discount_value"] / 100)
                else:
                    discount_cents = min(coupon["discount_value"], subtotal_cents)
                if discount_cents > 0:
                    coupon_code = coupon["code"]
                    factor = (subtotal_cents - discount_cents) / subtotal_cents if subtotal_cents else 1
                    running = 0
                    product_items = [li for li in line_items if li["price_data"]["product_data"]["name"] != "Versand (Post)"]
                    discounted_sub = subtotal_cents - discount_cents
                    for idx, li in enumerate(product_items):
                        qty = li.get("quantity", 1)
                        if idx < len(product_items) - 1:
                            li["price_data"]["unit_amount"] = max(1, int(li["price_data"]["unit_amount"] * factor))
                            running += li["price_data"]["unit_amount"] * qty
                        else:
                            remaining = max(1, (discounted_sub - running) // qty)
                            li["price_data"]["unit_amount"] = remaining

    order_no = gen_order_no()
    order = {
        "order_no": order_no,
        "user_id": user["id"],
        "items": resolved,
        "subtotal_cents": subtotal_cents,
        "shipping_cents": shipping_cents,
        "discount_cents": discount_cents,
        "coupon_code": coupon_code,
        "total_cents": subtotal_cents + shipping_cents - discount_cents,
        "delivery_method": "delivery" if delivery else "pickup",
        "delivery_street": addr.get("street", "") if delivery else "",
        "delivery_zip": addr.get("zip", "") if delivery else "",
        "delivery_city": addr.get("city", "") if delivery else "",
        "customer_name": customer_name,
        "customer_email": customer_email,
        "customer_phone": phone,
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


def _complete_paid_order(order, session_id, payment_intent):
    if order["status"] != "Zahlung ausstehend":
        return
    db.update_order(
        order["order_no"],
        {
            "status": "Eingegangen",
            "stripe_session_id": session_id,
            "stripe_payment_intent": payment_intent,
        },
    )
    db.decrement_stock(order["items"])
    if order.get("couponCode"):
        db.increment_coupon_usage(order["couponCode"])
    user = db.get_user_by_id(order["user_id"]) if order["user_id"] else None
    mailer.notify_admin_order(
        order["order_no"],
        f"{order['total']:.2f}".replace(".", ","),
        "Versand an " + order["delivery"]["street"] if order["delivery"]["method"] == "delivery" else "Abholung",
        {
            "name": order.get("customerName") or (user["name"] if user else ""),
            "email": order.get("customerEmail") or (user["email"] if user else ""),
            "phone": order.get("customerPhone") or (user["phone"] if user else ""),
            "couponCode": order.get("couponCode", ""),
            "discount": order.get("discount", 0),
        },
    )
    attachment = None
    try:
        buf = generate_invoice_pdf(order)
        attachment = {"data": buf.getvalue(), "filename": f"Rechnung-{order['order_no']}.pdf"}
    except Exception:
        pass
    mailer.notify_customer_order(order, attachment=attachment)


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
        if order:
            _complete_paid_order(order, session_id, obj.get("payment_intent"))
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
    order = order_to_dict(order)
    if order["status"] == "Zahlung ausstehend":
        try:
            session = stripe.checkout.Session.retrieve(session_id)
            if getattr(session, "payment_status", "") == "paid":
                _complete_paid_order(order, session_id, getattr(session, "payment_intent", None))
                order = order_to_dict(db.get_order(order["order_no"]))
        except Exception:
            pass
    return jsonify({"order": order})


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
        status = _clean_text(data["status"], 50)
        if status not in ORDER_STATUSES:
            return err("Ungültiger Status.", 400)
        db.update_order(order_no, {"status": status})
        user = db.get_user_by_id(order["user_id"]) if order["user_id"] else None
        if user:
            mailer.notify_customer_status(user["email"], order_no, status)
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


@app.get("/api/admin/orders/<order_no>/invoice")
def admin_order_invoice(order_no):
    bad = _admin_ok(require_admin())
    if bad:
        return bad
    order = db.get_order(order_no)
    if not order:
        return err("Bestellung nicht gefunden.", 404)
    d = order_to_dict(order)
    buf = generate_invoice_pdf(d)
    return Response(
        buf.getvalue(),
        mimetype="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="Rechnung-{order_no}.pdf"'},
    )


@app.get("/api/orders/<order_no>/invoice")
def customer_order_invoice(order_no):
    order = db.get_order(order_no)
    if not order:
        return err("Bestellung nicht gefunden.", 404)
    user = db.get_user_by_id(order["user_id"]) if order["user_id"] else None
    session_user = require_auth()
    if not session_user or (user and session_user["id"] != user["id"]):
        return err("Nicht autorisiert.", 403)
    d = order_to_dict(order)
    buf = generate_invoice_pdf(d)
    return Response(
        buf.getvalue(),
        mimetype="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="Rechnung-{order_no}.pdf"'},
    )


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


# ---- admin coupons ----


@app.get("/api/admin/coupons")
def admin_list_coupons():
    bad = _admin_ok(require_admin())
    if bad:
        return bad
    return jsonify({"coupons": db.list_coupons()})


@app.post("/api/admin/coupons")
def admin_add_coupon():
    bad = _admin_ok(require_admin())
    if bad:
        return bad
    data = request.get_json(silent=True) or {}
    code = _clean_text(data.get("code"), 30)
    dtype = _clean_text(data.get("discount_type"), 10)
    value = int(data.get("discount_value") or 0)
    min_total = int(data.get("min_total_cents") or 0)
    max_uses = int(data.get("max_uses") or 0)
    valid_from = _clean_text(data.get("valid_from"), 30)
    valid_until = _clean_text(data.get("valid_until"), 30) or None
    if not code or len(code) < 2:
        return err("Gutscheincode muss mindestens 2 Zeichen lang sein.", 400)
    if dtype not in ("percent", "fixed"):
        return err("Typ muss 'percent' oder 'fixed' sein.", 400)
    if value <= 0:
        return err("Der Rabattwert muss größer als 0 sein.", 400)
    if dtype == "percent" and value > 100:
        return err("Prozent-Rabatt darf max. 100% sein.", 400)
    if not valid_from:
        valid_from = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    if db.get_coupon(code):
        return err("Dieser Code ist bereits vergeben.", 400)
    cid = db.add_coupon(code, dtype, value, min_total, max_uses, valid_from, valid_until)
    return jsonify({"ok": True, "id": cid})


@app.put("/api/admin/coupons/<int:coupon_id>")
def admin_update_coupon(coupon_id):
    bad = _admin_ok(require_admin())
    if bad:
        return bad
    coupon = db.get_coupon_by_id(coupon_id)
    if not coupon:
        return err("Gutschein nicht gefunden.", 404)
    data = request.get_json(silent=True) or {}
    fields = {}
    if "discount_type" in data:
        dt = _clean_text(data["discount_type"], 10)
        if dt not in ("percent", "fixed"):
            return err("Typ muss 'percent' oder 'fixed' sein.", 400)
        fields["discount_type"] = dt
    if "discount_value" in data:
        v = int(data["discount_value"])
        if v <= 0:
            return err("Der Rabattwert muss größer als 0 sein.", 400)
        fields["discount_value"] = v
    if "min_total_cents" in data:
        fields["min_total_cents"] = int(data["min_total_cents"])
    if "max_uses" in data:
        fields["max_uses"] = int(data["max_uses"])
    if "valid_from" in data:
        fields["valid_from"] = _clean_text(data["valid_from"], 30)
    if "valid_until" in data:
        fields["valid_until"] = _clean_text(data["valid_until"], 30) or None
    if "active" in data:
        fields["active"] = int(bool(data["active"]))
    if fields:
        db.update_coupon(coupon_id, fields)
    return jsonify({"ok": True})


@app.delete("/api/admin/coupons/<int:coupon_id>")
def admin_delete_coupon(coupon_id):
    bad = _admin_ok(require_admin())
    if bad:
        return bad
    db.delete_coupon(coupon_id)
    return jsonify({"ok": True})


# ---- admin email templates ----


@app.get("/api/admin/email-templates")
def admin_list_email_templates():
    bad = _admin_ok(require_admin())
    if bad:
        return bad
    return jsonify({"templates": db.list_email_templates()})


@app.get("/api/admin/email-templates/<key>")
def admin_get_email_template(key):
    bad = _admin_ok(require_admin())
    if bad:
        return bad
    tpl = db.get_email_template(key)
    if not tpl:
        return err("Vorlage nicht gefunden.", 404)
    return jsonify({"template": tpl})


@app.put("/api/admin/email-templates/<key>")
def admin_update_email_template(key):
    bad = _admin_ok(require_admin())
    if bad:
        return bad
    tpl = db.get_email_template(key)
    if not tpl:
        return err("Vorlage nicht gefunden.", 404)
    data = request.get_json(silent=True) or {}
    fields = {}
    if "subject" in data:
        fields["subject"] = _clean_text(data["subject"], 500)
    if "body" in data:
        fields["body"] = _clean_text(data["body"], 5000)
    if "enabled" in data:
        fields["enabled"] = 1 if data["enabled"] else 0
    if fields:
        db.update_email_template(key, fields)
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
    name = _clean_text(data.get("name"), 200)
    if not slug or not name:
        return err("Bitte Name und Artikel-ID angeben.", 400)
    if not SLUG_RE.match(slug):
        return err("Ungültige Artikel-ID (nur Kleinbuchstaben, Ziffern und Bindestriche).", 400)
    price_cents = _parse_price_cents(data.get("price", 0))
    if price_cents is None:
        return err("Ungültiger Preis.", 400)
    if db.get_product(slug):
        return err("Diese Artikel-ID existiert bereits.", 400)
    stock = data.get("stock")
    if stock is not None and stock != "":
        try:
            stock = max(0, int(stock))
        except (TypeError, ValueError):
            return err("Ungültiger Lagerbestand.", 400)
    category = _clean_text(data.get("category"), 100) or "Sonstiges"
    desc = _clean_text(data.get("desc"), 2000)
    image = _clean_text(data.get("image"), 200)
    if image and not SAFE_FILENAME_RE.match(image):
        return err("Ungültiger Bilddateiname.", 400)
    db.add_product(slug, name, category, price_cents, stock, desc, image)
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
    name = _clean_text(data.get("name", product["name"]), 200) or product["name"]
    category = _clean_text(data.get("category", product["category"]), 100) or product["category"]
    raw_price = data.get("price", product["price_cents"] / 100)
    price_cents = _parse_price_cents(raw_price)
    if price_cents is None:
        return err("Ungültiger Preis.", 400)
    if "stock" in data:
        stock = data["stock"]
        if stock is None or stock == "":
            stock = None
        else:
            try:
                stock = max(0, int(stock))
            except (TypeError, ValueError):
                return err("Ungültiger Lagerbestand.", 400)
    else:
        stock = product["stock"]
    desc = _clean_text(data.get("desc", product.get("desc") or ""), 2000)
    image = _clean_text(data.get("image", product.get("image") or ""), 200)
    if image and not SAFE_FILENAME_RE.match(image):
        return err("Ungültiger Bilddateiname.", 400)
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
    if not slug or "/" in slug or "\\" in slug:
        return err("Ungültige Artikel-ID.", 400)
    file = request.files.get("file")
    if not file or not file.filename:
        return err("Keine Datei angehängt.", 400)
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in ALLOWED_IMAGE_EXT:
        return err("Nur JPG, PNG, WebP oder GIF erlaubt.", 400)
    if file.content_length and file.content_length > 3 * 1024 * 1024:
        return err("Bild zu groß (max. 3 MB).", 400)
    data = file.read(3 * 1024 * 1024 + 1)
    if len(data) > 3 * 1024 * 1024:
        return err("Bild zu groß (max. 3 MB).", 400)
    filename = slug + ext
    os.makedirs(IMG_DIR, exist_ok=True)
    with open(os.path.join(IMG_DIR, filename), "wb") as out:
        out.write(data)
    db.set_product_image(slug, filename)
    return jsonify({"ok": True, "image": filename})


@app.delete("/api/admin/products/<slug>")
def admin_delete_product(slug):
    bad = _admin_ok(require_admin())
    if bad:
        return bad
    db.delete_product(slug)
    return jsonify({"ok": True})


# ---- admin customers ----


@app.get("/api/admin/customers")
def admin_list_customers():
    bad = _admin_ok(require_admin())
    if bad:
        return bad
    customers = db.list_all_customers()
    out = []
    for c in customers:
        out.append({
            "id": c["id"],
            "username": c["username"],
            "email": c["email"],
            "name": c["name"],
            "phone": c["phone"],
            "role": c["role"],
            "newsletter": c["newsletter"],
            "created_at": c["created_at"],
            "order_count": c["order_count"],
            "total_spent": round(c["total_spent_cents"] / 100, 2),
            "last_order_at": c["last_order_at"],
        })
    return jsonify({"customers": out})


@app.get("/api/admin/customers/<int:user_id>")
def admin_get_customer(user_id):
    bad = _admin_ok(require_admin())
    if bad:
        return bad
    user = db.get_user_by_id(user_id)
    if not user:
        return err("Kunde nicht gefunden.", 404)
    orders = db.get_customer_orders(user_id)
    order_list = []
    for o in orders:
        d = order_to_dict(o)
        order_list.append({
            "order_no": d["order_no"],
            "created_at": d["created_at"],
            "total": d["total"],
            "status": d["status"],
            "items": d["items"],
        })
    return jsonify({
        "customer": {
            "id": user["id"],
            "username": user["username"],
            "email": user["email"],
            "name": user["name"],
            "phone": user["phone"],
            "role": user["role"],
            "newsletter": user["newsletter"],
            "created_at": user["created_at"],
        },
        "orders": order_list,
    })


# ---------------------------------------------------------------- misc

@app.get("/api/admin/stats")
def admin_stats():
    bad = _admin_ok(require_admin())
    if bad:
        return bad
    return jsonify(db.get_view_stats())


# ---------------------------------------------------------------- field plans / crop planner

FIELD_IMG_ALLOW = {".jpg", ".jpeg", ".png", ".webp", ".gif"}


@app.get("/api/admin/field-plans")
def admin_list_field_plans():
    bad = _admin_ok(require_admin())
    if bad:
        return bad
    plans = db.list_field_plans()
    out = []
    for p in plans:
        p.pop("image_data", None)
        p.pop("image_mime", None)
        sections = db.list_field_sections(p["id"])
        out.append({**p, "section_count": len(sections)})
    return jsonify({"plans": out})


@app.post("/api/admin/field-plans")
def admin_create_field_plan():
    bad = _admin_ok(require_admin())
    if bad:
        return bad
    data = request.get_json(silent=True) or {}
    name = _clean_text(data.get("name"), 200)
    if not name:
        return err("Bitte einen Namen angeben.", 400)
    plan_id = db.create_field_plan(name)
    return jsonify({"ok": True, "id": plan_id})


@app.get("/api/admin/field-plans/<int:plan_id>")
def admin_get_field_plan(plan_id):
    bad = _admin_ok(require_admin())
    if bad:
        return bad
    plan = db.get_field_plan(plan_id)
    if not plan:
        return err("Plan nicht gefunden.", 404)
    plan.pop("image_data", None)
    plan.pop("image_mime", None)
    sections = db.list_field_sections(plan_id)
    for s in sections:
        s["points"] = json.loads(s.get("points_json") or "[]")
    return jsonify({"plan": plan, "sections": sections})


@app.put("/api/admin/field-plans/<int:plan_id>")
def admin_update_field_plan(plan_id):
    bad = _admin_ok(require_admin())
    if bad:
        return bad
    plan = db.get_field_plan(plan_id)
    if not plan:
        return err("Plan nicht gefunden.", 404)
    data = request.get_json(silent=True) or {}
    fields = {}
    if "name" in data:
        fields["name"] = _clean_text(data["name"], 200) or plan["name"]
    if "width_meters" in data:
        fields["width_meters"] = data["width_meters"]
    if "height_meters" in data:
        fields["height_meters"] = data["height_meters"]
    db.update_field_plan(plan_id, fields)
    return jsonify({"ok": True})


@app.delete("/api/admin/field-plans/<int:plan_id>")
def admin_delete_field_plan(plan_id):
    bad = _admin_ok(require_admin())
    if bad:
        return bad
    plan = db.get_field_plan(plan_id)
    if not plan:
        return err("Plan nicht gefunden.", 404)
    db.delete_field_plan(plan_id)
    return jsonify({"ok": True})


@app.post("/api/admin/field-plans/<int:plan_id>/image")
def admin_upload_field_plan_image(plan_id):
    bad = _admin_ok(require_admin())
    if bad:
        return bad
    plan = db.get_field_plan(plan_id)
    if not plan:
        return err("Plan nicht gefunden.", 404)
    file = request.files.get("file")
    if not file or not file.filename:
        return err("Keine Datei angehängt.", 400)
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in FIELD_IMG_ALLOW:
        return err("Nur JPG, PNG, WebP oder GIF erlaubt.", 400)
    data = file.read(5 * 1024 * 1024 + 1)
    if len(data) > 5 * 1024 * 1024:
        return err("Bild zu groß (max. 5 MB).", 400)
    mime_map = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
                ".webp": "image/webp", ".gif": "image/gif"}
    mime = mime_map.get(ext, "image/jpeg")
    b64 = base64.b64encode(data).decode("ascii")
    filename = f"fieldplan-{plan_id}{ext}"
    db.update_field_plan(plan_id, {"image": filename, "image_data": b64, "image_mime": mime})
    return jsonify({"ok": True, "image": filename})


@app.get("/api/field-plans/<int:plan_id>/image")
def serve_field_plan_image(plan_id):
    plan = db.get_field_plan(plan_id)
    if not plan or not plan.get("image_data"):
        return err("Bild nicht gefunden.", 404)
    mime = plan.get("image_mime") or "image/jpeg"
    raw = base64.b64decode(plan["image_data"])
    return Response(raw, mimetype=mime, headers={"Cache-Control": "public, max-age=86400"})


@app.post("/api/admin/field-plans/<int:plan_id>/calibrate")
def admin_calibrate_field_plan(plan_id):
    bad = _admin_ok(require_admin())
    if bad:
        return bad
    plan = db.get_field_plan(plan_id)
    if not plan:
        return err("Plan nicht gefunden.", 404)
    data = request.get_json(silent=True) or {}
    fields = {}
    if "width_meters" in data and "height_meters" in data:
        wm = data["width_meters"]
        hm = data["height_meters"]
        fields["width_meters"] = float(wm) if wm is not None else None
        fields["height_meters"] = float(hm) if hm is not None else None
        fields["calibration_x1"] = None
        fields["calibration_y1"] = None
        fields["calibration_x2"] = None
        fields["calibration_y2"] = None
        fields["calibration_meters"] = None
    elif all(k in data for k in ("x1", "y1", "x2", "y2", "meters")):
        fields["calibration_x1"] = float(data["x1"])
        fields["calibration_y1"] = float(data["y1"])
        fields["calibration_x2"] = float(data["x2"])
        fields["calibration_y2"] = float(data["y2"])
        fields["calibration_meters"] = float(data["meters"])
        fields["width_meters"] = None
        fields["height_meters"] = None
    else:
        return err("Ungültige Kalibrierungsdaten.", 400)
    db.update_field_plan(plan_id, fields)
    return jsonify({"ok": True})


@app.post("/api/admin/field-plans/<int:plan_id>/sections")
def admin_create_field_section(plan_id):
    bad = _admin_ok(require_admin())
    if bad:
        return bad
    plan = db.get_field_plan(plan_id)
    if not plan:
        return err("Plan nicht gefunden.", 404)
    data = request.get_json(silent=True) or {}
    points = data.get("points", [])
    if not isinstance(points, list) or len(points) < 3:
        return err("Ein Bereich muss mindestens 3 Punkte haben.", 400)
    data["points_json"] = json.dumps(points, ensure_ascii=False)
    GROWTH_STAGES = ["Saaten", "Keimlinge", "Wachstum", "Reif", "Geerntet"]
    if data.get("growth_stage") and data["growth_stage"] not in GROWTH_STAGES:
        data["growth_stage"] = "Saaten"
    section_id = db.create_field_section(plan_id, data)
    return jsonify({"ok": True, "id": section_id})


@app.put("/api/admin/field-plans/<int:plan_id>/sections/<int:section_id>")
def admin_update_field_section(plan_id, section_id):
    bad = _admin_ok(require_admin())
    if bad:
        return bad
    section = db.get_field_section(section_id)
    if not section or section["plan_id"] != plan_id:
        return err("Bereich nicht gefunden.", 404)
    data = request.get_json(silent=True) or {}
    fields = {}
    for key in ("name", "plant_name", "plant_variety", "planting_date",
                "growth_stage", "expected_harvest", "notes", "watering_schedule", "color",
                "width_m", "height_m", "watering_last", "watering_interval", "watering_auto"):
        if key in data:
            fields[key] = data[key] if key != "growth_stage" else (_clean_text(data[key], 50) or "Saaten")
    if "points" in data:
        fields["points_json"] = json.dumps(data["points"], ensure_ascii=False)
    db.update_field_section(section_id, fields)
    return jsonify({"ok": True})


@app.delete("/api/admin/field-plans/<int:plan_id>/sections/<int:section_id>")
def admin_delete_field_section(plan_id, section_id):
    bad = _admin_ok(require_admin())
    if bad:
        return bad
    section = db.get_field_section(section_id)
    if not section or section["plan_id"] != plan_id:
        return err("Bereich nicht gefunden.", 404)
    db.delete_field_section(section_id)
    return jsonify({"ok": True})


@app.post("/api/admin/field-plans/<int:plan_id>/sections/<int:section_id>/water")
def admin_water_field_section(plan_id, section_id):
    bad = _admin_ok(require_admin())
    if bad:
        return bad
    section = db.get_field_section(section_id)
    if not section or section["plan_id"] != plan_id:
        return err("Bereich nicht gefunden.", 404)
    today = time.strftime("%Y-%m-%d", time.localtime())
    db.update_field_section(section_id, {"watering_last": today})
    return jsonify({"ok": True, "watering_last": today})


# ---------------------------------------------------------------- backup

@app.get("/api/admin/plant-catalog")
def admin_list_plant_catalog():
    bad = _admin_ok(require_admin())
    if bad:
        return bad
    entries = db.list_plant_catalog()
    for e in entries:
        e["companions"] = json.loads(e.get("companions") or "[]")
        e["incompatible"] = json.loads(e.get("incompatible") or "[]")
    return jsonify({"plants": entries})


@app.get("/api/field-plans/plant-catalog")
def public_plant_catalog():
    entries = db.list_plant_catalog()
    for e in entries:
        e["companions"] = json.loads(e.get("companions") or "[]")
        e["incompatible"] = json.loads(e.get("incompatible") or "[]")
    return jsonify({"plants": entries})


@app.get("/api/field-plans/current")
def public_current_planting():
    try:
        plans = db.list_field_plans()
        all_sections = []
        for plan in plans:
            secs = db.list_field_sections(plan["id"])
            for s in secs:
                if s.get("plant_name"):
                    all_sections.append({
                        "plant_name": s["plant_name"],
                        "name": s.get("name", ""),
                        "planting_date": s.get("planting_date"),
                        "expected_harvest": s.get("expected_harvest"),
                        "color": s.get("color", ""),
                    })
        best = {}
        for s in all_sections:
            key = s["plant_name"]
            if key not in best:
                best[key] = s
            elif s.get("expected_harvest") and (not best[key].get("expected_harvest") or s["expected_harvest"] < best[key]["expected_harvest"]):
                best[key] = s
        return jsonify({"sections": list(best.values())})
    except Exception as e:
        return jsonify({"error": str(e), "sections": []}), 500


@app.post("/api/admin/plant-catalog")
def admin_create_plant_catalog_entry():
    bad = _admin_ok(require_admin())
    if bad:
        return bad
    data = request.get_json(silent=True) or {}
    name = _clean_text(data.get("name"), 100)
    if not name:
        return err("Name ist erforderlich.", 400)
    entry_id = db.create_plant_catalog_entry(data)
    return jsonify({"ok": True, "id": entry_id})


@app.get("/api/admin/plant-catalog/<int:entry_id>")
def admin_get_plant_catalog_entry(entry_id):
    bad = _admin_ok(require_admin())
    if bad:
        return bad
    entry = db.get_plant_catalog_entry(entry_id)
    if not entry:
        return err("Eintrag nicht gefunden.", 404)
    entry["companions"] = json.loads(entry.get("companions") or "[]")
    entry["incompatible"] = json.loads(entry.get("incompatible") or "[]")
    return jsonify({"plant": entry})


@app.put("/api/admin/plant-catalog/<int:entry_id>")
def admin_update_plant_catalog_entry(entry_id):
    bad = _admin_ok(require_admin())
    if bad:
        return bad
    entry = db.get_plant_catalog_entry(entry_id)
    if not entry:
        return err("Eintrag nicht gefunden.", 404)
    data = request.get_json(silent=True) or {}
    fields = {}
    for key in ("name", "category", "watering", "yield_kg", "price_per_kg"):
        if key in data:
            fields[key] = data[key]
    for key in ("companions", "incompatible"):
        if key in data:
            fields[key] = json.dumps(data[key], ensure_ascii=False)
    if fields:
        db.update_plant_catalog_entry(entry_id, fields)
    return jsonify({"ok": True})


@app.delete("/api/admin/plant-catalog/<int:entry_id>")
def admin_delete_plant_catalog_entry(entry_id):
    bad = _admin_ok(require_admin())
    if bad:
        return bad
    db.delete_plant_catalog_entry(entry_id)
    return jsonify({"ok": True})


@app.get("/api/admin/rotation-history")
def admin_rotation_history():
    bad = _admin_ok(require_admin())
    if bad:
        return bad
    return jsonify({"history": db.get_crop_rotation_history()})


@app.post("/api/admin/rotation-snapshot")
def admin_save_rotation_snapshot():
    bad = _admin_ok(require_admin())
    if bad:
        return bad
    data = request.get_json(silent=True) or {}
    plan_name = data.get("plan_name", "")
    sections = data.get("sections", [])
    plan_year = data.get("plan_year")
    if not plan_year:
        from datetime import datetime
        plan_year = datetime.utcnow().year
    db.save_crop_rotation_snapshot(plan_name, sections, plan_year)
    return jsonify({"ok": True})


@app.post("/api/admin/rotation-conflicts")
def admin_rotation_conflicts():
    bad = _admin_ok(require_admin())
    if bad:
        return bad
    data = request.get_json(silent=True) or {}
    sections = data.get("sections", [])
    plant_families = data.get("plant_families", {})
    conflicts = db.get_rotation_conflicts(sections, plant_families)
    return jsonify({"conflicts": conflicts})


@app.get("/api/admin/backup")
def admin_backup():
    bad = _admin_ok(require_admin())
    if bad:
        return bad
    ts = time.strftime("%Y-%m-%d_%H%M%S", time.localtime())
    db_type = "postgres" if os.environ.get("DATABASE_URL", "").strip() else "sqlite"
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(
            "backup.json",
            json.dumps(
                {
                    "schema_version": 1,
                    "created_at": ts,
                    "db": db_type,
                    "tables": db.export_all_tables(),
                },
                ensure_ascii=False,
            ),
        )
        zf.writestr(
            "manifest.json",
            json.dumps({"created_at": ts, "db": db_type, "schema_version": 1}, ensure_ascii=False),
        )
        for fname in sorted(os.listdir(IMG_DIR)):
            path = os.path.join(IMG_DIR, fname)
            if os.path.isfile(path) and fname.lower().endswith(tuple(ALLOWED_IMAGE_EXT)):
                zf.write(path, f"assets/img/{fname}")
    buf.seek(0)
    return Response(
        buf.getvalue(),
        mimetype="application/zip",
        headers={"Content-Disposition": f'attachment; filename="irmgaertchen-backup-{ts}.zip"'},
    )


@app.post("/api/admin/backup/restore")
def admin_restore_backup():
    bad = _admin_ok(require_admin())
    if bad:
        return bad
    admin_user = require_admin()
    file = request.files.get("file")
    if not file:
        return err("Keine Backup-Datei hochgeladen.", 400)
    if not (file.filename or "").lower().endswith(".zip"):
        return err("Bitte eine Backup-ZIP-Datei hochladen.", 400)
    raw = file.read()
    if not raw:
        return err("Die Datei ist leer.", 400)
    if len(raw) > 50 * 1024 * 1024:
        return err("Backup-Datei zu groß (max. 50 MB).", 400)
    try:
        zf = zipfile.ZipFile(io.BytesIO(raw))
    except zipfile.BadZipFile:
        return err("Keine gültige ZIP-Datei.", 400)
    if zf.testzip() is not None:
        return err("Backup-Datei ist beschädigt.", 400)
    names = zf.namelist()
    if len(names) > 5000:
        return err("Backup enthält zu viele Dateien.", 400)
    names = set(names)
    if "backup.json" not in names:
        return err("Ungültige Sicherung: backup.json fehlt.", 400)
    try:
        if zf.getinfo("backup.json").file_size > 25 * 1024 * 1024:
            return err("backup.json ist zu groß.", 400)
        payload = json.loads(zf.read("backup.json").decode("utf-8"))
        data = payload.get("tables") or {}
    except Exception:
        return err("backup.json ist nicht lesbar.", 400)
    if not isinstance(data, dict):
        return err("backup.json ist nicht lesbar.", 400)

    db.import_all_tables(data)

    img_count = 0
    os.makedirs(IMG_DIR, exist_ok=True)
    for name in names:
        if not name.startswith("assets/img/") or name.endswith("/"):
            continue
        base = os.path.basename(name)
        if not base or not base.lower().endswith(tuple(ALLOWED_IMAGE_EXT)):
            continue
        try:
            info = zf.getinfo(name)
            if info.file_size > 3 * 1024 * 1024:
                continue
            with open(os.path.join(IMG_DIR, base), "wb") as out:
                out.write(zf.read(name))
            img_count += 1
        except Exception:
            pass

    admin_id = admin_user["id"]
    db.delete_user_sessions(admin_id)
    token = secrets.token_hex(32)
    db.create_session(token, admin_id)
    return jsonify(
        {
            "ok": True,
            "tables_restored": list(data.keys()),
            "images_restored": img_count,
            "new_token": token,
        }
    )


@app.get("/api/health")
def health():
    return jsonify(
        {
            "ok": True,
            "stripe_ready": bool(STRIPE_SECRET_KEY),
            "db": "postgres" if os.environ.get("DATABASE_URL", "").strip() else "sqlite",
        }
    )


if __name__ == "__main__":
    print(f"Irmgaertchen Shop Backend auf http://localhost:{PORT} (Shop: {DOMAIN})")
    app.run(host="127.0.0.1", port=PORT, debug=os.environ.get("FLASK_DEBUG") == "1")
