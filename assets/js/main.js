const CART_KEY = "irmgaertchen_cart";
const TOKEN_KEY = "irm_api_token";
const USER_KEY = "irm_api_user";
const COOKIE_KEY = "irm_cookie_consent";

function initCookieBanner() {
  if (localStorage.getItem(COOKIE_KEY)) return;
  const banner = document.createElement("div");
  banner.className = "cookie-banner";
  banner.innerHTML =
    '<div class="cookie-banner-inner">' +
    '<p class="cookie-banner-text mb-2">Diese Website verwendet ausschließlich technisch notwendige Cookies (z. B. für Warenkorb und Anmeldung) sowie Stripe zur Zahlungsabwicklung. Es werden keine Tracking-Cookies gesetzt. Weitere Informationen finden Sie in der <a href="datenschutz.html">Datenschutzerklärung</a>.</p>' +
    '<div class="d-flex gap-2 flex-wrap">' +
    '<button type="button" class="btn btn-irm btn-sm" data-cookie-accept>Alle akzeptieren</button>' +
    '<button type="button" class="btn btn-outline-secondary btn-sm" data-cookie-necessary>Nur notwendige</button>' +
    "</div></div>";
  document.body.appendChild(banner);
  banner.querySelector("[data-cookie-accept]").addEventListener("click", () => {
    localStorage.setItem(COOKIE_KEY, "all");
    banner.remove();
  });
  banner.querySelector("[data-cookie-necessary]").addEventListener("click", () => {
    localStorage.setItem(COOKIE_KEY, "necessary");
    banner.remove();
  });
}

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function parseApiResponse(res) {
  return res.text().then((text) => {
    let data = {};
    if (text) {
      try {
        data = JSON.parse(text);
      } catch (e) {
        data = {};
      }
    }
    if (!res.ok) throw new Error(data.error || "Anfrage fehlgeschlagen (HTTP " + res.status + ").");
    return data;
  });
}

function api(path, method, body) {
  const headers = { Accept: "application/json", "Content-Type": "application/json" };
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) headers.Authorization = "Bearer " + token;
  const opts = { method: method || "GET", headers };
  if (body !== undefined) opts.body = JSON.stringify(body);
  if (path && !path.startsWith("/")) path = "/" + path;
  return fetch(path, opts).then(parseApiResponse);
}

function getProduct(id) {
  return window.PRODUCTS.find((p) => p.id === id);
}

function getStock(id) {
  const p = getProduct(id);
  return p && typeof p.stock === "number" ? Math.max(0, p.stock) : Infinity;
}

function stockInfo(id) {
  const p = getProduct(id);
  if (!p || typeof p.stock !== "number") return null;
  const s = Math.max(0, p.stock);
  if (s <= 0) return { out: true, low: false, text: "Ausverkauft" };
  if (s <= 5) return { out: false, low: true, text: "Nur noch " + s + " verfügbar" };
  return { out: false, low: false, text: "Verfügbar" };
}

function getCart() {
  try {
    return JSON.parse(localStorage.getItem(CART_KEY)) || [];
  } catch (e) {
    return [];
  }
}

function saveCart(cart) {
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
}

function addToCart(id) {
  const info = stockInfo(id);
  if (info && info.out) {
    showToast("Dieser Artikel ist leider ausverkauft.");
    return;
  }
  const cart = getCart();
  const item = cart.find((i) => i.id === id);
  if (item) {
    item.qty += 1;
  } else {
    cart.push({ id, qty: 1 });
  }
  saveCart(cart);
  updateCartCount();
  showToast("Zum Warenkorb hinzugefügt");
}

function removeFromCart(id) {
  saveCart(getCart().filter((i) => i.id !== id));
  updateCartCount();
  renderCart();
}

function changeQty(id, delta) {
  const cart = getCart();
  const item = cart.find((i) => i.id === id);
  if (!item) return;
  item.qty += delta;
  if (item.qty <= 0) {
    saveCart(cart.filter((i) => i.id !== id));
  } else {
    saveCart(cart);
  }
  updateCartCount();
  renderCart();
}

function cartTotal() {
  return getCart().reduce((sum, i) => {
    const p = getProduct(i.id);
    return sum + (p ? p.price * i.qty : 0);
  }, 0);
}

const SHIPPING_COST = 5.9;
const FREE_SHIPPING_FROM = 40;
let APPLIED_COUPON = null;

function deliveryMode() {
  const el = document.querySelector('input[name="delivery"]:checked');
  return el ? el.value : "pickup";
}

function shippingFee() {
  if (deliveryMode() !== "delivery") return 0;
  return cartTotal() >= FREE_SHIPPING_FROM ? 0 : SHIPPING_COST;
}

function cartGrandTotal() {
  const discount = APPLIED_COUPON ? APPLIED_COUPON.discount_cents / 100 : 0;
  return Math.max(0, cartTotal() + shippingFee() - discount);
}

