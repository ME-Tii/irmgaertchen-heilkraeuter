import os
import smtplib
from email.message import EmailMessage
from xml.sax.saxutils import escape as esc

SMTP_HOST = os.environ.get("SMTP_HOST", "")
SMTP_PORT = int(os.environ.get("SMTP_PORT", "587"))
SMTP_USER = os.environ.get("SMTP_USER", "")
SMTP_PASSWORD = os.environ.get("SMTP_PASSWORD", "")
SMTP_FROM = os.environ.get("SMTP_FROM", SMTP_USER or "shop@irmgaertchen.de")
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "")


def email_enabled():
    return bool(SMTP_HOST and SMTP_USER)


FALLBACK_PORTS = [2525, 465]


def _get_template(key):
    try:
        import db
        tpl = db.get_email_template(key)
        if tpl:
            return tpl
    except Exception:
        pass
    return None


def _send(subject, to, text, attachment=None):
    if not email_enabled():
        _log(to, subject, False, "SMTP nicht konfiguriert")
        return False
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = SMTP_FROM
    msg["To"] = to
    msg.set_content(text, subtype="plain", charset="utf-8")
    if attachment:
        msg.add_attachment(
            attachment["data"],
            maintype="application",
            subtype="pdf",
            filename=attachment["filename"],
        )
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
            errors.append(f"({SMTP_HOST}:{port}) {e}")
    print(f"[mailer] Versand fehlgeschlagen: {' | '.join(errors)}")
    _log(to, subject, False, " | ".join(errors))
    return False


def _send_html(subject, to, html, fallback_text=""):
    if not email_enabled():
        _log(to, subject, False, "SMTP nicht konfiguriert")
        return False
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = SMTP_FROM
    msg["To"] = to
    msg.set_content(fallback_text, subtype="plain", charset="utf-8")
    msg.add_alternative(html, subtype="html", charset="utf-8")
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
            errors.append(f"({SMTP_HOST}:{port}) {e}")
    print(f"[mailer] Versand fehlgeschlagen: {' | '.join(errors)}")
    _log(to, subject, False, " | ".join(errors))
    return False
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = SMTP_FROM
    msg["To"] = to
    msg.set_content(text, subtype="plain", charset="utf-8")
    if attachment:
        msg.add_attachment(
            attachment["data"],
            maintype="application",
            subtype="pdf",
            filename=attachment["filename"],
        )
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
    tpl = _get_template("order_admin")
    if tpl and not tpl["enabled"]:
        return
    if tpl:
        coupon_text = ""
        if customer.get("couponCode"):
            discount_euro = _fmt_euro(customer.get("discount", 0))
            coupon_text = f"Gutschein: {customer['couponCode']} (-{discount_euro} EUR)\n"
        subject = tpl["subject"].format(order_no=order_no)
        text = tpl["body"].format(
            order_no=order_no,
            total=total_euro,
            delivery_text=delivery_text,
            coupon=coupon_text,
            name=customer.get("name", ""),
            phone=customer.get("phone", ""),
            email=customer.get("email", ""),
        )
    else:
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
        text = "".join(lines)
    _send(subject, ADMIN_EMAIL, text)


def _fmt_euro(value):
    return f"{value:.2f}".replace(".", ",")


def notify_customer_order(order, user_email=None, attachment=None):
    user_email = user_email or (order.get("customerEmail") or "")
    if not user_email:
        return
    order_no = order.get("order_no", "")
    tpl = _get_template("order_customer")
    if tpl and not tpl["enabled"]:
        return
    if tpl:
        items_lines = []
        for it in order.get("items", []):
            items_lines.append(
                f"  {it.get('qty', 0)}x {it.get('name', '')} – "
                f"{_fmt_euro(it.get('price', 0))} EUR "
                f"(= {_fmt_euro(it.get('total', 0))} EUR)\n"
            )
        items_text = "".join(items_lines)
        discount_text = ""
        if order.get("discount") and order["discount"] > 0:
            code = order.get("couponCode", "")
            label = f"Gutscheincode {code}" if code else "Gutschein"
            discount_text = f"{label}: -{_fmt_euro(order['discount'])} EUR\n"
        shipping_text = f"Post: {_fmt_euro(order['shipping'])} EUR" if order.get("shipping") else "kostenlos"
        delivery = order.get("delivery") or {}
        if delivery.get("method") == "delivery":
            delivery_text = (
                f"Lieferadresse:\n{delivery.get('street', '')}\n"
                f"{delivery.get('zip', '')} {delivery.get('city', '')}\n\n"
            )
        else:
            delivery_text = "Abholung: Wir rufen Sie an, sobald Ihre Bestellung zur Abholung bereit ist.\n\n"
        subject = tpl["subject"].format(order_no=order_no)
        text = tpl["body"].format(
            order_no=order_no,
            items=items_text,
            subtotal=_fmt_euro(order.get("subtotal", 0)),
            discount=discount_text,
            shipping=shipping_text,
            total=_fmt_euro(order.get("total", 0)),
            delivery=delivery_text,
        )
    else:
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
        lines.append('Sie koennen den Status jederzeit unter "Mein Konto" einsehen.')
        text = "".join(lines)
    _send(subject, user_email, text, attachment=attachment)


