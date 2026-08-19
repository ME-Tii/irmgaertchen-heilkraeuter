import os
import json
import base64
import urllib.request
import urllib.error

DHL_API_KEY = os.environ.get("DHL_API_KEY", "")
DHL_SANDBOX = os.environ.get("DHL_SANDBOX", "1") == "1"

_BASE_SANDBOX = "https://cig.dhl.de/services/production/sandbox"
_BASE_PROD = "https://cig.dhl.de/services/production"
BASE = _BASE_SANDBOX if DHL_SANDBOX else _BASE_PROD


def enabled():
    return bool(DHL_API_KEY)


def _request(method, path, body=None):
    url = BASE + path
    headers = {
        "dhl-api-key": DHL_API_KEY,
        "Accept": "application/json",
    }
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read()
            content_type = resp.headers.get("Content-Type", "")
            if "application/json" in content_type:
                return json.loads(raw) if raw else {}
            elif "application/pdf" in content_type or "application/octet-stream" in content_type:
                return {"_binary": raw}
            elif raw:
                try:
                    return json.loads(raw)
                except Exception:
                    return {"_binary": raw}
            return {}
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="replace")
        print(f"[dhl] HTTP {e.code} {method} {path}: {err_body}")
        raise RuntimeError(f"DHL API error {e.code}: {err_body}")
    except Exception as ex:
        print(f"[dhl] Request failed {method} {path}: {ex}")
        raise


def create_shopping_cart(order, config, product="V01PAK", notify_token="", site_url=""):
    street = config.get("sender_street", "")
    number = config.get("sender_number", "")
    delivery_street = order.get("delivery_street", "")
    parts = delivery_street.strip().split(" ", 1)
    recv_street = parts[0] if parts else ""
    recv_number = parts[1] if len(parts) > 1 else ""

    items = json.loads(order.get("items_json", "[]")) if isinstance(order.get("items_json"), str) else order.get("items_json", [])
    weight_grams = max(100, len(items) * 500)

    notify_url = ""
    if site_url and notify_token:
        notify_url = f"{site_url}/api/admin/dhl-notify/{notify_token}"

    cart = {
        "profile": "STANDARD_GRUPPENPROFIL",
        "shippingDateRange": {"from": "2026-01-01", "to": "2026-12-31"},
        "receiver": {
            "address": {
                "name1": order.get("customer_name", ""),
                "name2": "",
                "street": recv_street,
                "streetNumber": recv_number,
                "plz": order.get("delivery_zip", ""),
                "city": order.get("delivery_city", ""),
                "country": "DEU",
                "email": order.get("customer_email", ""),
            }
        },
        "shipper": {
            "address": {
                "name1": config.get("sender_name", ""),
                "name2": "",
                "street": street,
                "streetNumber": number,
                "plz": config.get("sender_plz", ""),
                "city": config.get("sender_city", ""),
                "country": "DEU",
                "email": config.get("sender_email", ""),
            }
        },
        "details": {
            "product": product,
            "billingNumber": "",
            "refNo": order.get("order_no", ""),
            "profiles": {"DHL_shippingInformationType_GKV": {"sendProducts360": True}},
            "declareValue": {"currency": "EUR", "withCustomsDeclarations": False},
            "weight": {"uom": "g", "value": weight_grams},
        },
    }

    if notify_url:
        cart["notificationUrl"] = notify_url

    result = _request("POST", "/shoppingcarts", cart)
    shopping_cart_id = result.get("shoppingCartId", "")
    entry_url = ""
    download = result.get("download", {})
    if isinstance(download, dict):
        entry_url = download.get("entryUrl", "")
    elif isinstance(download, str):
        entry_url = download

    return {
        "shopping_cart_id": shopping_cart_id,
        "entry_url": entry_url,
        "raw": result,
    }


def _extract_label(label_result):
    if "_binary" in label_result:
        return label_result["_binary"]
    label_data = label_result.get("label", {})
    if isinstance(label_data, str):
        return base64.b64decode(label_data)
    elif isinstance(label_data, dict):
        for key in ("content", "labelContent", "b64Content"):
            content = label_data.get(key, "")
            if content:
                return base64.b64decode(content)
    return None


def get_label(shopping_cart_id):
    result = _request("GET", f"/shoppingcarts/{shopping_cart_id}")
    items = result.get("items", [])
    tracking = ""
    for item in items:
        t = item.get("trackingNumber", "") or item.get("parcelno", "")
        if t:
            tracking = t
            break

    for item in items:
        pakid = item.get("pakid", "") or item.get("PAKID", "")
        if pakid:
            try:
                label_result = _request("GET", f"/labels/{pakid}")
                pdf = _extract_label(label_result)
                if pdf:
                    return {"pdf": pdf, "tracking": tracking}
            except Exception as e:
                print(f"[dhl] Label download failed for PAKID {pakid}: {e}")

    return {"tracking": tracking}


def get_cart_status(shopping_cart_id):
    result = _request("GET", f"/shoppingcarts/{shopping_cart_id}")
    return result