function renderSummary() {
  const totalEl = document.getElementById("cartTotal");
  const shippingEl = document.getElementById("cartShipping");
  const grandEl = document.getElementById("cartGrandTotal");
  const discountRow = document.getElementById("cartDiscountRow");
  const discountEl = document.getElementById("cartDiscount");
  const discountLabelEl = document.getElementById("cartDiscountLabel");
  if (totalEl) totalEl.textContent = cartTotal().toFixed(2).replace(".", ",") + " €";
  if (shippingEl) {
    const fee = shippingFee();
    shippingEl.textContent = fee === 0 ? "kostenlos" : fee.toFixed(2).replace(".", ",") + " €";
  }
  if (APPLIED_COUPON && APPLIED_COUPON.discount_cents > 0) {
    if (discountRow) discountRow.classList.remove("d-none");
    if (discountEl) discountEl.textContent = "-" + (APPLIED_COUPON.discount_cents / 100).toFixed(2).replace(".", ",") + " €";
    if (discountLabelEl) discountLabelEl.textContent = "Rabatt (" + APPLIED_COUPON.code + ")";
  } else {
    if (discountRow) discountRow.classList.add("d-none");
  }
  if (grandEl) grandEl.textContent = cartGrandTotal().toFixed(2).replace(".", ",") + " €";
  const costLabel = document.getElementById("shipCostLabel");
  if (costLabel) {
    costLabel.textContent =
      shippingFee() === 0 ? "(kostenlos, ab 40 € Warenwert)" : "(5,90 € – kostenlos ab 40 € Warenwert)";
  }
}

function applyCoupon() {
  const input = document.getElementById("couponInput");
  const feedback = document.getElementById("couponFeedback");
  const code = (input ? input.value.trim() : "").toUpperCase();
  if (!code) {
    APPLIED_COUPON = null;
    if (feedback) { feedback.textContent = ""; feedback.className = "form-text"; }
    renderSummary();
    return Promise.resolve();
  }
  return api("api/coupon/validate", "POST", { code: code, subtotal_cents: Math.round(cartTotal() * 100) })
    .then((data) => {
      APPLIED_COUPON = data;
      if (feedback) { feedback.textContent = "Rabatt: -" + (data.discount_cents / 100).toFixed(2).replace(".", ",") + " €"; feedback.className = "form-text text-success"; }
      renderSummary();
    })
    .catch((err) => {
      APPLIED_COUPON = null;
      if (feedback) { feedback.textContent = err.message; feedback.className = "form-text text-danger"; }
      renderSummary();
    });
}

function cartItemsCount() {
  return getCart().reduce((sum, i) => sum + i.qty, 0);
}

function updateCartCount() {
  const el = document.getElementById("cartCount");
  if (el) {
    const n = cartItemsCount();
    el.textContent = n;
    el.classList.toggle("d-none", n === 0);
  }
}

function showToast(message, type) {
  const container = document.getElementById("toastContainer");
  if (!container) return;
  const isErr = type === "danger";
  const wrapper = document.createElement("div");
  wrapper.className = "toast align-items-center border-0 text-bg-" + (isErr ? "danger" : "success");
  wrapper.setAttribute("role", "alert");
  wrapper.innerHTML =
    '<div class="d-flex"><div class="toast-body">' + message + '</div>' +
    '<button type="button" class="btn-close me-2 m-auto' + (isErr ? "" : " btn-close-white") + '" data-bs-dismiss="toast" aria-label="Schließen"></button></div>';
  container.appendChild(wrapper);
  const toast = new bootstrap.Toast(wrapper, { delay: isErr ? 4000 : 2500 });
  toast.show();
  wrapper.addEventListener("hidden.bs.toast", () => wrapper.remove());
}

function imgFor(id, p) {
  if (p && p.image) return "assets/img/" + p.image;
  const labels = {
    salbei: "salbei.jpg",
    thymian: "thymian.jpg",
    rosmarin: "rosmarin.jpg",
    melisse: "melisse.jpg",
    kamille: "kamille.jpg",
    lavendel: "lavendel.jpg",
    minze: "minze.jpg",
    basilikum: "basilikum.jpg",
    salbeitee: "kraeutertee.jpg",
    kamillentee: "kamille.jpg",
    minztee: "minze.jpg",
    melissentee: "melisse.jpg",
    kraeuterbuendel: "kraeuterbuendel.jpg",
    ringelblume: "ringelblume.jpg",
    kapuzinerkresse: "kapuzinerkresse.jpg",
  };
  return "assets/img/" + (labels[id] || "kraeutergarten.jpg");
}

function renderCategories() {
  const wrap = document.getElementById("categoryFilters");
  if (!wrap) return;
  const cats = [];
  window.PRODUCTS.forEach((p) => {
    if (!cats.includes(p.category)) cats.push(p.category);
  });
  const preferred = ["Heilkräuterpflanzen", "Heilkräuter-Tees", "Blumen", "Sonstiges"];
  cats.sort(
    (a, b) =>
      (preferred.indexOf(a) === -1 ? 99 : preferred.indexOf(a)) -
      (preferred.indexOf(b) === -1 ? 99 : preferred.indexOf(b))
  );
  let html = '<button type="button" class="btn btn-irm active" data-filter="alle">Alle</button>';
  cats.forEach((c) => {
    html += '<button type="button" class="btn btn-outline-irm" data-filter="' + esc(c) + '">' + esc(c) + "</button>";
  });
  wrap.innerHTML = html;
  wrap.querySelectorAll("[data-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      wrap.querySelectorAll("[data-filter]").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      document.body.dataset.category = btn.dataset.filter;
      renderShop(btn.dataset.filter);
    });
  });
}

