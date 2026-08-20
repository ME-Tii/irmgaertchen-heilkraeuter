import os
import hashlib
import sqlite3
import json
import time

from products import CATALOG

SESSION_TTL = 30 * 24 * 3600  # 30 Tage


def _hash_token(token):
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


# Lokal: SQLite (shop.db). Auf Render/Produktion: PostgreSQL über DATABASE_URL.
DB_PATH = os.environ.get(
    "IRM_DB_PATH",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "shop.db"),
)
DATABASE_URL = os.environ.get("DATABASE_URL", "").strip()
USE_PG = DATABASE_URL.startswith("postgres")


def _sql(sql):
    # SQL ist in PostgreSQL-Form geschrieben; für SQLite lokal übersetzen.
    if not USE_PG:
        sql = sql.replace("%s", "?")
        sql = sql.replace("GREATEST(", "MAX(")
    return sql


def _ret_id():
    return " RETURNING id" if USE_PG else ""


def _insert_id(cur):
    if USE_PG:
        row = cur.fetchone()
        return row["id"] if row else None
    return cur.lastrowid


SQLITE_SCHEMA = [
    """CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        email TEXT NOT NULL DEFAULT '',
        password_hash TEXT NOT NULL,
        name TEXT NOT NULL DEFAULT '',
        phone TEXT NOT NULL DEFAULT '',
        role TEXT NOT NULL DEFAULT 'customer',
        newsletter INTEGER NOT NULL DEFAULT 0,
        newsletter_consented INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );""",
    """CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        expires_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );""",
    """CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        slug TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'Sonstiges',
        price_cents INTEGER NOT NULL,
        "desc" TEXT NOT NULL DEFAULT '',
        image TEXT NOT NULL DEFAULT '',
        stock INTEGER,
        custom INTEGER NOT NULL DEFAULT 0,
        visible INTEGER NOT NULL DEFAULT 1
    );""",
    """CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_no TEXT UNIQUE NOT NULL,
        user_id INTEGER REFERENCES users(id),
        stripe_session_id TEXT,
        items_json TEXT NOT NULL,
        subtotal_cents INTEGER NOT NULL DEFAULT 0,
        shipping_cents INTEGER NOT NULL DEFAULT 0,
        discount_cents INTEGER NOT NULL DEFAULT 0,
        total_cents INTEGER NOT NULL DEFAULT 0,
        coupon_code TEXT NOT NULL DEFAULT '',
        delivery_method TEXT NOT NULL DEFAULT 'pickup',
        delivery_street TEXT NOT NULL DEFAULT '',
        delivery_zip TEXT NOT NULL DEFAULT '',
        delivery_city TEXT NOT NULL DEFAULT '',
        customer_name TEXT NOT NULL DEFAULT '',
        customer_email TEXT NOT NULL DEFAULT '',
        customer_phone TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'Eingegangen',
        customer_confirmed INTEGER NOT NULL DEFAULT 0,
        customer_confirmed_at TEXT,
        return_requested INTEGER NOT NULL DEFAULT 0,
        return_reason TEXT,
        return_processed INTEGER NOT NULL DEFAULT 0,
        refunded INTEGER NOT NULL DEFAULT 0,
        refunded_at TEXT,
        stripe_refund_id TEXT,
        stripe_payment_intent TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );""",
    """CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER REFERENCES users(id),
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        message TEXT NOT NULL,
        read INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );""",
    """CREATE TABLE IF NOT EXISTS password_resets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id),
        token TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        used INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );""",
    """CREATE TABLE IF NOT EXISTS page_views (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );""",
    """CREATE TABLE IF NOT EXISTS visitors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        visitor_id TEXT UNIQUE NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );""",
    """CREATE TABLE IF NOT EXISTS visitor_days (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        visitor_id TEXT NOT NULL,
        day TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (visitor_id, day)
    );""",
    """CREATE TABLE IF NOT EXISTS mail_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        recipient TEXT NOT NULL,
        subject TEXT NOT NULL,
        ok INTEGER NOT NULL DEFAULT 0,
        error TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );""",
    """CREATE TABLE IF NOT EXISTS coupons (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT UNIQUE NOT NULL,
        discount_type TEXT NOT NULL,
        discount_value INTEGER NOT NULL,
        min_total_cents INTEGER NOT NULL DEFAULT 0,
        max_uses INTEGER NOT NULL DEFAULT 0,
        used_count INTEGER NOT NULL DEFAULT 0,
        valid_from TEXT NOT NULL,
        valid_until TEXT,
        active INTEGER NOT NULL DEFAULT 1
    );""",
    """CREATE TABLE IF NOT EXISTS field_plans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        image TEXT NOT NULL DEFAULT '',
        width_meters REAL,
        height_meters REAL,
        calibration_x1 REAL,
        calibration_y1 REAL,
        calibration_x2 REAL,
        calibration_y2 REAL,
        calibration_meters REAL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );""",
    """CREATE TABLE IF NOT EXISTS field_sections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        plan_id INTEGER NOT NULL REFERENCES field_plans(id) ON DELETE CASCADE,
        name TEXT NOT NULL DEFAULT '',
        plant_name TEXT NOT NULL DEFAULT '',
        plant_variety TEXT NOT NULL DEFAULT '',
        planting_date TEXT,
        growth_stage TEXT NOT NULL DEFAULT 'Saat',
        expected_harvest TEXT,
        notes TEXT NOT NULL DEFAULT '',
        watering_schedule TEXT NOT NULL DEFAULT '',
        points_json TEXT NOT NULL DEFAULT '[]',
        color TEXT NOT NULL DEFAULT '#3f6b3b',
        width_m REAL,
        height_m REAL,
        watering_last TEXT,
        watering_interval INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );""",
    """CREATE TABLE IF NOT EXISTS plant_catalog (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT '',
        watering TEXT NOT NULL DEFAULT '',
        companions TEXT NOT NULL DEFAULT '[]',
        incompatible TEXT NOT NULL DEFAULT '[]',
        yield_kg REAL,
        price_per_kg REAL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );""",
    """CREATE TABLE IF NOT EXISTS crop_rotation_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        plan_name TEXT NOT NULL DEFAULT '',
        section_name TEXT NOT NULL DEFAULT '',
        plant_name TEXT NOT NULL DEFAULT '',
        plant_family TEXT NOT NULL DEFAULT '',
        plan_year INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );""",
    """CREATE TABLE IF NOT EXISTS email_templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        subject TEXT NOT NULL DEFAULT '',
        body TEXT NOT NULL DEFAULT '',
        enabled INTEGER NOT NULL DEFAULT 1
    );""",
    """CREATE TABLE IF NOT EXISTS site_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL DEFAULT ''
    );""",
]

