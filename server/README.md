# Irmgärtchen-Shop – Backend

Produktionsfertiges Flask-Backend für den Heilkräuter-Shop: Konten, Bestellungen,
Stripe-Zahlungen (Checkout + Webhook), Erstattungen und Admin-Verwaltung.
Der Stripe-Key lebt **ausschließlich** auf dem Server und wird **nie** ins Frontend geschrieben.

## Architektur

- Flask liefert Shop und API aus einer Adresse (kein CORS nötig): `http://localhost:5000`
- Datenbank: lokal **SQLite** (`server/shop.db`), auf Render/Produktion **PostgreSQL**
  über die Umgebungsvariable `DATABASE_URL` (Nutzer, Sessions, Produkte, Bestellungen)
- Authentifizierung über Server-Sessions (Bearer-Token); Passwörter per `werkzeug.security` gehasht
- Preise/Versand werden **nur serverseitig** berechnet (`products.py`) – der Browser kann nichts manipulieren
- Stripe: `checkout.session.completed`-Webhook verbucht Zahlung, setzt Status „Eingegangen"
  und zieht den Lagerbestand ab (signed via `STRIPE_WEBHOOK_SECRET`)
- E-Mails (Admin-Benachrichtigung, Bestell-/Statusbestätigung) über `mailer.py`
  (SMTP aus der `.env`); ohne SMTP-Konfiguration werden Mails übersprungen, nie blockiert

## Dateien

| Datei | Zweck |
|---|---|
| `server.py` | Flask-App mit allen API-Routen |
| `db.py` | SQLite **und** PostgreSQL (per `DATABASE_URL`) |
| `products.py` | Katalog (Quelle der Wahrheit) + Versandkosten |
| `mailer.py` | SMTP-Versand mit Fallback |
| `.env.example` | Vorlage für alle Einstellungen |
| `deploy/` | systemd-Unit + nginx-Konfiguration |
| `render.yaml` | Render-Blueprint (Webservice + Postgres) |

## Installation (lokal)

```bash
cd server
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env      # Werte eintragen!
python3 server.py         # Shop + API auf http://localhost:5000
```

### `.env` – alle Einstellungen

```dotenv
STRIPE_SECRET_KEY=sk_test_...      # oder sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...    # aus dem Stripe-Dashboard
DOMAIN=http://localhost:5000       # für die Weiterleitung nach der Zahlung
PORT=5000
DATABASE_URL=                       # optional: PostgreSQL (Render); leer = SQLite
IRM_ADMIN_USERNAME=admin           # Admin wird beim Start angelegt
IRM_ADMIN_PASSWORD=einSicheresPasswort
ADMIN_EMAIL=info@irmgaertchen.de   # Empfänger der Bestell-Mails
SMTP_HOST=                         # optional; ohne SMTP werden Mails übersprungen
SMTP_PORT=587
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=
```

`.env` **nie** committen (steht in `.gitignore`). `shop.db` ist ebenfalls ignoriert.

## Stripe-Webhook einrichten

1. Stripe-Dashboard → Developers → Webhooks → Endpoint hinzufügen:
   `https://DEINE-DOMAIN/api/stripe/webhook`
2. Ereignisse abonnieren: `checkout.session.completed` und `charge.refunded`
3. „Signing secret" (`whsec_...`) in die `.env` als `STRIPE_WEBHOOK_SECRET` eintragen.
   Ohne das Secret werden Signaturen im lokalen Test nicht geprüft (dev only).

Testkarten: `4242 4242 4242 4242` (erfolgreich), `4000 0000 0000 0002` (abgelehnt).

## API-Überblick

| Methode | Route | Zweck |
|---|---|---|
| POST | `/api/register` | Konto anlegen, liefert Token |
| POST | `/api/login` | Anmelden (auch Admin), liefert Token + `role` |
| POST | `/api/logout` | Token ungültig machen |
| GET/PUT | `/api/me` | Eigenes Profil lesen/ändern |
| GET | `/api/products` | Produktliste (öffentlich) |
| POST | `/api/create-checkout-session` | Stripe-Session erzeugen (Login nötig) |
| POST | `/api/stripe/webhook` | Zahlungsbestätigung / Erstattung |
| GET | `/api/orders` | Eigene Bestellungen |
| GET | `/api/orders/session/<id>` | Bestellung zur Stripe-Session |
| POST | `/api/orders/confirm` | „Als erhalten/abgeholt bestätigen" |
| POST | `/api/orders/return` | Rückgabe anfordern |
| GET | `/api/admin/orders` | Alle Bestellungen (Admin) |
| PATCH | `/api/admin/orders/<no>` | Status ändern |
| POST | `/api/admin/orders/<no>/return-done` | Rückgabe erledigt |
| POST | `/api/admin/orders/<no>/refund` | Stripe-Erstattung |
| DELETE | `/api/admin/orders/<no>` | Bestellung löschen (stellt Bestand wieder her) |
| GET/POST | `/api/admin/products` | Produkte auflisten/anlegen (Admin) |
| PATCH/DELETE | `/api/admin/products/<id>` | Bestand/Preis ändern, Artikel löschen |