function renderShop(category) {
  const grid = document.getElementById("productGrid");
  if (!grid) return;
  const query = (window.SHOP_SEARCH || "").trim().toLowerCase();
  let list = category && category !== "alle"
    ? window.PRODUCTS.filter((p) => p.category === category)
    : window.PRODUCTS.slice();
  if (query) {
    list = list.filter((p) =>
      (p.name + " " + (p.desc || "") + " " + (p.category || "")).toLowerCase().includes(query)
    );
  }
  if (list.length === 0) {
    grid.innerHTML = '<div class="col-12 text-center py-5 text-muted">' +
      '<i class="bi bi-search display-3 d-block mb-3"></i>' +
      "<h4>Keine Produkte gefunden</h4>" +
      '<p class="mb-1">Für die Suche "' + esc(query || "") + '" gibt es keine Treffer.</p>' +
      "<button type=\"button\" class=\"btn btn-outline-irm mt-2\" id=\"searchResetBtn\">Suche zurücksetzen</button></div>";
    const resetBtn = grid.querySelector("#searchResetBtn");
    if (resetBtn) {
      resetBtn.addEventListener("click", () => {
        const input = document.getElementById("searchInput");
        if (input) input.value = "";
        window.SHOP_SEARCH = "";
        renderShop(document.body.dataset.category);
      });
    }
    return;
  }
  grid.innerHTML = list
    .map((p) => {
      const stock = stockInfo(p.id);
      const stockBadge = stock
        ? stock.out
          ? '<span class="badge bg-danger w-100 mb-2">' + stock.text + "</span>"
          : stock.low
          ? '<span class="badge bg-warning text-dark w-100 mb-2">' + stock.text + "</span>"
          : '<span class="badge bg-success w-100 mb-2">' + stock.text + "</span>"
        : "";
      const disabled = stock && stock.out ? " disabled" : "";
      const pName = esc(p.name || "");
      const pDesc = esc(p.desc || "");
      const pId = esc(p.id || "");
      return `
      <div class="col">
        <div class="card card-product h-100">
          <a href="produkt/${pId}"><img src="${imgFor(p.id, p)}" class="card-img-top" alt="${pName}"></a>
          <span class="badge badge-bio position-absolute top-0 start-0 m-2">Naturland Bio</span>
          <div class="card-body d-flex flex-column">
            <h5 class="card-title"><a href="produkt/${pId}" class="text-decoration-none text-dark">${pName}</a></h5>
            <p class="card-text text-muted small flex-grow-1">${pDesc}</p>
            ${stockBadge}
            <div class="d-flex justify-content-between align-items-center mt-2">
              <span class="price">${p.price.toFixed(2).replace(".", ",")} €</span>
              <button class="btn btn-irm btn-sm add-to-cart" data-id="${pId}"${disabled}>In den Warenkorb</button>
            </div>
            <a class="btn btn-outline-irm btn-sm w-100 mt-2" href="produkt/${pId}">Details ansehen</a>
          </div>
        </div>
      </div>`;
    })
    .join("");
  grid.querySelectorAll(".add-to-cart").forEach((btn) => {
    btn.addEventListener("click", () => addToCart(btn.dataset.id));
  });
}

function renderCart() {
  const tableBody = document.getElementById("cartBody");
  if (!tableBody) return;
  const cart = getCart();
  const emptyBox = document.getElementById("cartEmpty");
  const table = document.getElementById("cartTable");
  const summary = document.getElementById("cartSummary");

  if (cart.length === 0) {
    if (emptyBox) emptyBox.classList.remove("d-none");
    if (table) table.classList.add("d-none");
    if (summary) summary.classList.add("d-none");
    return;
  }

  if (emptyBox) emptyBox.classList.add("d-none");
  if (table) table.classList.remove("d-none");
  if (summary) summary.classList.remove("d-none");

  tableBody.innerHTML = cart
    .map((i) => {
      const p = getProduct(i.id);
      if (!p) return "";
      const lineTotal = p.price * i.qty;
      const pName = esc(p.name || "");
      const pId = esc(i.id || "");
      return `
        <tr>
          <td><img src="${imgFor(i.id, p)}" alt="${pName}" style="width:60px;height:45px;object-fit:cover;" class="rounded"></td>
          <td>${pName}</td>
          <td>${p.price.toFixed(2).replace(".", ",")} €</td>
          <td>
            <div class="input-group input-group-sm" style="max-width:120px;">
              <button class="btn btn-outline-secondary qty-minus" data-id="${pId}">-</button>
              <span class="form-control text-center">${i.qty}</span>
              <button class="btn btn-outline-secondary qty-plus" data-id="${pId}">+</button>
            </div>
          </td>
          <td class="fw-semibold">${lineTotal.toFixed(2).replace(".", ",")} €</td>
          <td><button class="btn btn-sm btn-outline-danger cart-remove" data-id="${pId}">Entfernen</button></td>
        </tr>`;
    })
    .join("");

  renderSummary();

  tableBody.querySelectorAll(".qty-plus").forEach((b) =>
    b.addEventListener("click", () => changeQty(b.dataset.id, 1))
  );
  tableBody.querySelectorAll(".qty-minus").forEach((b) =>
    b.addEventListener("click", () => changeQty(b.dataset.id, -1))
  );
  tableBody.querySelectorAll(".cart-remove").forEach((b) =>
    b.addEventListener("click", () => removeFromCart(b.dataset.id))
  );
}