PG_SCHEMA = [
    """CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        email TEXT NOT NULL DEFAULT '',
        password_hash TEXT NOT NULL,
        name TEXT NOT NULL DEFAULT '',
        phone TEXT NOT NULL DEFAULT '',
        role TEXT NOT NULL DEFAULT 'customer',
        newsletter INTEGER NOT NULL DEFAULT 0,
        newsletter_consented INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    );""",
    """CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at TEXT,
        created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    );""",
    """CREATE TABLE IF NOT EXISTS products (
        id SERIAL PRIMARY KEY,
        slug TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'Sonstiges',
        price_cents INTEGER NOT NULL,
        "desc" TEXT NOT NULL DEFAULT '',
        image TEXT NOT NULL DEFAULT '',
        stock INTEGER,
        custom INTEGER NOT NULL DEFAULT 0,
        visible INTEGER NOT NULL DEFAULT 1
    );""",
    """CREATE TABLE IF NOT EXISTS orders (
        id SERIAL PRIMARY KEY,
        order_no TEXT UNIQUE NOT NULL,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        stripe_session_id TEXT,
        items_json TEXT NOT NULL,
        subtotal_cents INTEGER NOT NULL DEFAULT 0,
        shipping_cents INTEGER NOT NULL DEFAULT 0,
        discount_cents INTEGER NOT NULL DEFAULT 0,
        total_cents INTEGER NOT NULL DEFAULT 0,
        coupon_code TEXT NOT NULL DEFAULT '',
        delivery_method TEXT NOT NULL DEFAULT 'pickup',
        delivery_street TEXT NOT NULL DEFAULT '',
        delivery_zip TEXT NOT NULL DEFAULT '',
        delivery_city TEXT NOT NULL DEFAULT '',
        customer_name TEXT NOT NULL DEFAULT '',
        customer_email TEXT NOT NULL DEFAULT '',
        customer_phone TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'Eingegangen',
        customer_confirmed INTEGER NOT NULL DEFAULT 0,
        customer_confirmed_at TEXT,
        return_requested INTEGER NOT NULL DEFAULT 0,
        return_reason TEXT,
        return_processed INTEGER NOT NULL DEFAULT 0,
        refunded INTEGER NOT NULL DEFAULT 0,
        refunded_at TEXT,
        stripe_refund_id TEXT,
        stripe_payment_intent TEXT,
        created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    );""",
    """CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        message TEXT NOT NULL,
        read INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    );""",
    """CREATE TABLE IF NOT EXISTS password_resets (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        used INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    );""",
    """CREATE TABLE IF NOT EXISTS page_views (
        id SERIAL PRIMARY KEY,
        path TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    );""",
    """CREATE TABLE IF NOT EXISTS visitors (
        id SERIAL PRIMARY KEY,
        visitor_id TEXT UNIQUE NOT NULL,
        created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    );""",
    """CREATE TABLE IF NOT EXISTS visitor_days (
        id SERIAL PRIMARY KEY,
        visitor_id TEXT NOT NULL,
        day TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        UNIQUE (visitor_id, day)
    );""",
    """CREATE TABLE IF NOT EXISTS mail_log (
        id SERIAL PRIMARY KEY,
        recipient TEXT NOT NULL,
        subject TEXT NOT NULL,
        ok INTEGER NOT NULL DEFAULT 0,
        error TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    );""",
    """CREATE TABLE IF NOT EXISTS coupons (
        id SERIAL PRIMARY KEY,
        code TEXT UNIQUE NOT NULL,
        discount_type TEXT NOT NULL,
        discount_value INTEGER NOT NULL,
        min_total_cents INTEGER NOT NULL DEFAULT 0,
        max_uses INTEGER NOT NULL DEFAULT 0,
        used_count INTEGER NOT NULL DEFAULT 0,
        valid_from TEXT NOT NULL,
        valid_until TEXT,
        active INTEGER NOT NULL DEFAULT 1
    );""",
    """CREATE TABLE IF NOT EXISTS field_plans (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        image TEXT NOT NULL DEFAULT '',
        width_meters REAL,
        height_meters REAL,
        calibration_x1 REAL,
        calibration_y1 REAL,
        calibration_x2 REAL,
        calibration_y2 REAL,
        calibration_meters REAL,
        created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    );""",
    """CREATE TABLE IF NOT EXISTS field_sections (
        id SERIAL PRIMARY KEY,
        plan_id INTEGER NOT NULL REFERENCES field_plans(id) ON DELETE CASCADE,
        name TEXT NOT NULL DEFAULT '',
        plant_name TEXT NOT NULL DEFAULT '',
        plant_variety TEXT NOT NULL DEFAULT '',
        planting_date TEXT,
        growth_stage TEXT NOT NULL DEFAULT 'Saat',
        expected_harvest TEXT,
        notes TEXT NOT NULL DEFAULT '',
        watering_schedule TEXT NOT NULL DEFAULT '',
        points_json TEXT NOT NULL DEFAULT '[]',
        color TEXT NOT NULL DEFAULT '#3f6b3b',
        width_m REAL,
        height_m REAL,
        watering_last TEXT,
        watering_interval INTEGER,
        created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        updated_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    );""",
    """CREATE TABLE IF NOT EXISTS plant_catalog (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT '',
        watering TEXT NOT NULL DEFAULT '',
        companions TEXT NOT NULL DEFAULT '[]',
        incompatible TEXT NOT NULL DEFAULT '[]',
        yield_kg REAL,
        price_per_kg REAL,
        created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        updated_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    );""",
    """CREATE TABLE IF NOT EXISTS crop_rotation_history (
        id SERIAL PRIMARY KEY,
        plan_name TEXT NOT NULL DEFAULT '',
        section_name TEXT NOT NULL DEFAULT '',
        plant_name TEXT NOT NULL DEFAULT '',
        plant_family TEXT NOT NULL DEFAULT '',
        plan_year INTEGER,
        created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    );""",
    """CREATE TABLE IF NOT EXISTS email_templates (
        id SERIAL PRIMARY KEY,
        key TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        subject TEXT NOT NULL DEFAULT '',
        body TEXT NOT NULL DEFAULT '',
        enabled INTEGER NOT NULL DEFAULT 1
    );""",
    """CREATE TABLE IF NOT EXISTS site_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL DEFAULT ''
    );""",
]

SCHEMA = PG_SCHEMA if USE_PG else SQLITE_SCHEMA


def get_conn():
    if USE_PG:
        import psycopg
        from psycopg.rows import dict_row

        conn = psycopg.connect(DATABASE_URL, row_factory=dict_row)
        return conn
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def row_to_dict(row):
    return dict(row) if row is not None else None


def all_rows(rows):
    return [dict(r) for r in rows]