def notify_customer_status(user_email, order_no, status):
    if not user_email:
        return
    tpl = _get_template("status_change")
    if tpl and not tpl["enabled"]:
        return
    if tpl:
        subject = tpl["subject"].format(order_no=order_no, status=status)
        text = tpl["body"].format(order_no=order_no, status=status)
    else:
        subject = f"Bestellung {order_no}: {status}"
        text = f"Der Status Ihrer Bestellung {order_no} hat sich geändert: {status}"
    _send(subject, user_email, text)


def notify_admin_contact(name, email, message):
    if not ADMIN_EMAIL:
        return
    tpl = _get_template("contact_admin")
    if tpl and not tpl["enabled"]:
        return
    if tpl:
        subject = tpl["subject"].format(name=name)
        text = tpl["body"].format(name=name, email=email, message=message)
    else:
        subject = f"Neue Kontaktanfrage von {name}"
        text = (
            f"Eine neue Nachricht über das Kontaktformular ist eingegangen.\n\n"
            f"Name: {name}\n"
            f"E-Mail: {email}\n\n"
            f"Nachricht:\n{message}\n\n"
            f"Im Admin-Panel unter \u201eNachrichten\u201c einsehbar."
        )
    _send(subject, ADMIN_EMAIL, text)


def send_password_reset(user_email, name, reset_url):
    if not user_email:
        return
    tpl = _get_template("password_reset")
    if tpl and not tpl["enabled"]:
        return
    if tpl:
        subject = tpl["subject"]
        text = tpl["body"].format(name=name, reset_url=reset_url)
    else:
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


def _build_harvest_html(harvests):
    if not harvests:
        return (
            '<table width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;">'
            '<tr><td style="background:#f0f7f0;padding:16px 20px;border-radius:8px;text-align:center;">'
            '<p style="margin:0;color:#3f6b3b;font-size:15px;">'
            '<strong>Keine Ernte in den nächsten 2 Wochen geplant.</strong></p>'
            '<p style="margin:6px 0 0;color:#666;font-size:13px;">Schau bald wieder vorbei!</p>'
            '</td></tr></table>'
        )
    rows = ""
    for h in harvests:
        variety = f" ({esc(h['plant_variety'])})" if h.get("plant_variety") else ""
        date = h.get("expected_harvest", "")
        try:
            from datetime import datetime
            date_fmt = datetime.strptime(date, "%Y-%m-%d").strftime("%d.%m.%Y")
        except Exception:
            date_fmt = date
        rows += (
            '<tr>'
            '<td style="padding:10px 16px;border-bottom:1px solid #e8efe8;">'
            '<strong style="color:#3f6b3b;">' + esc(h.get("plant_name", "")) + variety + '</strong>'
            '</td>'
            '<td style="padding:10px 16px;border-bottom:1px solid #e8efe8;color:#666;font-size:13px;">'
            + esc(h.get("name", "")) +
            '</td>'
            '<td style="padding:10px 16px;border-bottom:1px solid #e8efe8;text-align:right;font-weight:600;color:#3f6b3b;">'
            + esc(date_fmt) +
            '</td>'
            '</tr>'
        )
    return (
        '<h3 style="margin:20px 0 8px;color:#3f6b3b;font-size:17px;">'
        '\U0001f33f Bald erntereif</h3>'
        '<table width="100%" cellpadding="0" cellspacing="0" '
        'style="border:1px solid #e8efe8;border-radius:8px;overflow:hidden;margin-bottom:16px;">'
        '<thead><tr style="background:#f0f7f0;">'
        '<th style="padding:10px 16px;text-align:left;font-size:13px;color:#3f6b3b;">Pflanze</th>'
        '<th style="padding:10px 16px;text-align:left;font-size:13px;color:#3f6b3b;">Beet / Abschnitt</th>'
        '<th style="padding:10px 16px;text-align:right;font-size:13px;color:#3f6b3b;">Ernte am</th>'
        '</tr></thead><tbody>'
        + rows +
        '</tbody></table>'
    )