// ---------------------------------------------------------------- auth

function currentUser() {
  return localStorage.getItem(USER_KEY) || "";
}

function setSession(data) {
  localStorage.setItem(TOKEN_KEY, data.token || "");
  localStorage.setItem(USER_KEY, data.username || "");
}

function logout() {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) {
    fetch("/api/logout", {
      method: "POST",
      headers: { Authorization: "Bearer " + token },
    }).catch(() => {});
  }
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  updateAuthUI();
  renderOrders();
  renderProfile();
}

function doRegister(username, password, email) {
  username = (username || "").trim();
  if (!username || !password || password.length < 6) {
    return Promise.reject(new Error("Bitte Benutzername und ein Passwort mit mindestens 6 Zeichen angeben."));
  }
  return api("api/register", "POST", { username, password, email }).then((data) => {
    setSession(data);
    return data;
  });
}

function doLogin(username, password) {
  username = (username || "").trim();
  return api("api/login", "POST", { username, password }).then((data) => {
    setSession(data);
    return data;
  });
}

function restoreSession() {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) return Promise.resolve(null);
  return api("api/me")
    .then((me) => {
      localStorage.setItem(USER_KEY, me.username || "");
      window.CURRENT_PROFILE = me;
      return me;
    })
    .catch(() => {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
      return null;
    });
}

function handleGoogleReturn() {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const token = hash.get("google_token");
  if (token) {
    setSession({ token, username: hash.get("google_user") || "" });
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    updateAuthUI();
    showToast("Anmeldung mit Google erfolgreich.");
    document.querySelectorAll(".checkout-login-required").forEach((el) => {
      el.classList.remove("d-none");
    });
    return;
  }
  const err = hash.get("google_error");
  if (err) {
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    showToast(
      err === "access_denied"
        ? "Die Google-Anmeldung wurde abgebrochen."
        : "Die Anmeldung mit Google ist fehlgeschlagen.",
      "danger"
    );
  }
}

function initGoogleLogin() {
  const btn = document.getElementById("googleLoginBtn");
  if (!btn) return;
  fetch("/api/config")
    .then((r) => r.json())
    .then((cfg) => {
      if (!cfg.googleLogin) btn.classList.add("d-none");
    })
    .catch(() => {});
}

function renderProfile() {
  const wrap = document.getElementById("profileWrap");
  if (!wrap) return;
  const user = currentUser();
  if (!user) {
    wrap.classList.add("d-none");
    return;
  }
  wrap.classList.remove("d-none");
  const p = window.CURRENT_PROFILE || {};
  const nameEl = document.getElementById("profileName");
  const emailEl = document.getElementById("profileEmail");
  const phoneEl = document.getElementById("profilePhone");
  if (nameEl) nameEl.value = p.name || "";
  if (emailEl) emailEl.value = p.email || "";
  if (phoneEl) phoneEl.value = p.phone || "";
}

// ---------------------------------------------------------------- checkout

const PENDING_ORDER_KEY = "irm_pending_order";

function orderItems() {
  return getCart().map((i) => {
    const p = getProduct(i.id);
    return { id: i.id, name: p ? p.name : i.id, qty: i.qty, price: p ? p.price : 0, total: (p ? p.price : 0) * i.qty };
  });
}

function startStripeCheckout() {
  const user = currentUser();
  const items = orderItems();
  if (items.length === 0) return Promise.reject(new Error("Der Warenkorb ist leer."));
  const val = (id) => (document.getElementById(id) ? document.getElementById(id).value.trim() : "");
  const delivery = {
    method: deliveryMode(),
    street: val("street"),
    zip: val("zip"),
    city: val("city"),
  };
  const body = {
    cart: getCart().map((i) => ({ id: i.id, qty: i.qty })),
    delivery: delivery.method === "delivery",
    shipping_address: { street: delivery.street, zip: delivery.zip, city: delivery.city },
    phone: val("phone"),
    name: (window.CURRENT_PROFILE || {}).name || "",
    coupon_code: APPLIED_COUPON ? APPLIED_COUPON.code : "",
  };
  const snapshot = {
    user: user,
    items: items,
    subtotal: cartTotal(),
    shipping: shippingFee(),
    total: cartTotal() + shippingFee(),
    delivery: delivery,
  };
  sessionStorage.setItem(PENDING_ORDER_KEY, JSON.stringify(snapshot));
  return api("api/create-checkout-session", "POST", body).then((data) => {
    if (!data.url) throw new Error("Die Zahlung konnte nicht gestartet werden.");
    window.location.href = data.url;
  });
}