def init_db():
    conn = get_conn()
    for stmt in SCHEMA:
        conn.execute(stmt)
    conn.commit()
    try:
        conn.execute(_sql("ALTER TABLE orders ADD COLUMN stripe_payment_intent TEXT"))
        conn.commit()
    except Exception:
        conn.rollback()
    for col in ("customer_name", "customer_email", "customer_phone"):
        try:
            conn.execute(_sql(f"ALTER TABLE orders ADD COLUMN {col} TEXT NOT NULL DEFAULT ''"))
            conn.commit()
        except Exception:
            conn.rollback()
    try:
        conn.execute(_sql("ALTER TABLE products ADD COLUMN image TEXT NOT NULL DEFAULT ''"))
        conn.commit()
    except Exception:
        conn.rollback()
    try:
        conn.execute(_sql("ALTER TABLE sessions ADD COLUMN expires_at TEXT"))
        conn.commit()
    except Exception:
        conn.rollback()
    try:
        conn.execute(_sql("ALTER TABLE field_plans ADD COLUMN image_data TEXT NOT NULL DEFAULT ''"))
        conn.commit()
    except Exception:
        conn.rollback()
    try:
        conn.execute(_sql("ALTER TABLE field_plans ADD COLUMN image_mime TEXT NOT NULL DEFAULT ''"))
        conn.commit()
    except Exception:
        conn.rollback()
    try:
        conn.execute(_sql("ALTER TABLE field_sections ADD COLUMN width_m REAL"))
        conn.commit()
    except Exception:
        conn.rollback()
    try:
        conn.execute(_sql("ALTER TABLE field_sections ADD COLUMN height_m REAL"))
        conn.commit()
    except Exception:
        conn.rollback()
    try:
        conn.execute(_sql("ALTER TABLE field_sections ADD COLUMN watering_last TEXT"))
        conn.commit()
    except Exception:
        conn.rollback()
    try:
        conn.execute(_sql("ALTER TABLE field_sections ADD COLUMN watering_interval INTEGER"))
        conn.commit()
    except Exception:
        conn.rollback()
    try:
        conn.execute(_sql("ALTER TABLE plant_catalog ADD COLUMN price_per_kg REAL"))
        conn.commit()
    except Exception:
        conn.rollback()
    try:
        conn.execute(_sql("ALTER TABLE field_sections ADD COLUMN watering_auto INTEGER NOT NULL DEFAULT 0"))
        conn.commit()
    except Exception:
        conn.rollback()
    try:
        if USE_PG:
            conn.execute(_sql(
                "CREATE TABLE IF NOT EXISTS crop_rotation_history ("
                "id SERIAL PRIMARY KEY, plan_name TEXT NOT NULL DEFAULT '', "
                "section_name TEXT NOT NULL DEFAULT '', plant_name TEXT NOT NULL DEFAULT '', "
                "plant_family TEXT NOT NULL DEFAULT '', plan_year INTEGER, "
                "created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"'))"
            ))
        else:
            conn.execute(_sql(
                "CREATE TABLE IF NOT EXISTS crop_rotation_history ("
                "id INTEGER PRIMARY KEY AUTOINCREMENT, plan_name TEXT NOT NULL DEFAULT '', "
                "section_name TEXT NOT NULL DEFAULT '', plant_name TEXT NOT NULL DEFAULT '', "
                "plant_family TEXT NOT NULL DEFAULT '', plan_year INTEGER, "
                "created_at TEXT NOT NULL DEFAULT (datetime('now')))"
            ))
        conn.commit()
    except Exception:
        conn.rollback()
    for col in ("coupon_code", "discount_cents"):
        try:
            conn.execute(_sql(f"ALTER TABLE orders ADD COLUMN {col} TEXT NOT NULL DEFAULT ''" if col == "coupon_code" else f"ALTER TABLE orders ADD COLUMN {col} INTEGER NOT NULL DEFAULT 0"))
            conn.commit()
        except Exception:
            conn.rollback()
    try:
        conn.execute(_sql("ALTER TABLE users ADD COLUMN newsletter INTEGER NOT NULL DEFAULT 0"))
        conn.commit()
    except Exception:
        conn.rollback()
    try:
        conn.execute(_sql("ALTER TABLE users ADD COLUMN newsletter_consented INTEGER NOT NULL DEFAULT 0"))
        conn.commit()
    except Exception:
        conn.rollback()
    prune_sessions(conn)
    cur = conn.execute(_sql("SELECT COUNT(*) AS c FROM email_templates WHERE key = 'newsletter'"))
    if cur.fetchone()["c"] == 0:
        conn.execute(
            _sql("INSERT INTO email_templates (key, name, subject, body, enabled) VALUES (%s, %s, %s, %s, %s)"),
            ("newsletter", "Newsletter",
             "Irmgärtchen Newsletter – Ernte-News & Tipps",
             "Hallo {name},\n\nhier kommt dein Newsletter von Irmgärtchen Heilkräuter!\n\n{harvest_section}"
             "Viele Grüße\nDein Irmgärtchen-Team",
             1),
        )
        conn.commit()
    for slug, info in CATALOG.items():
        conn.execute(
            _sql("UPDATE products SET image = %s WHERE slug = %s AND (image = '' OR image IS NULL)"),
            (info.get("image", ""), slug),
        )
    conn.execute(
        _sql("UPDATE products SET image = %s WHERE slug = %s"),
        ("salbei.jpg", "salbeitee"),
    )
    conn.commit()
    # ---- Shipping label columns
    for col in ("dhl_shopping_cart_id", "dhl_notify_token", "dhl_label_pdf", "dhl_tracking_number", "dhl_status", "dhl_product"):
        try:
            if col == "dhl_label_pdf":
                if USE_PG:
                    conn.execute(_sql(f"ALTER TABLE orders ADD COLUMN {col} BYTEA"))
                else:
                    conn.execute(_sql(f"ALTER TABLE orders ADD COLUMN {col} BLOB"))
            elif col == "dhl_status":
                conn.execute(_sql(f"ALTER TABLE orders ADD COLUMN {col} TEXT NOT NULL DEFAULT ''"))
            else:
                conn.execute(_sql(f"ALTER TABLE orders ADD COLUMN {col} TEXT NOT NULL DEFAULT ''"))
            conn.commit()
        except Exception:
            conn.rollback()
    try:
        if USE_PG:
            conn.execute(_sql(
                "CREATE TABLE IF NOT EXISTS dhl_config ("
                "id INTEGER PRIMARY KEY DEFAULT 1, "
                "sender_name TEXT NOT NULL DEFAULT '', "
                "sender_street TEXT NOT NULL DEFAULT '', "
                "sender_number TEXT NOT NULL DEFAULT '', "
                "sender_plz TEXT NOT NULL DEFAULT '', "
                "sender_city TEXT NOT NULL DEFAULT '', "
                "sender_email TEXT NOT NULL DEFAULT '', "
                "sender_phone TEXT NOT NULL DEFAULT '', "
                "updated_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"'))"
            ))
        else:
            conn.execute(_sql(
                "CREATE TABLE IF NOT EXISTS dhl_config ("
                "id INTEGER PRIMARY KEY DEFAULT 1, "
                "sender_name TEXT NOT NULL DEFAULT '', "
                "sender_street TEXT NOT NULL DEFAULT '', "
                "sender_number TEXT NOT NULL DEFAULT '', "
                "sender_plz TEXT NOT NULL DEFAULT '', "
                "sender_city TEXT NOT NULL DEFAULT '', "
                "sender_email TEXT NOT NULL DEFAULT '', "
                "sender_phone TEXT NOT NULL DEFAULT '', "
                "updated_at TEXT NOT NULL DEFAULT (datetime('now')))"
            ))
        conn.commit()
    except Exception:
        conn.rollback()
    try:
        conn.execute(_sql("ALTER TABLE products ADD COLUMN sell_per_kg INTEGER NOT NULL DEFAULT 0"))
        conn.commit()
    except Exception:
        conn.rollback()
    seed_products(conn)
    conn.commit()
    seed_plant_catalog(conn)
    conn.commit()
    seed_email_templates(conn)
    conn.commit()
    conn.close()


def seed_products(conn):
    cur = conn.execute("SELECT COUNT(*) AS c FROM products")
    if cur.fetchone()["c"] > 0:
        return
    for slug, info in CATALOG.items():
        conn.execute(
            _sql("INSERT INTO products (slug, name, category, price_cents, \"desc\", image, stock, custom, visible) "
                 "VALUES (%s, %s, %s, %s, %s, %s, %s, 0, 1)"),
            (slug, info["name"], info["category"], info["price_cents"], info.get("desc", ""), info.get("image", ""), None),
        )


# ---- users ----

def get_user_by_username(username):
    conn = get_conn()
    row = conn.execute(_sql("SELECT * FROM users WHERE username = %s"), (username,)).fetchone()
    conn.close()
    return row_to_dict(row)


def get_user_by_email(email):
    conn = get_conn()
    row = conn.execute(_sql("SELECT * FROM users WHERE email = %s"), (email,)).fetchone()
    conn.close()
    return row_to_dict(row)


def get_user_by_email_ci(email):
    conn = get_conn()
    row = conn.execute(
        _sql("SELECT * FROM users WHERE LOWER(email) = LOWER(%s)"), (email,)
    ).fetchone()
    conn.close()
    return row_to_dict(row)


def get_user_by_id(user_id):
    conn = get_conn()
    row = conn.execute(_sql("SELECT * FROM users WHERE id = %s"), (user_id,)).fetchone()
    conn.close()
    return row_to_dict(row)


def create_user(username, email, password_hash, newsletter=0):
    conn = get_conn()
    cur = conn.execute(
        _sql("INSERT INTO users (username, email, password_hash, newsletter) VALUES (%s, %s, %s, %s)") + _ret_id(),
        (username, email, password_hash, int(bool(newsletter))),
    )
    user_id = _insert_id(cur)
    conn.commit()
    conn.close()
    return user_id


def update_profile(user_id, name, email, phone):
    conn = get_conn()
    conn.execute(
        _sql("UPDATE users SET name = %s, email = %s, phone = %s WHERE id = %s"),
        (name, email, phone, user_id),
    )
    conn.commit()
    conn.close()


def set_newsletter_consented(user_id, value):
    conn = get_conn()
    conn.execute(
        _sql("UPDATE users SET newsletter_consented = %s WHERE id = %s"),
        (int(bool(value)), user_id),
    )
    conn.commit()
    conn.close()


def set_user_newsletter(user_id, value):
    conn = get_conn()
    conn.execute(
        _sql("UPDATE users SET newsletter = %s WHERE id = %s"),
        (int(bool(value)), user_id),
    )
    conn.commit()
    conn.close()


def set_admin_role(username):
    conn = get_conn()
    conn.execute(_sql("UPDATE users SET role = 'admin' WHERE username = %s"), (username,))
    conn.commit()
    conn.close()


def list_all_customers():
    conn = get_conn()
    rows = conn.execute(
        _sql(
            "SELECT u.id, u.username, u.email, u.name, u.phone, u.role, u.newsletter, u.created_at, "
            "COUNT(o.id) AS order_count, "
            "COALESCE(SUM(o.total_cents), 0) AS total_spent_cents, "
            "MAX(o.created_at) AS last_order_at "
            "FROM users u "
            "LEFT JOIN orders o ON o.user_id = u.id "
            "GROUP BY u.id "
            "ORDER BY u.created_at DESC"
        )
    ).fetchall()
    conn.close()
    return [row_to_dict(r) for r in rows]


def get_customer_orders(user_id):
    conn = get_conn()
    rows = conn.execute(
        _sql("SELECT * FROM orders WHERE user_id = %s ORDER BY created_at DESC"), (user_id,)
    ).fetchall()
    conn.close()
    return [row_to_dict(r) for r in rows]


# ---- sessions ----

def _now_iso():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def prune_sessions(conn=None):
    close = conn is None
    conn = conn or get_conn()
    try:
        conn.execute(
            _sql("DELETE FROM sessions WHERE expires_at IS NOT NULL AND expires_at < %s"),
            (_now_iso(),),
        )
        conn.commit()
    finally:
        if close:
            conn.close()


def get_user_by_token(token):
    if not token:
        return None
    prune_sessions()
    conn = get_conn()
    row = conn.execute(
        _sql(
            "SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id "
            "WHERE s.token = %s AND (s.expires_at IS NULL OR s.expires_at > %s)"
        ),
        (_hash_token(token), _now_iso()),
    ).fetchone()
    conn.close()
    return row_to_dict(row)


