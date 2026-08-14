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


def _send(subject, to, text):
    if not email_enabled():
        return
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = SMTP_FROM
    msg["To"] = to
    msg.set_content(text, subtype="plain", charset="utf-8")
    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=15) as server:
            server.starttls()
            if SMTP_USER:
                server.login(SMTP_USER, SMTP_PASSWORD)
            server.send_message(msg)
    except Exception as e:
        # Nie den Bestellablauf blockieren, wenn das Mail nicht rausgeht.
        print(f"[mailer] Versand fehlgeschlagen: {e}")


def notify_admin_order(order_no, total_euro, delivery_text):
    if not ADMIN_EMAIL:
        return
    subject = f"Neue Bestellung {order_no}"
    text = (
        f"Es ist eine neue Bestellung eingegangen.\n\n"
        f"Bestellnummer: {order_no}\n"
        f"Betrag: {total_euro} EUR\n"
        f"Lieferung: {delivery_text}\n\n"
        f"Bitte im Admin-Panel bearbeiten."
    )
    _send(subject, ADMIN_EMAIL, text)


def notify_customer_order(user_email, order_no, total_euro):
    if not user_email:
        return
    subject = f"Ihre Bestellung {order_no} bei Irmgärtchen Heilkräuter"
    text = (
        f"Vielen Dank für Ihre Bestellung!\n\n"
        f"Bestellnummer: {order_no}\n"
        f"Betrag: {total_euro} EUR\n\n"
        f"Sie können den Status jederzeit unter Mein Konto einsehen."
    )
    _send(subject, user_email, text)


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
