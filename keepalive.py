#!/usr/bin/env python3
"""Keep-alive: hält den Render-Free-Webservice wach, indem regelmäßig gepinnt wird.

Render-Free-Tier schläft nach 15 Minuten Inaktivität ein. Dieser Skript ruft
alle INTERVAL Minuten die Seite auf, damit sie wach bleibt.

Nutzen:
    python3 keepalive.py                # pinge Standard-URL alle 5 Minuten
    python3 keepalive.py https://...    # eigene URL
    python3 keepalive.py --interval 10  # Intervall in Minuten
    STRIPE_URL=... python3 keepalive.py
"""
import sys
import time
import urllib.request

URL = "https://irmgaertchen-shop.onrender.com/api/health"
INTERVAL_MINUTES = 5


def main():
    global URL, INTERVAL_MINUTES
    args = sys.argv[1:]
    url = URL
    interval = INTERVAL_MINUTES
    i = 0
    while i < len(args):
        if args[i] == "--interval" and i + 1 < len(args):
            interval = int(args[i + 1])
            i += 2
        elif args[i].startswith("http"):
            url = args[i]
            i += 1
        else:
            i += 1
    print(f"[keepalive] Pinge {url} alle {interval} min (Strg+C zum Stoppen)", flush=True)
    while True:
        try:
            with urllib.request.urlopen(url, timeout=30) as r:
                code = r.getcode()
            print(f"[{time.strftime('%H:%M:%S')}] OK {code}", flush=True)
        except Exception as e:
            print(f"[{time.strftime('%H:%M:%S')}] FEHLER: {e}", flush=True)
        time.sleep(interval * 60)


if __name__ == "__main__":
    main()