def create_session(token, user_id):
    conn = get_conn()
    expires_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() + SESSION_TTL))
    conn.execute(
        _sql("INSERT INTO sessions (token, user_id, expires_at) VALUES (%s, %s, %s)"),
        (_hash_token(token), user_id, expires_at),
    )
    conn.commit()
    conn.close()


def delete_session(token):
    conn = get_conn()
    conn.execute(_sql("DELETE FROM sessions WHERE token = %s"), (_hash_token(token),))
    conn.commit()
    conn.close()


# ---- password reset ----

def create_password_reset(user_id, token, expires_at):
    conn = get_conn()
    conn.execute(
        _sql("INSERT INTO password_resets (user_id, token, expires_at) VALUES (%s, %s, %s)"),
        (user_id, token, expires_at),
    )
    conn.commit()
    conn.close()


def get_password_reset(token):
    conn = get_conn()
    row = conn.execute(_sql("SELECT * FROM password_resets WHERE token = %s"), (token,)).fetchone()
    conn.close()
    return row_to_dict(row)


def clear_password_resets(user_id):
    conn = get_conn()
    conn.execute(_sql("DELETE FROM password_resets WHERE user_id = %s"), (user_id,))
    conn.commit()
    conn.close()


def consume_password_reset(token):
    conn = get_conn()
    conn.execute(_sql("UPDATE password_resets SET used = 1 WHERE token = %s"), (token,))
    conn.commit()
    conn.close()


def set_user_password(user_id, password_hash):
    conn = get_conn()
    conn.execute(_sql("UPDATE users SET password_hash = %s WHERE id = %s"), (password_hash, user_id))
    conn.commit()
    conn.close()


def delete_user_sessions(user_id):
    conn = get_conn()
    conn.execute(_sql("DELETE FROM sessions WHERE user_id = %s"), (user_id,))
    conn.commit()
    conn.close()


# ---- products ----

def list_products():
    conn = get_conn()
    rows = conn.execute(
        "SELECT * FROM products WHERE visible = 1 ORDER BY custom DESC, id ASC"
    ).fetchall()
    conn.close()
    return all_rows(rows)


def admin_list_products():
    conn = get_conn()
    rows = conn.execute("SELECT * FROM products ORDER BY custom DESC, id ASC").fetchall()
    conn.close()
    return all_rows(rows)


def get_product(slug):
    conn = get_conn()
    row = conn.execute(_sql("SELECT * FROM products WHERE slug = %s"), (slug,)).fetchone()
    conn.close()
    return row_to_dict(row)


def add_product(slug, name, category, price_cents, stock=None, desc="", image="", sell_per_kg=0):
    conn = get_conn()
    conn.execute(
        _sql("INSERT INTO products (slug, name, category, price_cents, \"desc\", image, stock, custom, visible, sell_per_kg) "
             "VALUES (%s, %s, %s, %s, %s, %s, %s, 1, 1, %s)"),
        (slug, name, category, price_cents, desc, image, stock, sell_per_kg),
    )
    conn.commit()
    conn.close()


def update_product(slug, name, category, price_cents, stock, desc="", image="", sell_per_kg=None):
    conn = get_conn()
    if sell_per_kg is not None:
        conn.execute(
            _sql("UPDATE products SET name = %s, category = %s, price_cents = %s, stock = %s, \"desc\" = %s, image = %s, sell_per_kg = %s WHERE slug = %s"),
            (name, category, price_cents, stock, desc, image, sell_per_kg, slug),
        )
    else:
        conn.execute(
            _sql("UPDATE products SET name = %s, category = %s, price_cents = %s, stock = %s, \"desc\" = %s, image = %s WHERE slug = %s"),
            (name, category, price_cents, stock, desc, image, slug),
        )
    conn.commit()
    conn.close()


def set_product_image(slug, image):
    conn = get_conn()
    conn.execute(_sql("UPDATE products SET image = %s WHERE slug = %s"), (image, slug))
    conn.commit()
    conn.close()


def delete_product(slug):
    conn = get_conn()
    conn.execute(_sql("UPDATE products SET visible = 0 WHERE slug = %s"), (slug,))
    conn.commit()
    conn.close()


def decrement_stock(items):
    conn = get_conn()
    for item in items:
        slug = item.get("id")
        qty = float(item.get("qty", 0))
        if not slug or qty <= 0:
            continue
        conn.execute(
            _sql("UPDATE products SET stock = GREATEST(0, stock - %s) WHERE slug = %s AND stock IS NOT NULL"),
            (qty, slug),
        )
    conn.commit()
    conn.close()


def restore_stock(items):
    conn = get_conn()
    for item in items:
        slug = item.get("id")
        qty = float(item.get("qty", 0))
        if not slug or qty <= 0:
            continue
        conn.execute(
            _sql("UPDATE products SET stock = COALESCE(stock, 0) + %s WHERE slug = %s AND stock IS NOT NULL"),
            (qty, slug),
        )
    conn.commit()
    conn.close()


# ---- orders ----

def create_order(order):
    conn = get_conn()
    cur = conn.execute(
        _sql("INSERT INTO orders (order_no, user_id, stripe_session_id, items_json, subtotal_cents, "
             "shipping_cents, discount_cents, total_cents, coupon_code, "
             "delivery_method, delivery_street, delivery_zip, delivery_city, "
             "customer_name, customer_email, customer_phone, status, customer_confirmed, customer_confirmed_at, "
             "return_requested, return_reason, return_processed, refunded, refunded_at, stripe_refund_id, "
             "stripe_payment_intent, created_at) "
             "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)") + _ret_id(),
        (
            order["order_no"],
            order.get("user_id"),
            order.get("stripe_session_id"),
            json.dumps(order.get("items", []), ensure_ascii=False),
            order.get("subtotal_cents", 0),
            order.get("shipping_cents", 0),
            order.get("discount_cents", 0),
            order.get("total_cents", 0),
            order.get("coupon_code", ""),
            order.get("delivery_method", "pickup"),
            order.get("delivery_street", ""),
            order.get("delivery_zip", ""),
            order.get("delivery_city", ""),
            order.get("customer_name", ""),
            order.get("customer_email", ""),
            order.get("customer_phone", ""),
            order.get("status", "Eingegangen"),
            int(order.get("customer_confirmed", False)),
            order.get("customer_confirmed_at"),
            int(order.get("return_requested", False)),
            order.get("return_reason"),
            int(order.get("return_processed", False)),
            int(order.get("refunded", False)),
            order.get("refunded_at"),
            order.get("stripe_refund_id"),
            order.get("stripe_payment_intent"),
            order.get("created_at") or time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        ),
    )
    order_id = _insert_id(cur)
    conn.commit()
    conn.close()
    return order_id


def get_order_by_session(session_id):
    conn = get_conn()
    row = conn.execute(_sql("SELECT * FROM orders WHERE stripe_session_id = %s"), (session_id,)).fetchone()
    conn.close()
    return row_to_dict(row)


def get_order_by_payment_intent(payment_intent):
    conn = get_conn()
    row = conn.execute(
        _sql("SELECT * FROM orders WHERE stripe_payment_intent = %s"), (payment_intent,)
    ).fetchone()
    conn.close()
    return row_to_dict(row)


def get_order(order_no):
    conn = get_conn()
    row = conn.execute(_sql("SELECT * FROM orders WHERE order_no = %s"), (order_no,)).fetchone()
    conn.close()
    return row_to_dict(row)


def list_orders_for_user(user_id):
    conn = get_conn()
    rows = conn.execute(
        _sql("SELECT * FROM orders WHERE user_id = %s ORDER BY created_at DESC, id DESC"), (user_id,)
    ).fetchall()
    conn.close()
    return all_rows(rows)


def list_all_orders():
    conn = get_conn()
    rows = conn.execute("SELECT * FROM orders ORDER BY created_at DESC, id DESC").fetchall()
    conn.close()
    return all_rows(rows)


def update_order(order_no, fields):
    conn = get_conn()
    keys = list(fields.keys())
    set_clause = ", ".join(f"{k} = %s" for k in keys)
    conn.execute(_sql(f"UPDATE orders SET {set_clause} WHERE order_no = %s"), (*fields.values(), order_no))
    conn.commit()
    conn.close()


def delete_order(order_no):
    conn = get_conn()
    conn.execute(_sql("DELETE FROM orders WHERE order_no = %s"), (order_no,))
    conn.commit()
    conn.close()


