import io
from fpdf import FPDF


def _fmt_eur(value):
    return f"{value:.2f}".replace(".", ",")


def generate_invoice_pdf(order):
    """Generate a Rechnung PDF for an order. Returns bytes."""
    pdf = FPDF()
    pdf.set_auto_page_break(auto=True, margin=20)
    pdf.add_page()

    # -- Header
    pdf.set_font("Helvetica", "B", 18)
    pdf.cell(0, 10, "Irmgaertchen Heilkraeuter", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 9)
    pdf.cell(0, 5, "Irmgard Auer", new_x="LMARGIN", new_y="NEXT")
    pdf.cell(0, 5, "Laiming 9, 83112 Frasdorf", new_x="LMARGIN", new_y="NEXT")
    pdf.cell(0, 5, "Tel: 08052 90 94 28", new_x="LMARGIN", new_y="NEXT")
    pdf.cell(0, 5, "info@irmgaertchen.de", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(4)

    # -- Title
    pdf.set_font("Helvetica", "B", 14)
    pdf.cell(0, 10, "RECHNUNG", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(2)

    # -- Invoice meta
    order_no = order.get("order_no", "")
    created = order.get("created_at", "")[:10]
    pdf.set_font("Helvetica", "", 10)
    pdf.cell(95, 6, f"Rechnungsnr.: {order_no}")
    pdf.cell(0, 6, f"Datum: {created}", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(6)

    # -- Customer
    customer_name = order.get("customerName", "")
    delivery = order.get("delivery") or {}
    pdf.set_font("Helvetica", "B", 10)
    pdf.cell(0, 6, "Rechnungsempfaenger:", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 10)
    if customer_name:
        pdf.cell(0, 5, customer_name, new_x="LMARGIN", new_y="NEXT")
    if delivery.get("street"):
        pdf.cell(0, 5, delivery["street"], new_x="LMARGIN", new_y="NEXT")
    city_line = " ".join(filter(None, [delivery.get("zip"), delivery.get("city")]))
    if city_line:
        pdf.cell(0, 5, city_line, new_x="LMARGIN", new_y="NEXT")
    pdf.ln(6)

    # -- Items table header
    pdf.set_font("Helvetica", "B", 10)
    col_w = [12, 80, 25, 30, 30]
    headers = ["Pos", "Beschreibung", "Menge", "Einzelpreis", "Gesamt"]
    for i, h in enumerate(headers):
        pdf.cell(col_w[i], 7, h, border=1, align="C")
    pdf.ln()

    # -- Items
    pdf.set_font("Helvetica", "", 10)
    for idx, item in enumerate(order.get("items", []), 1):
        name = item.get("name", "")
        qty = item.get("qty", 0)
        price = item.get("price", 0)
        total = item.get("total", 0)
        pdf.cell(col_w[0], 7, str(idx), border=1, align="C")
        pdf.cell(col_w[1], 7, name[:40], border=1)
        pdf.cell(col_w[2], 7, str(qty), border=1, align="C")
        pdf.cell(col_w[3], 7, f"{_fmt_eur(price)} EUR", border=1, align="R")
        pdf.cell(col_w[4], 7, f"{_fmt_eur(total)} EUR", border=1, align="R")
        pdf.ln()

    # -- Totals
    pdf.ln(4)
    pdf.set_font("Helvetica", "", 10)
    right = 177
    label_w = 50
    val_w = 40

    pdf.cell(label_w, 6, "Zwischensumme:", align="R")
    pdf.cell(val_w, 6, f"{_fmt_eur(order.get('subtotal', 0))} EUR", align="R", new_x="LMARGIN", new_y="NEXT")

    if order.get("discount") and order["discount"] > 0:
        code = order.get("couponCode", "")
        label = f"Gutschein ({code})" if code else "Gutschein"
        pdf.cell(label_w, 6, f"{label}:", align="R")
        pdf.cell(val_w, 6, f"-{_fmt_eur(order['discount'])} EUR", align="R", new_x="LMARGIN", new_y="NEXT")

    if order.get("shipping") and order["shipping"] > 0:
        pdf.cell(label_w, 6, "Versand:", align="R")
        pdf.cell(val_w, 6, f"{_fmt_eur(order['shipping'])} EUR", align="R", new_x="LMARGIN", new_y="NEXT")
    else:
        pdf.cell(label_w, 6, "Versand:", align="R")
        pdf.cell(val_w, 6, "kostenlos", align="R", new_x="LMARGIN", new_y="NEXT")

    pdf.set_font("Helvetica", "B", 11)
    pdf.cell(label_w, 8, "Gesamtbetrag:", align="R")
    pdf.cell(val_w, 8, f"{_fmt_eur(order.get('total', 0))} EUR", align="R", new_x="LMARGIN", new_y="NEXT")

    # -- Footer
    pdf.ln(10)
    pdf.set_font("Helvetica", "", 9)
    pdf.multi_cell(0, 5, "Zahlungsart: Online-Bezahlung per Stripe\nVielen Dank fuer Ihren Einkauf!")

    buf = io.BytesIO()
    pdf_bytes = pdf.output()
    buf.write(bytes(pdf_bytes))
    buf.seek(0)
    return buf


def generate_address_label_pdf(order):
    """Generate a shipping address label (sender + recipient) as PDF. Returns BytesIO."""
    pdf = FPDF(orientation="P", unit="mm", format="A4")
    pdf.add_page()

    sender = (
        "Irmgard Auer",
        "Irmgaertchen Heilkraeuter",
        "Laiming 9",
        "83112 Frasdorf",
    )
    customer_name = order.get("customerName", "")
    delivery = order.get("delivery") or {}
    recipient = [
        customer_name,
        delivery.get("street", ""),
        " ".join(filter(None, [delivery.get("zip"), delivery.get("city")])),
    ]
    recipient = [x for x in recipient if x]

    label_x, label_y = 15, 15
    label_w, label_h = 95, 65
    pdf.set_xy(label_x, label_y)
    pdf.set_font("Helvetica", "B", 9)
    pdf.cell(label_w, 5, "Absender", new_x="LMARGIN", new_y="NEXT")
    pdf.set_x(label_x)
    pdf.set_font("Helvetica", "", 9)
    for line in sender:
        pdf.set_x(label_x)
        pdf.cell(label_w, 4.5, line, new_x="LMARGIN", new_y="NEXT")

    pdf.set_xy(label_x, label_y + label_h)
    pdf.set_font("Helvetica", "B", 11)
    pdf.cell(label_w, 6, "Empfaenger", new_x="LMARGIN", new_y="NEXT")
    pdf.set_x(label_x)
    pdf.set_font("Helvetica", "", 11)
    for line in recipient:
        pdf.set_x(label_x)
        pdf.cell(label_w, 5.5, line, new_x="LMARGIN", new_y="NEXT")

    pdf.set_xy(label_x, label_y + label_h + 25)
    pdf.set_font("Helvetica", "", 8)
    pdf.cell(label_w, 4, f"Bestellung: {order.get('order_no', '')}", new_x="LMARGIN", new_y="NEXT")
    pdf.set_x(label_x)
    pdf.cell(label_w, 4, f"Datum: {order.get('created_at', '')[:10]}", new_x="LMARGIN", new_y="NEXT")

    pdf.rect(label_x, label_y, label_w, label_h + 40)

    pdf.set_xy(label_x + 100, label_y)
    pdf.set_font("Helvetica", "B", 9)
    pdf.cell(95, 5, "Lieferadresse (Aufkleber)", new_x="LMARGIN", new_y="NEXT")
    pdf.set_x(label_x + 100)
    pdf.set_font("Helvetica", "", 11)
    for line in recipient:
        pdf.set_x(label_x + 100)
        pdf.cell(95, 5.5, line, new_x="LMARGIN", new_y="NEXT")

    pdf.rect(label_x + 100, label_y, 95, 25)

    buf = io.BytesIO()
    buf.write(bytes(pdf.output()))
    buf.seek(0)
    return buf


def generate_packing_slip_pdf(order):
    """Generate a Lieferschein (packing slip) PDF. Returns BytesIO."""
    pdf = FPDF()
    pdf.set_auto_page_break(auto=True, margin=20)
    pdf.add_page()

    pdf.set_font("Helvetica", "B", 18)
    pdf.cell(0, 10, "Irmgaertchen Heilkraeuter", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 9)
    pdf.cell(0, 5, "Irmgard Auer", new_x="LMARGIN", new_y="NEXT")
    pdf.cell(0, 5, "Laiming 9, 83112 Frasdorf", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(4)

    pdf.set_font("Helvetica", "B", 14)
    pdf.cell(0, 10, "LIEFERSCHEIN", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(2)

    order_no = order.get("order_no", "")
    created = order.get("created_at", "")[:10]
    pdf.set_font("Helvetica", "", 10)
    pdf.cell(95, 6, f"Bestellnr.: {order_no}")
    pdf.cell(0, 6, f"Datum: {created}", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(4)

    customer_name = order.get("customerName", "")
    delivery = order.get("delivery") or {}
    pdf.set_font("Helvetica", "B", 10)
    pdf.cell(0, 6, "Empfaenger:", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 10)
    if customer_name:
        pdf.cell(0, 5, customer_name, new_x="LMARGIN", new_y="NEXT")
    if delivery.get("street"):
        pdf.cell(0, 5, delivery["street"], new_x="LMARGIN", new_y="NEXT")
    city_line = " ".join(filter(None, [delivery.get("zip"), delivery.get("city")]))
    if city_line:
        pdf.cell(0, 5, city_line, new_x="LMARGIN", new_y="NEXT")
    pdf.ln(4)

    pdf.set_font("Helvetica", "B", 10)
    col_w = [12, 100, 25, 30]
    headers = ["Pos", "Artikel", "Menge", "Preis"]
    for i, h in enumerate(headers):
        pdf.cell(col_w[i], 7, h, border=1, align="C")
    pdf.ln()

    pdf.set_font("Helvetica", "", 10)
    for idx, item in enumerate(order.get("items", []), 1):
        name = item.get("name", "")
        qty = item.get("qty", 0)
        price = item.get("price", 0)
        pdf.cell(col_w[0], 7, str(idx), border=1, align="C")
        pdf.cell(col_w[1], 7, name[:50], border=1)
        pdf.cell(col_w[2], 7, str(qty), border=1, align="C")
        pdf.cell(col_w[3], 7, f"{_fmt_eur(price)} EUR", border=1, align="R")
        pdf.ln()

    pdf.ln(6)
    pdf.set_font("Helvetica", "", 9)
    pdf.multi_cell(0, 5, "Dies ist kein Ersatz fuer die Rechnung.\nVielen Dank fuer Ihre Bestellung!")

    buf = io.BytesIO()
    buf.write(bytes(pdf.output()))
    buf.seek(0)
    return buf
