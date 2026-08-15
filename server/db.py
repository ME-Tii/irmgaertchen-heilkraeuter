import os
import sqlite3
import json
import time

from products import CATALOG

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
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );""",
    """CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
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
        total_cents INTEGER NOT NULL DEFAULT 0,
        delivery_method TEXT NOT NULL DEFAULT 'pickup',
        delivery_street TEXT NOT NULL DEFAULT '',
        delivery_zip TEXT NOT NULL DEFAULT '',
        delivery_city TEXT NOT NULL DEFAULT '',
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
        created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    );""",
    """CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
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
        total_cents INTEGER NOT NULL DEFAULT 0,
        delivery_method TEXT NOT NULL DEFAULT 'pickup',
        delivery_street TEXT NOT NULL DEFAULT '',
        delivery_zip TEXT NOT NULL DEFAULT '',
        delivery_city TEXT NOT NULL DEFAULT '',
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
    try:
        conn.execute(_sql("ALTER TABLE products ADD COLUMN image TEXT NOT NULL DEFAULT ''"))
        conn.commit()
    except Exception:
        conn.rollback()
    for slug, info in CATALOG.items():
        conn.execute(
            _sql("UPDATE products SET image = %s WHERE slug = %s AND (image = '' OR image IS NULL)"),
            (info.get("image", ""), slug),
        )
    conn.commit()
    seed_products(conn)
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


def get_user_by_id(user_id):
    conn = get_conn()
    row = conn.execute(_sql("SELECT * FROM users WHERE id = %s"), (user_id,)).fetchone()
    conn.close()
    return row_to_dict(row)


def create_user(username, email, password_hash):
    conn = get_conn()
    cur = conn.execute(
        _sql("INSERT INTO users (username, email, password_hash) VALUES (%s, %s, %s)") + _ret_id(),
        (username, email, password_hash),
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


def set_admin_role(username):
    conn = get_conn()
    conn.execute(_sql("UPDATE users SET role = 'admin' WHERE username = %s"), (username,))
    conn.commit()
    conn.close()


# ---- sessions ----

def get_user_by_token(token):
    conn = get_conn()
    row = conn.execute(
        _sql("SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = %s"),
        (token,),
    ).fetchone()
    conn.close()
    return row_to_dict(row)


def create_session(token, user_id):
    conn = get_conn()
    conn.execute(
        _sql("INSERT INTO sessions (token, user_id) VALUES (%s, %s)"),
        (token, user_id),
    )
    conn.commit()
    conn.close()


def delete_session(token):
    conn = get_conn()
    conn.execute(_sql("DELETE FROM sessions WHERE token = %s"), (token,))
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


def add_product(slug, name, category, price_cents, stock=None, desc="", image=""):
    conn = get_conn()
    conn.execute(
        _sql("INSERT INTO products (slug, name, category, price_cents, \"desc\", image, stock, custom, visible) "
             "VALUES (%s, %s, %s, %s, %s, %s, %s, 1, 1)"),
        (slug, name, category, price_cents, desc, image, stock),
    )
    conn.commit()
    conn.close()


def update_product(slug, name, category, price_cents, stock, desc="", image=""):
    conn = get_conn()
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
        qty = int(item.get("qty", 0))
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
        qty = int(item.get("qty", 0))
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
             "shipping_cents, total_cents, delivery_method, delivery_street, delivery_zip, delivery_city, "
             "status, customer_confirmed, customer_confirmed_at, return_requested, return_reason, "
             "return_processed, refunded, refunded_at, stripe_refund_id, stripe_payment_intent, created_at) "
             "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)") + _ret_id(),
        (
            order["order_no"],
            order.get("user_id"),
            order.get("stripe_session_id"),
            json.dumps(order.get("items", []), ensure_ascii=False),
            order.get("subtotal_cents", 0),
            order.get("shipping_cents", 0),
            order.get("total_cents", 0),
            order.get("delivery_method", "pickup"),
            order.get("delivery_street", ""),
            order.get("delivery_zip", ""),
            order.get("delivery_city", ""),
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


# ---- page views / traffic ----

def record_view(path):
    conn = get_conn()
    conn.execute(
        _sql("INSERT INTO page_views (path, created_at) VALUES (%s, %s)"),
        (path, time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime())),
    )
    conn.commit()
    conn.close()


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
    conn.close()
    return {
        "total": total,
        "today": today_count,
        "week": week_count,
        "top_pages": [{"path": r["path"], "count": r["c"]} for r in top_rows],
    }