# ---- contact messages ----

def create_contact_message(name, email, message, user_id=None):
    conn = get_conn()
    conn.execute(
        _sql("INSERT INTO messages (user_id, name, email, message) VALUES (%s, %s, %s, %s)"),
        (user_id, name, email, message),
    )
    conn.commit()
    conn.close()


def list_contact_messages():
    conn = get_conn()
    rows = conn.execute("SELECT * FROM messages ORDER BY created_at DESC, id DESC").fetchall()
    conn.close()
    return all_rows(rows)


def mark_contact_message_read(message_id):
    conn = get_conn()
    conn.execute(_sql("UPDATE messages SET read = 1 WHERE id = %s"), (message_id,))
    conn.commit()
    conn.close()


def delete_contact_message(message_id):
    conn = get_conn()
    conn.execute(_sql("DELETE FROM messages WHERE id = %s"), (message_id,))
    conn.commit()
    conn.close()


# ---- mail log ----

def log_email_attempt(recipient, subject, ok, error=""):
    try:
        conn = get_conn()
        conn.execute(
            _sql("INSERT INTO mail_log (recipient, subject, ok, error) VALUES (%s, %s, %s, %s)"),
            (recipient or "", (subject or "")[:200], int(bool(ok)), (error or "")[:500]),
        )
        conn.commit()
        conn.close()
    except Exception:
        pass


# ---- page views / traffic ----

def record_view(path):
    conn = get_conn()
    conn.execute(
        _sql("INSERT INTO page_views (path, created_at) VALUES (%s, %s)"),
        (path, time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime())),
    )
    conn.commit()
    conn.close()


def _insert_ignore_sql(table, columns, conflict_col):
    cols = ", ".join(columns)
    ph = ", ".join(["%s"] * len(columns))
    if USE_PG:
        return _sql(f"INSERT INTO {table} ({cols}) VALUES ({ph}) ON CONFLICT ({conflict_col}) DO NOTHING")
    return _sql(f"INSERT OR IGNORE INTO {table} ({cols}) VALUES ({ph})")


def record_visitor(visitor_id, day):
    if not visitor_id:
        return
    now = time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime())
    conn = get_conn()
    try:
        conn.execute(_insert_ignore_sql("visitors", ["visitor_id", "created_at"], "visitor_id"), (visitor_id, now))
    except Exception:
        conn.rollback()
    try:
        conn.execute(
            _insert_ignore_sql("visitor_days", ["visitor_id", "day", "created_at"], "visitor_id, day"),
            (visitor_id, day, now),
        )
    except Exception:
        conn.rollback()
    conn.commit()
    conn.close()


def get_daily_visitors(days=14):
    conn = get_conn()
    start = time.strftime("%Y-%m-%d", time.gmtime(time.time() - (days - 1) * 86400))
    rows = conn.execute(
        _sql("SELECT day, COUNT(*) AS c FROM visitor_days WHERE day >= %s GROUP BY day ORDER BY day"),
        (start,),
    ).fetchall()
    conn.close()
    by_day = {r["day"]: r["c"] for r in rows}
    out = []
    for i in range(days):
        d = time.strftime("%Y-%m-%d", time.gmtime(time.time() - (days - 1 - i) * 86400))
        out.append({"date": d, "count": by_day.get(d, 0)})
    return out


def get_view_stats():
    conn = get_conn()
    today = time.strftime("%Y-%m-%d", time.gmtime())
    week_start = time.strftime("%Y-%m-%d", time.gmtime(time.time() - 6 * 86400))
    total = conn.execute("SELECT COUNT(*) AS c FROM page_views").fetchone()["c"]
    today_count = conn.execute(
        _sql("SELECT COUNT(*) AS c FROM page_views WHERE substr(created_at, 1, 10) = %s"),
        (today,),
    ).fetchone()["c"]
    week_count = conn.execute(
        _sql("SELECT COUNT(*) AS c FROM page_views WHERE created_at >= %s"),
        (week_start,),
    ).fetchone()["c"]
    top_rows = conn.execute(
        _sql("SELECT path, COUNT(*) AS c FROM page_views GROUP BY path ORDER BY c DESC LIMIT 10")
    ).fetchall()
    unique_total = conn.execute("SELECT COUNT(*) AS c FROM visitors").fetchone()["c"]
    unique_today = conn.execute(
        _sql("SELECT COUNT(*) AS c FROM visitor_days WHERE day = %s"), (today,)
    ).fetchone()["c"]
    unique_week = conn.execute(
        _sql("SELECT COUNT(*) AS c FROM visitor_days WHERE day >= %s"), (week_start,)
    ).fetchone()["c"]
    conn.close()
    return {
        "total": total,
        "today": today_count,
        "week": week_count,
        "unique_total": unique_total,
        "unique_today": unique_today,
        "unique_week": unique_week,
        "top_pages": [{"path": r["path"], "count": r["c"]} for r in top_rows],
        "daily": get_daily_views(14),
        "daily_visitors": get_daily_visitors(14),
    }


def get_daily_views(days=14):
    conn = get_conn()
    rows = conn.execute(
        _sql(
            "SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS c FROM page_views "
            "WHERE substr(created_at, 1, 10) >= %s GROUP BY day ORDER BY day"
        ),
        (time.strftime("%Y-%m-%d", time.gmtime(time.time() - (days - 1) * 86400)),),
    ).fetchall()
    conn.close()
    by_day = {r["day"]: r["c"] for r in rows}
    out = []
    for i in range(days):
        d = time.strftime("%Y-%m-%d", time.gmtime(time.time() - (days - 1 - i) * 86400))
        out.append({"date": d, "count": by_day.get(d, 0)})
    return out


# ---- coupons ----


def list_coupons():
    conn = get_conn()
    rows = conn.execute(_sql("SELECT * FROM coupons ORDER BY id DESC")).fetchall()
    conn.close()
    return all_rows(rows)


def get_coupon(code):
    conn = get_conn()
    row = conn.execute(_sql("SELECT * FROM coupons WHERE UPPER(code) = UPPER(%s)"), (code,)).fetchone()
    conn.close()
    return row_to_dict(row)


def get_coupon_by_id(coupon_id):
    conn = get_conn()
    row = conn.execute(_sql("SELECT * FROM coupons WHERE id = %s"), (coupon_id,)).fetchone()
    conn.close()
    return row_to_dict(row)


def add_coupon(code, discount_type, discount_value, min_total_cents, max_uses, valid_from, valid_until):
    conn = get_conn()
    cur = conn.execute(
        _sql("INSERT INTO coupons (code, discount_type, discount_value, min_total_cents, max_uses, valid_from, valid_until) "
             "VALUES (%s, %s, %s, %s, %s, %s, %s)") + _ret_id(),
        (code.upper(), discount_type, discount_value, min_total_cents, max_uses, valid_from, valid_until),
    )
    cid = _insert_id(cur)
    conn.commit()
    conn.close()
    return cid


def update_coupon(coupon_id, fields):
    conn = get_conn()
    keys = list(fields.keys())
    set_clause = ", ".join(f"{k} = %s" for k in keys)
    conn.execute(_sql(f"UPDATE coupons SET {set_clause} WHERE id = %s"), (*fields.values(), coupon_id))
    conn.commit()
    conn.close()


def delete_coupon(coupon_id):
    conn = get_conn()
    conn.execute(_sql("DELETE FROM coupons WHERE id = %s"), (coupon_id,))
    conn.commit()
    conn.close()


def increment_coupon_usage(code):
    conn = get_conn()
    conn.execute(_sql("UPDATE coupons SET used_count = used_count + 1 WHERE UPPER(code) = UPPER(%s)"), (code,))
    conn.commit()
    conn.close()


# ---- field plans / crop planner ----

def list_field_plans():
    conn = get_conn()
    rows = conn.execute("SELECT * FROM field_plans ORDER BY id DESC").fetchall()
    conn.close()
    return all_rows(rows)


def get_field_plan(plan_id):
    conn = get_conn()
    row = conn.execute(_sql("SELECT * FROM field_plans WHERE id = %s"), (plan_id,)).fetchone()
    conn.close()
    return row_to_dict(row)


def create_field_plan(name):
    conn = get_conn()
    cur = conn.execute(
        _sql("INSERT INTO field_plans (name) VALUES (%s)") + _ret_id(), (name,)
    )
    plan_id = _insert_id(cur)
    conn.commit()
    conn.close()
    return plan_id


def update_field_plan(plan_id, fields):
    if not fields:
        return
    conn = get_conn()
    keys = list(fields.keys())
    set_clause = ", ".join(f"{k} = %s" for k in keys)
    conn.execute(_sql(f"UPDATE field_plans SET {set_clause} WHERE id = %s"), (*fields.values(), plan_id))
    conn.commit()
    conn.close()


