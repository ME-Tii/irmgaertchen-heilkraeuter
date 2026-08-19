import os
import json
import base64
import gzip
import time
import urllib.request
import urllib.error

FEDEX_CLIENT_ID = os.environ.get("FEDEX_CLIENT_ID", "")
FEDEX_CLIENT_SECRET = os.environ.get("FEDEX_CLIENT_SECRET", "")
FEDEX_ACCOUNT_NUMBER = os.environ.get("FEDEX_ACCOUNT_NUMBER", "")
FEDEX_SANDBOX = os.environ.get("FEDEX_SANDBOX", "1") == "1"

_BASE_SANDBOX = "https://apis-sandbox.fedex.com"
_BASE_PROD = "https://apis.fedex.com"
BASE = _BASE_SANDBOX if FEDEX_SANDBOX else _BASE_PROD

_token_cache = {"token": "", "expires_at": 0}


def enabled():
    return bool(FEDEX_CLIENT_ID and FEDEX_CLIENT_SECRET)


def _get_token():
    now = time.time()
    if _token_cache["token"] and _token_cache["expires_at"] > now + 60:
        return _token_cache["token"]
    data = json.dumps({
        "grant_type": "client_credentials",
        "client_id": FEDEX_CLIENT_ID,
        "client_secret": FEDEX_CLIENT_SECRET,
    }).encode("utf-8")
    req = urllib.request.Request(
        f"{BASE}/oauth/token",
        data=data,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    body = "grant_type=client_credentials" \
           f"&client_id={FEDEX_CLIENT_ID}" \
           f"&client_secret={FEDEX_CLIENT_SECRET}"
    req.data = body.encode("utf-8")
    with urllib.request.urlopen(req, timeout=30) as resp:
        result = json.loads(resp.read())
    _token_cache["token"] = result["access_token"]
    _token_cache["expires_at"] = now + result.get("expires_in", 3600)
    return _token_cache["token"]


def _request(method, path, body=None):
    token = _get_token()
    url = BASE + path
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Accept-Encoding": "identity",
    }
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            raw = resp.read()
            ce = resp.headers.get("Content-Encoding", "")
            if ce == "gzip":
                raw = gzip.decompress(raw)
            elif ce == "deflate":
                import zlib
                raw = zlib.decompress(raw)
            content_type = resp.headers.get("Content-Type", "")
            if "application/pdf" in content_type or "application/octet-stream" in content_type:
                return {"_binary": raw}
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        err_raw = e.read()
        ce = e.headers.get("Content-Encoding", "") if e.headers else ""
        if ce == "gzip":
            err_raw = gzip.decompress(err_raw)
        elif ce == "deflate":
            import zlib
            err_raw = zlib.decompress(err_raw)
        err_body = err_raw.decode("utf-8", errors="replace")
        print(f"[fedex] HTTP {e.code} {method} {path}: {err_body}")
        raise RuntimeError(f"FedEx API error {e.code}: {err_body}")
    except Exception as ex:
        print(f"[fedex] Request failed {method} {path}: {ex}")
        raise


def create_shipment(order, config, service="FEDEX_EXPRESS_SAVER"):
    items = json.loads(order.get("items_json", "[]")) if isinstance(order.get("items_json"), str) else order.get("items_json", [])
    weight_kg = max(0.5, len(items) * 0.5)

    delivery_street = order.get("delivery_street", "")
    parts = delivery_street.strip().split(" ", 1)
    recv_street = parts[0] if parts else ""
    recv_house = parts[1] if len(parts) > 1 else ""

    sender_street = config.get("sender_street", "")
    sender_number = config.get("sender_number", "")

    body = {
        "accountNumber": {"value": FEDEX_ACCOUNT_NUMBER},
        "labelResponseOptions": "URL_ONLY",
        "requestedShipment": {
            "shipper": {
                "address": {
                    "streetLines": [f"{sender_street} {sender_number}".strip()],
                    "city": config.get("sender_city", ""),
                    "postalCode": config.get("sender_plz", ""),
                    "countryCode": "DE",
                },
                "contact": {
                    "personName": config.get("sender_name", ""),
                    "phoneNumber": config.get("sender_phone", "").replace(" ", "").replace("-", ""),
                    "emailAddress": config.get("sender_email", ""),
                },
            },
            "recipients": [{
                "address": {
                    "streetLines": [f"{recv_street} {recv_house}".strip()],
                    "city": order.get("delivery_city", ""),
                    "postalCode": order.get("delivery_zip", ""),
                    "countryCode": "DE",
                },
                "contact": {
                    "personName": order.get("customer_name", ""),
                    "phoneNumber": order.get("customer_phone", "").replace(" ", "").replace("-", ""),
                    "emailAddress": order.get("customer_email", ""),
                },
            }],
            "serviceType": service,
            "packagingType": "YOUR_PACKAGING",
            "pickupType": "DROPOFF_AT_FEDEX_LOCATION",
            "shippingChargesPayment": {
                "paymentType": "SENDER",
            },
            "labelSpecification": {
                "labelFormatType": "COMMON2D",
                "imageType": "PDF",
            },
            "requestedPackageLineItems": [{
                "weight": {
                    "value": weight_kg,
                    "units": "KG",
                },
                "dimensions": {
                    "length": 30,
                    "width": 20,
                    "height": 10,
                    "units": "CM",
                },
            }],
        },
    }

    result = _request("POST", "/ship/v1/shipments", body)

    tracking = ""
    pdf_bytes = None

    output = result.get("output", {})
    complete_track = output.get("completeTrackResults", [])
    for ct in complete_track:
        for tr in ct.get("trackResults", []):
            tn = tr.get("trackingNumber", "")
            if tn:
                tracking = tn
                break

    label_url = ""
    label_b64 = ""
    for ct in complete_track:
        for tr in ct.get("trackResults", []):
            label_data = tr.get("label", {})
            parts_list = label_data.get("parts", []) if isinstance(label_data, dict) else []
            for part in parts_list:
                u = part.get("url", "")
                d = part.get("document", "") or part.get("contents", "")
                if u:
                    label_url = u
                if d:
                    label_b64 = d

    if label_b64:
        try:
            pdf_bytes = base64.b64decode(label_b64)
        except Exception:
            pass

    if not pdf_bytes and label_url:
        try:
            req = urllib.request.Request(label_url, headers={"Accept": "application/pdf"})
            with urllib.request.urlopen(req, timeout=30) as resp:
                pdf_bytes = resp.read()
        except Exception as e:
            print(f"[fedex] Label-Download von URL fehlgeschlagen: {e}")

    return {
        "tracking": tracking,
        "pdf": pdf_bytes,
        "raw": result,
    }
