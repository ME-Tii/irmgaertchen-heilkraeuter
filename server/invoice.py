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
