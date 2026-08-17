import os
import smtplib
from email.message import EmailMessage

SMTP_HOST = os.environ.get("SMTP_HOST", "")
SMTP_PORT = int(os.environ.get("SMTP_PORT", "587"))
SMTP_USER = os.environ.get("SMTP_USER", "")
SMTP_PASSWORD = os.environ.get("SMTP_PASSWORD", "")
SMTP_FROM = os.environ.get("SMTP_FROM", SMTP_USER or "shop@irmgaertchen.de")
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "")


def email_enabled():
    return bool(SMTP_HOST and SMTP_USER)


FALLBACK_PORTS = [2525, 465]


def _send(subject, to, text):
    if not email_enabled():
        _log(to, subject, False, "SMTP nicht konfiguriert")
        return False
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = SMTP_FROM
    msg["To"] = to
    msg.set_content(text, subtype="plain", charset="utf-8")
    candidates = [(SMTP_PORT, SMTP_PORT == 465)]
    for port in FALLBACK_PORTS:
        if port not in [c[0] for c in candidates]:
            candidates.append((port, port == 465))
    errors = []
    for port, ssl in candidates:
        try:
            if ssl:
                with smtplib.SMTP_SSL(SMTP_HOST, port, timeout=20) as server:
                    if SMTP_USER:
                        server.login(SMTP_USER, SMTP_PASSWORD)
                    server.send_message(msg)
            else:
                with smtplib.SMTP(SMTP_HOST, port, timeout=20) as server:
                    server.ehlo()
                    server.starttls()
                    server.ehlo()
                    if SMTP_USER:
                        server.login(SMTP_USER, SMTP_PASSWORD)
                    server.send_message(msg)
            _log(to, subject, True, f"({SMTP_HOST}:{port})")
            return True
        except Exception as e:
            # Nie den Bestellablauf blockieren, wenn das Mail nicht rausgeht.
            errors.append(f"({SMTP_HOST}:{port}) {e}")
    print(f"[mailer] Versand fehlgeschlagen: {' | '.join(errors)}")
    _log(to, subject, False, " | ".join(errors))
    return False


def _log(to, subject, ok, error):
    try:
        import db

        db.log_email_attempt(to, subject, ok, error)
    except Exception:
        pass


def notify_admin_order(order_no, total_euro, delivery_text, customer=None):
    if not ADMIN_EMAIL:
        return
    customer = customer or {}
    subject = f"Neue Bestellung {order_no}"
    lines = [
        f"Es ist eine neue Bestellung eingegangen.\n\n",
        f"Bestellnummer: {order_no}\n",
        f"Betrag: {total_euro} EUR\n",
        f"Lieferung: {delivery_text}\n",
    ]
    if customer.get("couponCode"):
        discount_euro = _fmt_euro(customer.get("discount", 0))
        lines.append(f"Gutschein: {customer['couponCode']} (-{discount_euro} EUR)\n")
    if customer.get("name"):
        lines.append(f"Kunde: {customer['name']}\n")
    if customer.get("phone"):
        lines.append(f"Telefon: {customer['phone']}\n")
    if customer.get("email"):
        lines.append(f"E-Mail: {customer['email']}\n")
    lines.append("\nBitte im Admin-Panel bearbeiten.")
    _send(subject, ADMIN_EMAIL, "".join(lines))


def _fmt_euro(value):
    return f"{value:.2f}".replace(".", ",")


def notify_customer_order(order, user_email=None):
    user_email = user_email or (order.get("customerEmail") or "")
    if not user_email:
        return
    order_no = order.get("order_no", "")
    subject = f"Ihre Bestellung {order_no} bei Irmgärtchen Heilkräuter"
    lines = [
        "Vielen Dank für Ihre Bestellung!\n\n",
        f"Bestellnummer: {order_no}\n\n",
        "Ihre Bestellung:\n",
    ]
    for it in order.get("items", []):
        lines.append(
            f"  {it.get('qty', 0)}x {it.get('name', '')} – "
            f"{_fmt_euro(it.get('price', 0))} EUR "
            f"(= {_fmt_euro(it.get('total', 0))} EUR)\n"
        )
    lines.append(f"\nZwischensumme: {_fmt_euro(order.get('subtotal', 0))} EUR\n")
    if order.get("discount") and order["discount"] > 0:
        code = order.get("couponCode", "")
        label = f"Gutscheincode {code}" if code else "Gutschein"
        lines.append(f"{label}: -{_fmt_euro(order['discount'])} EUR\n")
    if order.get("shipping"):
        lines.append(f"Versand (Post): {_fmt_euro(order['shipping'])} EUR\n")
    else:
        lines.append("Versand: kostenlos\n")
    lines.append(f"Gesamtbetrag: {_fmt_euro(order.get('total', 0))} EUR\n\n")

    delivery = order.get("delivery") or {}
    if delivery.get("method") == "delivery":
        lines.append(
            f"Lieferadresse:\n{delivery.get('street', '')}\n"
            f"{delivery.get('zip', '')} {delivery.get('city', '')}\n\n"
        )
    else:
        lines.append(
            "Abholung: Wir rufen Sie an, sobald Ihre Bestellung zur Abholung bereit ist.\n\n"
        )
    lines.append('Sie können den Status jederzeit unter „Mein Konto" einsehen.')
    _send(subject, user_email, "".join(lines))


def notify_customer_status(user_email, order_no, status):
    if not user_email:
        return
    subject = f"Bestellung {order_no}: {status}"
    text = f"Der Status Ihrer Bestellung {order_no} hat sich geändert: {status}"
    _send(subject, user_email, text)


def notify_admin_contact(name, email, message):
    if not ADMIN_EMAIL:
        return
    subject = f"Neue Kontaktanfrage von {name}"
    text = (
        f"Eine neue Nachricht über das Kontaktformular ist eingegangen.\n\n"
        f"Name: {name}\n"
        f"E-Mail: {email}\n\n"
        f"Nachricht:\n{message}\n\n"
        f"Im Admin-Panel unter „Nachrichten“ einsehbar."
    )
    _send(subject, ADMIN_EMAIL, text)


def send_password_reset(user_email, name, reset_url):
    if not user_email:
        return
    subject = "Passwort zurücksetzen – Irmgärtchen Heilkräuter"
    text = (
        f"Hallo {name},\n\n"
        f"Sie haben angefragt, Ihr Passwort zurückzusetzen.\n"
        f"Klicken Sie auf den folgenden Link, um ein neues Passwort zu wählen "
        f"(gültig für 60 Minuten):\n\n"
        f"{reset_url}\n\n"
        f"Falls Sie diese Anfrage nicht gestellt haben, können Sie diese E-Mail einfach ignorieren.\n\n"
        f"Mit freundlichen Grüßen\n"
        f"Ihr Irmgärtchen-Team"
    )
    _send(subject, user_email, text)