def build_newsletter_html(name, harvests, site_url="https://irmgaertchen.de", email=""):
    harvest_html = _build_harvest_html(harvests)
    unsubscribe_link = ""
    if email:
        import hmac as _hmac, hashlib as _hashlib
        secret = os.environ.get("SECRET_KEY", os.environ.get("IRM_ADMIN_PASSWORD", "irmgaertchen-secret-change-me"))
        token = _hmac.new(secret.encode(), email.encode(), _hashlib.sha256).hexdigest()[:32]
        from urllib.parse import quote as _quote
        unsubscribe_link = (
            '<p style="margin:8px 0 0;font-size:11px;color:#aaa;">'
            '<a href="' + site_url + '/api/newsletter/unsubscribe?token=' + token + '&email=' + _quote(email) + '" '
            'style="color:#aaa;">Vom Newsletter abmelden</a></p>'
        )
    return (
        '<!DOCTYPE html><html><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1.0"></head>'
        '<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,Helvetica,sans-serif;">'
        '<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:20px 0;">'
        '<tr><td align="center">'
        '<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">'
        '<!-- header -->'
        '<tr><td style="background:#3f6b3b;padding:24px 32px;border-radius:8px 8px 0 0;text-align:center;">'
        '<img src="https://irmgaertchen.de/assets/img/logo-irmgaertchen_weiss.png" '
        'alt="Irmg&auml;rtchen" width="120" style="display:block;margin:0 auto 12px;max-width:120px;height:auto;">'
        '<h1 style="margin:0;color:#fff;font-size:22px;">Irmg&auml;rtchen Heilkr&auml;uter</h1>'
        '<p style="margin:6px 0 0;color:#c8e6c9;font-size:13px;">Newsletter &middot; Ernte-News &amp; Tipps</p>'
        '</td></tr>'
        '<!-- body -->'
        '<tr><td style="background:#ffffff;padding:28px 32px;">'
        '<p style="margin:0 0 12px;font-size:15px;color:#333;">Hallo ' + esc(name) + ',</p>'
        '<p style="margin:0 0 20px;font-size:15px;color:#333;">'
        'willkommen bei unserem Newsletter! Hier erf&auml;hrst du, was gerade im Garten passiert.</p>'
        + harvest_html +
        '<!-- shop link -->'
        '<table width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0;">'
        '<tr><td align="center">'
        '<a href="' + site_url + '" '
        'style="display:inline-block;background:#3f6b3b;color:#fff;text-decoration:none;'
        'padding:12px 28px;border-radius:6px;font-size:14px;font-weight:600;">'
        '\U0001f6d2 Zum Shop</a>'
        '</td></tr></table>'
        '<p style="margin:0;font-size:14px;color:#3f6b3b;">Viele Gr&uuml;&szlig;e,<br>Dein Irmg&auml;rtchen-Team</p>'
        '</td></tr>'
        '<!-- footer -->'
        '<tr><td style="background:#f0f7f0;padding:16px 32px;border-radius:0 0 8px 8px;text-align:center;">'
        '<p style="margin:0;font-size:11px;color:#888;">'
        '&copy; 2026 Irmg&auml;rtchen Heilkr&auml;uter &middot; '
        '<a href="' + site_url + '" style="color:#3f6b3b;">irmgaertchen.de</a></p>'
        + unsubscribe_link +
        '</td></tr>'
        '</table></td></tr></table>'
        '</body></html>'
    )


def send_newsletter(subscriber, subject, html, plain_text):
    return _send_html(subject, subscriber["email"], html, plain_text)


def build_newsletter_for_subscriber(subscriber, harvests, site_url="https://irmgaertchen.de", subject=""):
    name = subscriber.get("name") or subscriber.get("email", "").split("@")[0]
    html = build_newsletter_html(name, harvests, site_url, email=subscriber.get("email", ""))
    plain = (
        f"Hallo {name},\n\n"
        "Willkommen bei unserem Newsletter!\n\n"
    )
    if harvests:
        plain += "Bald erntereif:\n"
        for h in harvests:
            variety = f" ({h['plant_variety']})" if h.get("plant_variety") else ""
            plain += f"  - {h['plant_name']}{variety} – {h.get('expected_harvest', '')}\n"
    else:
        plain += "Keine Ernte in den nächsten 2 Wochen geplant.\n"
    plain += f"\nViele Grüße\nDein Irmgärtchen-Team\n\n{site_url}"
    return subject or "Irmgärtchen Newsletter – Ernte-News & Tipps", html, plain