def delete_field_plan(plan_id):
    conn = get_conn()
    conn.execute(_sql("DELETE FROM field_plans WHERE id = %s"), (plan_id,))
    conn.commit()
    conn.close()


def list_field_sections(plan_id):
    conn = get_conn()
    rows = conn.execute(
        _sql("SELECT * FROM field_sections WHERE plan_id = %s ORDER BY id ASC"), (plan_id,)
    ).fetchall()
    conn.close()
    return all_rows(rows)


def get_field_section(section_id):
    conn = get_conn()
    row = conn.execute(_sql("SELECT * FROM field_sections WHERE id = %s"), (section_id,)).fetchone()
    conn.close()
    return row_to_dict(row)


def create_field_section(plan_id, data):
    conn = get_conn()
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    cur = conn.execute(
        _sql(
            "INSERT INTO field_sections "
            "(plan_id, name, plant_name, plant_variety, planting_date, growth_stage, "
            "expected_harvest, notes, watering_schedule, points_json, color, created_at, updated_at) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)" + _ret_id()
        ),
        (
            plan_id,
            data.get("name", ""),
            data.get("plant_name", ""),
            data.get("plant_variety", ""),
            data.get("planting_date"),
            data.get("growth_stage", "Saat"),
            data.get("expected_harvest"),
            data.get("notes", ""),
            data.get("watering_schedule", ""),
            data.get("points_json", "[]"),
            data.get("color", "#3f6b3b"),
            now,
            now,
        ),
    )
    section_id = _insert_id(cur)
    conn.commit()
    conn.close()
    return section_id