function orderDate(o) {
  const v = o.created_at || o.date;
  return v ? new Date(v) : new Date();
}

function orderStatus(o) {
  return o.status === "Zahlung ausstehend" ? "Eingegangen" : o.status;
}

function renderConfirmation(order) {
  const wrap = document.getElementById("orderSuccessPage");
  if (!wrap) return;
  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };
  set("confirmOrderId", order.order_no);
  set("confirmStatus", orderStatus(order));
  set("confirmDate", orderDate(order).toLocaleString("de-DE"));
  const isDelivery = order.delivery && order.delivery.method === "delivery";
  set(
    "confirmDelivery",
    isDelivery
      ? "Versand an " +
        [order.delivery.street, order.delivery.zip && order.delivery.city ? order.delivery.zip + " " + order.delivery.city : order.delivery.city || ""]
          .filter(Boolean)
          .join(", ")
      : "Abholung im Gärtchen"
  );
  const itemsBody = document.getElementById("confirmItems");
  if (itemsBody) {
    itemsBody.innerHTML = (order.items || [])
      .map(
        (it) =>
          `<tr><td>${esc(it.name)}</td><td>${it.qty}</td><td>${it.price
            .toFixed(2)
            .replace(".", ",")} €</td><td class="text-end">${it.total
            .toFixed(2)
            .replace(".", ",")} €</td></tr>`
      )
      .join("");
  }
  set("confirmSubtotal", ((order.subtotal != null ? order.subtotal : order.total) || 0).toFixed(2).replace(".", ",") + " €");
  const discountEl = document.getElementById("confirmDiscount");
  if (discountEl) {
    if (order.discount > 0 && order.couponCode) {
      discountEl.textContent = "-" + order.discount.toFixed(2).replace(".", ",") + " € (" + order.couponCode + ")";
      discountEl.parentElement.classList.remove("d-none");
    } else {
      discountEl.parentElement.classList.add("d-none");
    }
  }
  const shipEl = document.getElementById("confirmShipping");
  if (shipEl) {
    shipEl.textContent = typeof order.shipping === "number" ? (order.shipping === 0 ? "kostenlos" : order.shipping.toFixed(2).replace(".", ",") + " €") : "–";
  }
  set("confirmTotal", (order.total || 0).toFixed(2).replace(".", ",") + " €");
  const fallback = document.getElementById("confirmFallback");
  if (fallback) fallback.classList.add("d-none");
  wrap.classList.remove("d-none");
}

function handleOrderSuccessPage() {
  const wrap = document.getElementById("orderSuccessPage");
  if (!wrap) return;
  const sessionId = new URLSearchParams(window.location.search).get("session_id") || "";
  const params = new URLSearchParams(window.location.search);

  const showFallback = () => {
    wrap.classList.add("d-none");
    const fallback = document.getElementById("confirmFallback");
    if (fallback) fallback.classList.remove("d-none");
  };

  if (!sessionId) {
    showFallback();
    return;
  }

  api("api/orders/session/" + encodeURIComponent(sessionId))
    .then((data) => {
      if (!data.order) throw new Error("not found");
      renderConfirmation(data.order);
      localStorage.removeItem(CART_KEY);
      updateCartCount();
      sessionStorage.removeItem(PENDING_ORDER_KEY);
      if (params.get("status")) {
        window.history.replaceState({}, "", window.location.pathname);
      }
    })
    .catch(() => showFallback());
}

function handleCheckoutReturn() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("status") === "cancel") {
    sessionStorage.removeItem(PENDING_ORDER_KEY);
    showToast("Die Zahlung wurde abgebrochen. Ihr Warenkorb bleibt erhalten.");
    window.history.replaceState({}, "", window.location.pathname);
  }
}

// ---------------------------------------------------------------- orders (customer)