Beispiel (Kunde):

```bash
TOKEN=$(curl -s -X POST http://localhost:5000/api/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"max","password":"geheim123"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')

curl -s -X POST http://localhost:5000/api/create-checkout-session \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"cart":[{"id":"salbei","qty":2}],"delivery":true,"shipping_address":{"street":"Laiming 1","zip":"83112","city":"Frasdorf"}}'
```

## Produktion (gunicorn + systemd + nginx)

```bash
# 1) Virtuelle Umgebung auf dem Server anlegen (siehe oben)

# 2) systemd + nginx
sudo cp deploy/irmgaertchen.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now irmgaertchen

sudo cp deploy/irmgaertchen.nginx.conf /etc/nginx/sites-available/irmgaertchen
sudo ln -s /etc/nginx/sites-available/irmgaertchen /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# 3) Domain & HTTPS
sudo certbot --nginx -d DEINE-DOMAIN
# 4) DOMAIN in der .env auf die HTTPS-URL setzen und Dienst neu starten
```

## Hosting auf Render

Render nutzt für Web-Services ein **flüchtiges Dateisystem** – daher läuft der Shop dort mit
**PostgreSQL** (statt SQLite), dessen Verbindung über `DATABASE_URL` automatisch erkannt wird.
SQLite bleibt für die lokale Entwicklung aktiv (kein `DATABASE_URL` gesetzt).

1. **GitHub-Repo** anlegen, Code pushen (siehe unten „Git & Secrets“).
2. In Render: **New + → Blueprint → Repo auswählen**. `render.yaml` legt automatisch
   den Webservice (`irmgaertchen-shop`) und die Postgres-Datenbank (`irmgaertchen-db`) an.
3. Die im Blueprint als `sync: false` markierten Variablen **einmalig im Dashboard** setzen
   (Entwickler → Umgebungsvariablen des Webservice):
   `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `IRM_ADMIN_PASSWORD`, `ADMIN_EMAIL`, `SMTP_*`.
4. `DOMAIN` im Blueprint auf die echte URL ändern (z. B. eigener Domainname, sonst
   `https://irmgaertchen-shop.onrender.com`).
5. **Stripe-Webhook** anlegen (Dashboard → Entwickler → Webhooks):
   URL `https://DEINE-DOMAIN/api/stripe/webhook`, Ereignisse `checkout.session.completed`
   und `charge.refunded`. Das Signing-Secret als `STRIPE_WEBHOOK_SECRET` eintragen.
6. Testkarte `4242 4242 4242 4242` für eine Bestellung, dann Admin-Erstattung testen.

> ⚠️ **Kosten/Free-Tier:** Der kostenlose Postgres von Render **läuft nach ~30 Tagen ab**.
> Für einen dauerhaften Betrieb einen bezahlten Postgres (ab ~15 $/Monat) oder eine eigene
> DB (z. B. Neon/Supabase kostenlos) als `DATABASE_URL` verwenden. Free-Webservices
> schlafen nach 15 Minuten Inaktivität ein (erste Anfrage dauert dann etwas länger).

### Git & Secrets

```bash
cd irmgaertchen-shop
git init && git add -A && git commit -m "Shop produktionsreif"
git remote add origin git@github.com:DEINUSER/irmgaertchen-shop.git
git push -u origin main
```

`.env` und `shop.db` sind über `.gitignore` ausgeschlossen und landen **nie** im Repo –
alle Geheimnisse werden in Render über die Umgebungsvariablen gesetzt.

## Wichtig

- `STRIPE_SECRET_KEY`, `.env` und `shop.db` gehören in `.gitignore` und nie ins Repo.
- Preise, Versand (5,90 €, ab 40 € kostenlos, nur DE) und Lagerbestand werden ausschließlich
  serverseitig geprüft (`products.py`, `server.py`).
- Bestandsreduktion erfolgt erst bei Zahlungsbestätigung (Webhook), nicht beim Aufruf des Checkouts.
- Rückgabekosten trägt der Kunde, außer bei unserem Fehler (Hinweis im Shop).
- Bei Admin-Erstattung wird `stripe.Refund.create()` über die gespeicherte Session-ID ausgeführt;
  die Webhook-Erstattung (`charge.refunded`) hält den Status automatisch aktuell.