def update_field_section(section_id, fields):
    if not fields:
        return
    conn = get_conn()
    fields["updated_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    keys = list(fields.keys())
    set_clause = ", ".join(f"{k} = %s" for k in keys)
    conn.execute(_sql(f"UPDATE field_sections SET {set_clause} WHERE id = %s"), (*fields.values(), section_id))
    conn.commit()
    conn.close()


def delete_field_section(section_id):
    conn = get_conn()
    conn.execute(_sql("DELETE FROM field_sections WHERE id = %s"), (section_id,))
    conn.commit()
    conn.close()


# ---- Plant Catalog ----

def list_plant_catalog():
    conn = get_conn()
    rows = conn.execute(_sql("SELECT * FROM plant_catalog ORDER BY category, name")).fetchall()
    conn.close()
    return all_rows(rows)


def get_plant_catalog_entry(entry_id):
    conn = get_conn()
    row = conn.execute(_sql("SELECT * FROM plant_catalog WHERE id = %s"), (entry_id,)).fetchone()
    conn.close()
    return row_to_dict(row)


def create_plant_catalog_entry(data):
    conn = get_conn()
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    cur = conn.execute(
        _sql(
            "INSERT INTO plant_catalog (name, category, watering, companions, incompatible, yield_kg, price_per_kg, created_at, updated_at) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)" + _ret_id()
        ),
        (
            data.get("name", ""),
            data.get("category", ""),
            data.get("watering", ""),
            json.dumps(data.get("companions", []), ensure_ascii=False),
            json.dumps(data.get("incompatible", []), ensure_ascii=False),
            data.get("yield_kg"),
            data.get("price_per_kg"),
            now,
            now,
        ),
    )
    entry_id = _insert_id(cur)
    conn.commit()
    conn.close()
    return entry_id


def update_plant_catalog_entry(entry_id, fields):
    if not fields:
        return
    conn = get_conn()
    fields["updated_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    keys = list(fields.keys())
    set_clause = ", ".join(f"{k} = %s" for k in keys)
    conn.execute(_sql(f"UPDATE plant_catalog SET {set_clause} WHERE id = %s"), (*fields.values(), entry_id))
    conn.commit()
    conn.close()


def delete_plant_catalog_entry(entry_id):
    conn = get_conn()
    conn.execute(_sql("DELETE FROM plant_catalog WHERE id = %s"), (entry_id,))
    conn.commit()
    conn.close()


def seed_plant_catalog(conn):
    cur = conn.execute("SELECT COUNT(*) AS c FROM plant_catalog")
    if cur.fetchone()["c"] > 0:
        return
    plants = [
        ("Basilikum", "Küchenkräuter", "Regelmäßig feucht halten", ["Tomaten", "Paprika", "Chili"], ["Salbei", "Rauten"], 0.8, 15.0),
        ("Petersilie", "Küchenkräuter", "Gleichmäßig feucht", ["Tomaten", "Chili", "Spargel"], [], 0.6, 10.0),
        ("Dill", "Küchenkräuter", "Gleichmäßig feucht", ["Gurke", "Kohlsorten", "Zwiebeln"], ["Karotten"], 0.5, 10.0),
        ("Schnittlauch", "Küchenkräuter", "Mäßig feucht", ["Tomaten", "Karotten"], [], 0.5, 12.0),
        ("Koriander", "Küchenkräuter", "Regelmäßig feucht", ["Spinat", "Kohlsorten"], ["Fenchel"], 0.4, 8.0),
        ("Kerbel", "Küchenkräuter", "Gleichmäßig feucht", ["Erbsen", "Tomaten"], [], 0.3, 10.0),
        ("Liebstöckel", "Küchenkräuter", "Mäßig feucht", ["Tomaten", "Paprika", "Karotten"], [], 0.5, 8.0),
        ("Borretsch", "Küchenkräuter", "Regelmäßig feucht", ["Tomaten", "Bohnen", "Zucchini"], [], 0.3, 10.0),
        ("Ringelblume", "Heilkräuter", "Mäßig feucht", ["Tomaten", "Bohnen"], [], 0.2, 20.0),
        ("Kamille", "Heilkräuter", "Trocken bis mäßig", ["Lavendel", "Thymian"], ["Minze"], 0.1, 25.0),
        ("Lavendel", "Heilkräuter", "Trocken halten", ["Rosmarin", "Thymian", "Salbei"], [], 0.1, 30.0),
        ("Salbei", "Heilkräuter", "Trocken bis mäßig", ["Rosmarin", "Thymian", "Lavendel"], ["Basilikum", "Gurke"], 0.3, 12.0),
        ("Thymian", "Heilkräuter", "Trocken halten", ["Rosmarin", "Lavendel", "Salbei"], [], 0.2, 12.0),
        ("Rosmarin", "Heilkräuter", "Trocken halten", ["Thymian", "Lavendel", "Salbei", "Bohnen"], ["Gurke"], 0.2, 12.0),
        ("Minze", "Heilkräuter", "Feucht halten", ["Tomaten", "Lattich"], ["Kamille", "Chamisso"], 1.0, 10.0),
        ("Echinacea", "Heilkräuter", "Mäßig feucht", ["Ringelblume", "Sonnenblume"], [], 0.1, 30.0),
        ("Arnikablume", "Heilkräuter", "Mäßig feucht", ["Sonnenblume"], [], 0.1, 25.0),
        ("Melisse", "Heilkräuter", "Gleichmäßig feucht", ["Tomaten", "Bohnen"], ["Minze (Ausbreitung)"], 0.6, 12.0),
        ("Ysop", "Heilkräuter", "Trocken bis mäßig", ["Kohlsorten", "Salbei"], [], 0.2, 10.0),
        ("Pfefferminze", "Heilkräuter", "Feucht halten", ["Tomaten", "Lattich"], ["Kamille"], 1.0, 10.0),
        ("Johanniskraut", "Heilkräuter", "Mäßig feucht", ["Sonnenblume"], [], 0.1, 20.0),
        ("Frauenmantel", "Heilkräuter", "Gleichmäßig feucht", ["Kamille"], [], 0.2, 8.0),
        ("Beinwell", "Heilkräuter", "Feucht halten", ["Tomaten", "Bohnen"], [], 0.3, 15.0),
        ("Oregano", "Küchenkräuter", "Trocken bis mäßig", ["Tomaten", "Paprika", "Bohnen"], [], 0.4, 12.0),
        ("Majoran", "Küchenkräuter", "Mäßig feucht", ["Tomaten", "Paprika"], [], 0.4, 12.0),
        ("Pimenton", "Küchenkräuter", "Mäßig feucht", ["Basilikum"], [], 0.4, 12.0),
        ("Tomaten", "Gemüse", "Regelmäßig feucht", ["Basilikum", "Petersilie", "Karotten", "Ringelblume"], ["Fenchel", "Kohlsorten"], 5.0, 3.5),
        ("Paprika", "Gemüse", "Regelmäßig feucht", ["Basilikum", "Tomaten", "Oregano"], [], 3.0, 4.0),
        ("Chili", "Gemüse", "Regelmäßig feucht", ["Basilikum", "Tomaten", "Petersilie"], [], 1.5, 8.0),
        ("Gurke", "Gemüse", "Regelmäßig feucht halten", ["Dill", "Erbsen", "Bohnen", "Sonnenblume"], ["Salbei", "Rosmarin", "Minze"], 4.0, 2.5),
        ("Zucchini", "Gemüse", "Regelmäßig feucht", ["Borretsch", "Bohnen", "Mais"], [], 4.5, 2.5),
        ("Kürbis", "Gemüse", "Regelmäßig feucht", ["Mais", "Bohnen", "Ringelblume"], [], 3.5, 2.0),
        ("Tomate", "Gemüse", "Regelmäßig feucht", ["Basilikum", "Petersilie", "Karotten"], ["Fenchel", "Kohlsorten"], 5.0, 3.5),
        ("Erbsen", "Gemüse", "Gleichmäßig feucht", ["Karotten", "Radieschen", "Gurke", "Dill"], ["Zwiebeln", "Knoblauch"], 1.0, 4.0),
        ("Bohnen", "Gemüse", "Regelmäßig feucht", ["Gurke", "Kürbis", "Zucchini", "Salat"], ["Zwiebeln", "Knoblauch", "Fenchel"], 1.5, 4.0),
        ("Karotten", "Gemüse", "Gleichmäßig feucht", ["Tomaten", "Erbsen", "Radieschen", "Schnittlauch"], ["Dill"], 3.0, 2.5),
        ("Radieschen", "Gemüse", "Gleichmäßig feucht", ["Erbsen", "Karotten", "Salat", "Spinat"], [], 1.5, 5.0),
        ("Spinat", "Gemüse", "Gleichmäßig feucht", ["Erbsen", "Radieschen", "Kohlsorten"], [], 1.0, 3.0),
        ("Salat", "Gemüse", "Gleichmäßig feucht", ["Bohnen", "Karotten", "Radieschen"], [], 2.0, 3.0),
        ("Kohlsorten", "Gemüse", "Regelmäßig feucht", ["Dill", "Salbei", "Spinat", "Ringelblume"], ["Tomaten", "Erbsen", "Bohnen"], 3.0, 2.5),
        ("Zwiebeln", "Gemüse", "Mäßig feucht", ["Karotten", "Salat", "Tomaten"], ["Erbsen", "Bohnen"], 2.5, 1.5),
        ("Knoblauch", "Gemüse", "Mäßig feucht", ["Tomaten", "Paprika", "Rosmarin"], ["Erbsen", "Bohnen"], 0.8, 8.0),
        ("Fenchel", "Gemüse", "Gleichmäßig feucht", ["Koriander"], ["Tomaten", "Bohnen", "Kohlsorten"], 1.5, 3.0),
        ("Sonnenblume", "Blumen", "Mäßig feucht", ["Gurke", "Kürbis", "Ringelblume"], [], 0.3, 5.0),
        ("Tagetes", "Blumen", "Mäßig feucht", ["Tomaten", "Bohnen"], [], 0.1, 5.0),
        ("Lattich", "Blumen", "Gleichmäßig feucht", ["Minze", "Pfefferminze"], [], 1.5, 3.0),
    ]
    for name, cat, water, comp, incomp, ykg, ppk in plants:
        conn.execute(
            _sql("INSERT INTO plant_catalog (name, category, watering, companions, incompatible, yield_kg, price_per_kg) VALUES (%s, %s, %s, %s, %s, %s, %s)"),
            (name, cat, water, json.dumps(comp, ensure_ascii=False), json.dumps(incomp, ensure_ascii=False), ykg, ppk),
        )
    conn.commit()


# ---- email templates ----

DEFAULT_EMAIL_TEMPLATES = [
    {
        "key": "order_customer",
        "name": "Bestellbestätigung (Kunde)",
        "subject": "Ihre Bestellung {order_no} bei Irmgärtchen Heilkräuter",
        "body": (
            "Vielen Dank für Ihre Bestellung!\n\n"
            "Bestellnummer: {order_no}\n\n"
            "Ihre Bestellung:\n{items}\n"
            "Zwischensumme: {subtotal} EUR\n{discount}"
            "Versand: {shipping}\n"
            "Gesamtbetrag: {total} EUR\n\n{delivery}"
            'Sie koennen den Status jederzeit unter "Mein Konto" einsehen.'
        ),
        "enabled": 1,
    },
    {
        "key": "order_admin",
        "name": "Admin-Benachrichtigung (neue Bestellung)",
        "subject": "Neue Bestellung {order_no}",
        "body": (
            "Es ist eine neue Bestellung eingegangen.\n\n"
            "Bestellnummer: {order_no}\n"
            "Betrag: {total} EUR\n"
            "Lieferung: {delivery_text}\n"
            "{coupon}"
            "Kunde: {name}\n"
            "Telefon: {phone}\n"
            "E-Mail: {email}\n\n"
            "Bitte im Admin-Panel bearbeiten."
        ),
        "enabled": 1,
    },
    {
        "key": "status_change",
        "name": "Statusänderung (Kunde)",
        "subject": "Bestellung {order_no}: {status}",
        "body": "Der Status Ihrer Bestellung {order_no} hat sich geändert: {status}",
        "enabled": 1,
    },
    {
        "key": "contact_admin",
        "name": "Kontaktanfrage (Admin)",
        "subject": "Neue Kontaktanfrage von {name}",
        "body": (
            "Eine neue Nachricht über das Kontaktformular ist eingegangen.\n\n"
            "Name: {name}\n"
            "E-Mail: {email}\n\n"
            "Nachricht:\n{message}\n\n"
            'Im Admin-Panel unter \u201eNachrichten\u201c einsehbar.'
        ),
        "enabled": 1,
    },
    {
        "key": "password_reset",
        "name": "Passwort zurücksetzen",
        "subject": "Passwort zurücksetzen – Irmgärtchen Heilkräuter",
        "body": (
            "Hallo {name},\n\n"
            "Sie haben angefragt, Ihr Passwort zurückzusetzen.\n"
            "Klicken Sie auf den folgenden Link, um ein neues Passwort zu wählen "
            "(gültig für 60 Minuten):\n\n"
            "{reset_url}\n\n"
            "Falls Sie diese Anfrage nicht gestellt haben, können Sie diese E-Mail einfach ignorieren.\n\n"
            "Mit freundlichen Grüßen\n"
            "Ihr Irmgärtchen-Team"
        ),
        "enabled": 1,
    },
    {
        "key": "newsletter",
        "name": "Newsletter",
        "subject": "Irmgärtchen Newsletter – Ernte-News & Tipps",
        "body": (
            "Hallo {name},\n\n"
            "hier kommt dein Newsletter von Irmgärtchen Heilkräuter!\n\n"
            "{harvest_section}"
            "Viele Grüße\n"
            "Dein Irmgärtchen-Team"
        ),
        "enabled": 1,
    },
]


def seed_email_templates(conn):
    cur = conn.execute("SELECT COUNT(*) AS c FROM email_templates")
    if cur.fetchone()["c"] > 0:
        return
    for t in DEFAULT_EMAIL_TEMPLATES:
        conn.execute(
            _sql("INSERT INTO email_templates (key, name, subject, body, enabled) VALUES (%s, %s, %s, %s, %s)"),
            (t["key"], t["name"], t["subject"], t["body"], t["enabled"]),
        )


def list_email_templates():
    conn = get_conn()
    rows = conn.execute(_sql("SELECT * FROM email_templates ORDER BY id")).fetchall()
    conn.close()
    return [row_to_dict(r) for r in rows]


def get_email_template(key):
    conn = get_conn()
    row = conn.execute(_sql("SELECT * FROM email_templates WHERE key = %s"), (key,)).fetchone()
    conn.close()
    return row_to_dict(row)


def update_email_template(key, fields):
    if not fields:
        return
    sets = ", ".join(f"{k} = %s" for k in fields)
    vals = list(fields.values()) + [key]
    conn = get_conn()
    conn.execute(_sql(f"UPDATE email_templates SET {sets} WHERE key = %s"), vals)
    conn.commit()
    conn.close()


def get_setting(key, default=""):
    conn = get_conn()
    row = conn.execute(_sql("SELECT value FROM site_settings WHERE key = %s"), (key,)).fetchone()
    conn.close()
    return row["value"] if row else default


def set_setting(key, value):
    conn = get_conn()
    conn.execute(
        _sql("INSERT INTO site_settings (key, value) VALUES (%s, %s) ON CONFLICT(key) DO UPDATE SET value = %s"),
        (key, value, value),
    )
    conn.commit()
    conn.close()


def get_upcoming_harvests(days=14):
    conn = get_conn()
    now = time.strftime("%Y-%m-%d")
    end = time.strftime("%Y-%m-%d", time.localtime(time.time() + days * 86400))
    rows = conn.execute(
        _sql(
            "SELECT fs.name, fs.plant_name, fs.plant_variety, fs.expected_harvest, fp.name AS plan_name "
            "FROM field_sections fs "
            "JOIN field_plans fp ON fp.id = fs.plan_id "
            "WHERE fs.expected_harvest IS NOT NULL AND fs.expected_harvest != '' "
            "AND fs.expected_harvest >= %s AND fs.expected_harvest <= %s "
            "ORDER BY fs.expected_harvest ASC"
        ),
        (now, end),
    ).fetchall()
    conn.close()
    return [row_to_dict(r) for r in rows]


def get_newsletter_subscribers():
    conn = get_conn()
    rows = conn.execute(
        _sql("SELECT id, name, email FROM users WHERE newsletter = 1 AND email != '' AND email IS NOT NULL")
    ).fetchall()
    conn.close()
    return [row_to_dict(r) for r in rows]


def log_newsletter_send(recipient_count):
    conn = get_conn()
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    conn.execute(
        _sql("INSERT INTO mail_log (recipient, subject, ok, error, created_at) VALUES (%s, %s, %s, %s, %s)"),
        ("[newsletter]", f"Newsletter an {recipient_count} Empfänger", 1, "", now),
    )
    conn.commit()
    conn.close()


# ---- Crop Rotation ----

def save_crop_rotation_snapshot(plan_name, sections, plan_year):
    conn = get_conn()
    for s in sections:
        plant = s.get("plant_name", "")
        if not plant:
            continue
        section_name = s.get("name", "")
        conn.execute(
            _sql(
                "INSERT INTO crop_rotation_history (plan_name, section_name, plant_name, plant_family, plan_year) "
                "VALUES (%s, %s, %s, %s, %s)"
            ),
            (plan_name, section_name, plant, "", plan_year),
        )
    conn.commit()
    conn.close()


def get_crop_rotation_history():
    conn = get_conn()
    rows = conn.execute(_sql("SELECT * FROM crop_rotation_history ORDER BY plan_year DESC, plan_name")).fetchall()
    conn.close()
    return [row_to_dict(r) for r in rows]


def get_rotation_conflicts(sections, plant_families=None):
    history = get_crop_rotation_history()
    if not history:
        return []
    conflicts = []
    for s in sections:
        plant = s.get("plant_name", "")
        if not plant:
            continue
        s_name = s.get("name", "")
        family = (plant_families or {}).get(plant, "")
        for h in history:
            if h.get("section_name") != s_name:
                continue
            h_family = (plant_families or {}).get(h.get("plant_name", ""), "")
            if h.get("plant_name") == plant:
                conflicts.append({
                    "section_name": s_name,
                    "plant_name": plant,
                    "previous_year": h.get("plan_year"),
                    "previous_plant": h.get("plant_name"),
                    "message": f'{plant} wurde bereits in {h.get("plan_year")} in "{s_name}" angebaut.',
                })
                break
            elif family and h_family and family == h_family:
                conflicts.append({
                    "section_name": s_name,
                    "plant_name": plant,
                    "previous_year": h.get("plan_year"),
                    "previous_plant": h.get("plant_name"),
                    "message": f'Familie "{family}": {plant} nach {h.get("plant_name")} ({h.get("plan_year")}) in "{s_name}".',
                })
                break
    return conflicts


# ---- Backup / Restore ----

# Reihenfolge: parents zuerst (FK-sicher für INSERT), Kinder für DELETE rückwärts.
BACKUP_TABLES = [
    "users",
    "products",
    "sessions",
    "orders",
    "messages",
    "password_resets",
    "page_views",
    "visitors",
    "visitor_days",
    "mail_log",
    "coupons",
    "field_plans",
    "field_sections",
    "plant_catalog",
    "crop_rotation_history",
    "email_templates",
    "site_settings",
    "dhl_config",
]


def export_all_tables():
    conn = get_conn()
    data = {}
    for t in BACKUP_TABLES:
        rows = conn.execute(_sql("SELECT * FROM " + t)).fetchall()
        data[t] = [dict(r) for r in rows]
    conn.close()
    return data


def import_all_tables(data):
    conn = get_conn()
    try:
        for t in reversed(BACKUP_TABLES):
            conn.execute(_sql("DELETE FROM " + t))
        for t in BACKUP_TABLES:
            for row in data.get(t) or []:
                cols = list(row.keys())
                col_sql = ", ".join('"%s"' % c for c in cols)
                placeholders = ", ".join(["%s"] * len(cols))
                conn.execute(
                    _sql(f"INSERT INTO {t} ({col_sql}) VALUES ({placeholders})"),
                    [row[c] for c in cols],
                )
        if USE_PG:
            for t in BACKUP_TABLES:
                try:
                    conn.execute(
                        f"SELECT setval(pg_get_serial_sequence('{t}', 'id'), COALESCE(MAX(id), 1)) FROM {t}"
                    )
                except Exception:
                    pass
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


# ---- Shipping ----

def get_dhl_config():
    conn = get_conn()
    row = conn.execute(_sql("SELECT * FROM dhl_config WHERE id = 1")).fetchone()
    conn.close()
    if row:
        return row_to_dict(row)
    return {}


def save_dhl_config(data):
    conn = get_conn()
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    existing = get_dhl_config()
    if existing:
        conn.execute(
            _sql(
                "UPDATE dhl_config SET sender_name=%s, sender_street=%s, sender_number=%s, "
                "sender_plz=%s, sender_city=%s, sender_email=%s, sender_phone=%s, updated_at=%s WHERE id=1"
            ),
            (data.get("sender_name", ""), data.get("sender_street", ""), data.get("sender_number", ""),
             data.get("sender_plz", ""), data.get("sender_city", ""), data.get("sender_email", ""),
             data.get("sender_phone", ""), now),
        )
    else:
        conn.execute(
            _sql(
                "INSERT INTO dhl_config (id, sender_name, sender_street, sender_number, "
                "sender_plz, sender_city, sender_email, sender_phone, updated_at) "
                "VALUES (1, %s, %s, %s, %s, %s, %s, %s, %s)"
            ),
            (data.get("sender_name", ""), data.get("sender_street", ""), data.get("sender_number", ""),
             data.get("sender_plz", ""), data.get("sender_city", ""), data.get("sender_email", ""),
             data.get("sender_phone", ""), now),
        )
    conn.commit()
    conn.close()


def update_order_dhl(order_no, **kwargs):
    conn = get_conn()
    sets = []
    vals = []
    for k, v in kwargs.items():
        if k in ("dhl_shopping_cart_id", "dhl_notify_token", "dhl_tracking_number", "dhl_status", "dhl_product", "dhl_label_pdf"):
            sets.append(f"{k} = %s")
            vals.append(v)
    if sets:
        vals.append(order_no)
        conn.execute(_sql(f"UPDATE orders SET {', '.join(sets)} WHERE order_no = %s"), vals)
        conn.commit()
    conn.close()


def get_order_dhl(order_no):
    conn = get_conn()
    row = conn.execute(
        _sql("SELECT dhl_shopping_cart_id, dhl_tracking_number, dhl_status, dhl_product FROM orders WHERE order_no = %s"),
        (order_no,),
    ).fetchone()
    conn.close()
    return row_to_dict(row) if row else {}


def get_order_label_pdf(order_no):
    conn = get_conn()
    row = conn.execute(
        _sql("SELECT dhl_label_pdf FROM orders WHERE order_no = %s"),
        (order_no,),
    ).fetchone()
    conn.close()
    return row["dhl_label_pdf"] if row and row["dhl_label_pdf"] else None


def set_order_label_pdf(order_no, pdf_bytes):
    conn = get_conn()
    conn.execute(_sql("UPDATE orders SET dhl_label_pdf = %s, dhl_status = 'paid' WHERE order_no = %s"), (pdf_bytes, order_no))
    conn.commit()
    conn.close()


def find_order_by_notify_token(token):
    conn = get_conn()
    row = conn.execute(
        _sql("SELECT order_no FROM orders WHERE dhl_notify_token = %s AND dhl_status = 'pending'"),
        (token,),
    ).fetchone()
    conn.close()
    return row["order_no"] if row else None