function renderOrders() {
  const user = currentUser();
  const wrap = document.getElementById("ordersWrap");
  if (!wrap) return;
  const guest = document.getElementById("ordersGuest");
  const list = document.getElementById("ordersList");
  const empty = document.getElementById("ordersEmpty");

  if (!user) {
    wrap.classList.add("d-none");
    if (guest) guest.classList.remove("d-none");
    return;
  }
  wrap.classList.remove("d-none");
  if (guest) guest.classList.add("d-none");
  const nameEl = document.getElementById("accountUser");
  if (nameEl) nameEl.textContent = user;

  const orders = window.MY_ORDERS || [];
  if (orders.length === 0) {
    if (empty) empty.classList.remove("d-none");
    if (list) list.innerHTML = "";
    return;
  }
  if (empty) empty.classList.add("d-none");
  list.innerHTML = orders
    .map((o) => {
      const shippingLine =
        typeof o.shipping === "number"
          ? `<tr><td>Versand</td><td>1</td><td>${o.shipping
              .toFixed(2)
              .replace(".", ",")} €</td><td class="text-end">${o.shipping
              .toFixed(2)
              .replace(".", ",")} €</td></tr>`
          : "";
      const deliveryInfo = esc(
        o.delivery && o.delivery.method === "delivery"
          ? `Versand an: ${[o.delivery.street, o.delivery.zip && o.delivery.city ? o.delivery.zip + " " + o.delivery.city : o.delivery.city || ""]
              .filter(Boolean)
              .join(", ")}`
          : "Abholung im Gärtchen"
      );
      const isDelivery = o.delivery && o.delivery.method === "delivery";
      const orderNoEsc = esc(o.order_no);
      const confirmBlock = o.customerConfirmed
        ? `<div class="mt-3">
            <span class="badge bg-success"><i class="bi bi-check2-circle"></i> ${
              isDelivery ? "Erhalten" : "Abgeholt"
            } – bestätigt am ${o.customerConfirmedAt ? new Date(o.customerConfirmedAt).toLocaleDateString("de-DE") : "?"}</span>
          </div>`
        : `<div class="mt-3">
            <button type="button" class="btn btn-sm btn-outline-success order-confirm" data-order="${orderNoEsc}" title="Nach Erhalt/Abholung bestätigen">
              <i class="bi bi-check2-circle"></i> ${isDelivery ? "Als erhalten bestätigen" : "Als abgeholt bestätigen"}
            </button>
          </div>`;
      const returnBlock = o.returnProcessed
        ? `<div class="mt-2"><span class="badge bg-secondary"><i class="bi bi-arrow-counterclockwise"></i> Rückgabe bearbeitet</span></div>`
        : o.returnRequested
        ? `<div class="mt-2"><span class="badge bg-danger"><i class="bi bi-arrow-counterclockwise"></i> Rückgabe angefordert${
            o.returnReason ? " – " + esc(o.returnReason) : ""
          }</span></div>`
        : o.customerConfirmed
        ? `<div class="mt-2">
            <button type="button" class="btn btn-sm btn-outline-danger return-toggle" data-order="${orderNoEsc}">
              <i class="bi bi-arrow-counterclockwise"></i> Rückgabe anfordern
            </button>
            <div class="return-form d-none mt-2">
              <textarea class="form-control form-control-sm return-reason" rows="2" placeholder="Grund der Rückgabe (optional)"></textarea>
              <button type="button" class="btn btn-sm btn-danger mt-2 return-submit" data-order="${orderNoEsc}">Rückgabe anfragen</button>
              <p class="text-muted small mt-2 mb-0"><i class="bi bi-info-circle"></i> Die Rücksendekosten trägt der Kunde, außer die Ware ist bei uns fehlerhaft. Wir melden uns zur Absprache.</p>
            </div>
          </div>`
        : "";
      return `
      <div class="card mb-3">
        <div class="card-header d-flex justify-content-between align-items-center flex-wrap gap-2">
          <strong>Bestellung ${orderNoEsc}</strong>
          <span class="badge badge-bio">${orderStatus(o)}</span>
        </div>
        <div class="card-body">
          <p class="text-muted small mb-2">Bestellt am ${orderDate(o).toLocaleString("de-DE")}</p>
          <p class="small mb-2"><i class="bi bi-${isDelivery ? "truck" : "shop"}"></i> ${deliveryInfo}</p>
          <table class="table table-sm mb-2">
            <thead>
              <tr><th>Produkt</th><th>Menge</th><th>Preis</th><th class="text-end">Summe</th></tr>
            </thead>
            <tbody>
              ${o.items
                .map(
                  (it) =>
                    `<tr><td>${esc(it.name)}</td><td>${it.qty}</td><td>${it.price
                      .toFixed(2)
                      .replace(".", ",")} €</td><td class="text-end">${it.total
                      .toFixed(2)
                      .replace(".", ",")} €</td></tr>`
                )
                .join("")}
              ${shippingLine}
            </tbody>
          </table>
          ${o.discount > 0 ? '<div class="text-end text-success small mb-1">Rabatt (' + esc(o.couponCode) + '): -' + o.discount.toFixed(2).replace(".", ",") + ' €</div>' : ""}
          <div class="text-end fw-bold">Gesamt: ${o.total.toFixed(2).replace(".", ",")} €</div>
          ${confirmBlock}
          ${returnBlock}
        </div>
      </div>`;
    })
    .join("");
}

function refreshOrders() {
  if (!currentUser() || !localStorage.getItem(TOKEN_KEY)) {
    window.MY_ORDERS = [];
    renderOrders();
    return Promise.resolve();
  }
  return api("api/orders")
    .then((data) => {
      window.MY_ORDERS = data.orders || [];
      renderOrders();
    })
    .catch(() => {
      window.MY_ORDERS = [];
      renderOrders();
    });
}

function requestReturn(orderId, reason) {
  api("api/orders/return", "POST", { order_no: orderId, reason: (reason || "").trim() })
    .then(() => {
      showToast("Ihre Rückgabeanfrage wurde übermittelt.");
      return refreshOrders();
    })
    .catch((err) => showToast(err.message));
}

function confirmOrderReceived(orderId) {
  api("api/orders/confirm", "POST", { order_no: orderId })
    .then(() => {
      const o = (window.MY_ORDERS || []).find((x) => x.order_no === orderId);
      const isDelivery = o && o.delivery && o.delivery.method === "delivery";
      showToast(
        "Vielen Dank! Bestellung " + orderId + " als " +
        (isDelivery ? "erhalten" : "abgeholt") +
        " bestätigt."
      );
      return refreshOrders();
    })
    .catch((err) => showToast(err.message));
}

// ---------------------------------------------------------------- UI helpers

function updateAuthUI() {
  const user = currentUser();
  document.querySelectorAll(".auth-anonymous").forEach((el) => {
    el.classList.toggle("d-none", !!user);
  });
  document.querySelectorAll(".auth-authenticated").forEach((el) => {
    el.classList.toggle("d-none", !user);
  });
  document.querySelectorAll(".auth-user-name").forEach((el) => {
    el.textContent = user;
  });
}

function showAuthMessage(msg, type) {
  const box = document.getElementById("authMessage");
  if (!box) return;
  box.className = "alert mt-3 mb-0 alert-" + (type || "info");
  box.classList.remove("d-none");
  box.textContent = msg;
}

function openLoginModal() {
  const modalEl = document.getElementById("loginModal");
  if (!modalEl) return;
  const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
  modal.show();
}

function switchAuthForm(tab) {
  document.querySelectorAll("[data-auth-tab]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.authTab === tab);
  });
  const loginForm = document.getElementById("loginForm");
  const regForm = document.getElementById("registerForm");
  if (loginForm) loginForm.classList.toggle("d-none", tab !== "login");
  if (regForm) regForm.classList.toggle("d-none", tab !== "register");
  const box = document.getElementById("authMessage");
  if (box) box.classList.add("d-none");
}

function afterAuthSuccess(message) {
  updateAuthUI();
  refreshOrders();
  renderProfile();
  const modalEl = document.getElementById("loginModal");
  if (modalEl) bootstrap.Modal.getOrCreateInstance(modalEl).hide();
  showToast(message);
  document.querySelectorAll(".checkout-login-required").forEach((el) => {
    el.classList.remove("d-none");
  });
}

document.addEventListener("DOMContentLoaded", () => {
  initCookieBanner();
  updateCartCount();
  updateAuthUI();
  renderCart();
  renderSummary();
  handleCheckoutReturn();
  handleOrderSuccessPage();
  handleGoogleReturn();
  initGoogleLogin();

  const productAddBtn = document.getElementById("productAddToCart");
  if (productAddBtn) {
    productAddBtn.addEventListener("click", () => addToCart(productAddBtn.dataset.id));
  }

  const searchInput = document.getElementById("searchInput");
  if (searchInput) {
    searchInput.addEventListener("input", () => {
      window.SHOP_SEARCH = searchInput.value;
      renderShop(document.body.dataset.category);
    });
    const searchClear = document.getElementById("searchClear");
    if (searchClear) {
      searchClear.addEventListener("click", () => {
        searchInput.value = "";
        window.SHOP_SEARCH = "";
        renderShop(document.body.dataset.category);
        searchInput.focus();
      });
    }
    const searchForm = document.getElementById("searchForm");
    if (searchForm) {
      searchForm.addEventListener("submit", (e) => e.preventDefault());
    }
  }

  loadProducts().then(() => {
    renderCategories();
    renderShop(document.body.dataset.category);
    renderCart();
    renderSummary();
  });

  restoreSession().then(() => {
    updateAuthUI();
    renderProfile();
    return refreshOrders();
  });

  document.addEventListener("click", (e) => {
    const confirmBtn = e.target.closest(".order-confirm");
    if (confirmBtn) {
      confirmOrderReceived(confirmBtn.dataset.order);
      return;
    }
    const toggleBtn = e.target.closest(".return-toggle");
    if (toggleBtn) {
      const form = toggleBtn.parentElement.querySelector(".return-form");
      if (form) form.classList.toggle("d-none");
      return;
    }
    const submitBtn = e.target.closest(".return-submit");
    if (submitBtn) {
      const reasonEl = submitBtn.parentElement.querySelector(".return-reason");
      requestReturn(submitBtn.dataset.order, reasonEl ? reasonEl.value : "");
    }
  });

  document.querySelectorAll('input[name="delivery"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      const ship = deliveryMode() === "delivery";
      const fields = document.getElementById("shippingFields");
      if (fields) fields.classList.toggle("d-none", !ship);
      ["street", "zip", "city"].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.required = ship;
      });
      renderSummary();
    });
  });

  const checkoutModalEl = document.getElementById("checkoutModal");
  if (checkoutModalEl) {
    checkoutModalEl.addEventListener("show.bs.modal", () => {
      APPLIED_COUPON = null;
      const couponInput = document.getElementById("couponInput");
      const couponFeedback = document.getElementById("couponFeedback");
      if (couponInput) couponInput.value = "";
      if (couponFeedback) { couponFeedback.textContent = ""; couponFeedback.className = "form-text"; }
      const p = window.CURRENT_PROFILE || {};
      const nameEl = document.getElementById("name");
      const emailEl = document.getElementById("email");
      const phoneEl = document.getElementById("phone");
      if (nameEl && p.name) nameEl.value = p.name;
      if (emailEl && p.email) emailEl.value = p.email;
      if (phoneEl && p.phone) phoneEl.value = p.phone;
      const pickup = document.getElementById("deliveryPickup");
      if (pickup) pickup.checked = true;
      const fields = document.getElementById("shippingFields");
      if (fields) fields.classList.add("d-none");
      ["street", "zip", "city"].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.required = false;
      });
      renderSummary();
    });
  }

  const couponBtn = document.getElementById("couponApplyBtn");
  if (couponBtn) {
    couponBtn.addEventListener("click", () => applyCoupon());
    const couponInput = document.getElementById("couponInput");
    if (couponInput) {
      couponInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); applyCoupon(); }
      });
    }
  }

  const profileForm = document.getElementById("profileForm");
  if (profileForm) {
    profileForm.addEventListener("submit", (e) => {
      e.preventDefault();
      api("api/me", "PUT", {
        name: document.getElementById("profileName").value.trim(),
        email: document.getElementById("profileEmail").value.trim(),
        phone: document.getElementById("profilePhone").value.trim(),
      })
        .then(() => {
          window.CURRENT_PROFILE = {
            username: currentUser(),
            name: document.getElementById("profileName").value.trim(),
            email: document.getElementById("profileEmail").value.trim(),
            phone: document.getElementById("profilePhone").value.trim(),
          };
          showToast("Profil gespeichert.");
        })
        .catch((err) => showToast(err.message));
    });
  }

  const checkoutForm = document.getElementById("checkoutForm");
  if (checkoutForm) {
    checkoutForm.addEventListener("submit", (e) => {
      e.preventDefault();
      if (getCart().length === 0) {
        alert("Ihr Warenkorb ist leer.");
        return;
      }
      if (!currentUser() || !localStorage.getItem(TOKEN_KEY)) {
        openLoginModal();
        showAuthMessage("Bitte melden Sie sich an oder registrieren Sie sich, um Ihre Bestellung aufzugeben und zu verfolgen.", "warning");
        return;
      }
      const submitBtn = e.target.querySelector("button[type=submit]");
      if (submitBtn) submitBtn.disabled = true;
      startStripeCheckout().catch((err) => {
        if (submitBtn) submitBtn.disabled = false;
        showToast(err.message || "Die Zahlung konnte nicht gestartet werden.");
      });
    });
  }

  const loginForm = document.getElementById("loginForm");
  if (loginForm) {
    loginForm.addEventListener("submit", (e) => {
      e.preventDefault();
      doLogin(
        document.getElementById("loginUser").value,
        document.getElementById("loginPass").value
      )
        .then((data) => {
          afterAuthSuccess("Willkommen zurück, " + currentUser() + "!");
        })
        .catch((err) => showAuthMessage(err.message, "danger"));
    });
    if (!loginForm.querySelector("[data-forgot-link]")) {
      const forgotWrap = document.createElement("div");
      forgotWrap.className = "text-center mt-2";
      forgotWrap.innerHTML = '<a href="forgot-password.html" class="small text-muted" data-forgot-link>Passwort vergessen?</a>';
      loginForm.appendChild(forgotWrap);
    }
  }

  const registerForm = document.getElementById("registerForm");
  if (registerForm) {
    registerForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const pass = document.getElementById("regPass").value;
      const pass2 = document.getElementById("regPass2").value;
      if (pass !== pass2) {
        showAuthMessage("Die Passwörter stimmen nicht überein.", "danger");
        return;
      }
      doRegister(
        document.getElementById("regUser").value,
        pass,
        document.getElementById("regEmail").value
      )
        .then(() => {
          const name = document.getElementById("regName");
          if (name && name.value.trim()) {
            api("api/me", "PUT", {
              name: name.value.trim(),
              email: document.getElementById("regEmail").value.trim(),
              phone: "",
            }).catch(() => {});
          }
          afterAuthSuccess("Konto erstellt. Willkommen, " + currentUser() + "!");
        })
        .catch((err) => showAuthMessage(err.message, "danger"));
    });
  }

  document.querySelectorAll("[data-auth-tab]").forEach((btn) => {
    btn.addEventListener("click", () => switchAuthForm(btn.dataset.authTab));
  });

  document.querySelectorAll("#logoutBtn").forEach((btn) => {
    btn.addEventListener("click", () => {
      logout();
      showToast("Sie wurden abgemeldet.");
    });
  });

  const pageLoader = document.getElementById("pageLoader");
  if (pageLoader) {
    const hideLoader = () => {
      pageLoader.classList.add("hidden");
      setTimeout(() => pageLoader.remove(), 600);
    };
    if (document.readyState === "complete") {
      setTimeout(hideLoader, 350);
    } else {
      window.addEventListener("load", () => setTimeout(hideLoader, 350));
      setTimeout(hideLoader, 3000);
    }
  }

  if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches && "IntersectionObserver" in window) {
    const revealTargets = document.querySelectorAll(
      "main > section, main > h1, main > h2, main > .alert, main > .row > .col > .card, .hero-content, footer"
    );
    const revealObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            revealObserver.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
    );
    revealTargets.forEach((el) => {
      el.classList.add("reveal");
      revealObserver.observe(el);
    });
  }
});
