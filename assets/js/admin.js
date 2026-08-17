const ADMIN_TOKEN_KEY = "irm_admin_token";
const STATUSES = ["Eingegangen", "In Bearbeitung", "Bereit zur Abholung", "Versandt", "Abgeschlossen"];
const STATUSES_SHIPPING = ["Eingegangen", "In Bearbeitung", "Versandt", "Abgeschlossen"];
const STATUS_CLASS = {
  "Zahlung ausstehend": "bg-secondary",
  "Eingegangen": "bg-secondary",
  "In Bearbeitung": "bg-primary",
  "Bereit zur Abholung": "bg-warning text-dark",
  "Versandt": "bg-info",
  "Abgeschlossen": "bg-success",
};

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

(function initPageLoader() {
  const loader = document.getElementById("pageLoader");
  if (!loader) return;
  const hide = () => {
    loader.classList.add("hidden");
    setTimeout(() => loader.remove(), 600);
  };
  if (document.readyState === "complete") {
    setTimeout(hide, 350);
  } else {
    window.addEventListener("load", () => setTimeout(hide, 350));
    setTimeout(hide, 3000);
  }
})();

function adminApi(path, method, body) {
  const headers = { Accept: "application/json", "Content-Type": "application/json" };
  const token = localStorage.getItem(ADMIN_TOKEN_KEY);
  if (token) headers.Authorization = "Bearer " + token;
  const opts = { method: method || "GET", headers };
  if (body !== undefined) opts.body = JSON.stringify(body);
  if (path && !path.startsWith("/")) path = "/" + path;
  return fetch(path, opts).then(parseApiResponse);
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

function adminUpload(path, file) {
  const fd = new FormData();
  fd.append("file", file);
  const headers = { Accept: "application/json" };
  const token = localStorage.getItem(ADMIN_TOKEN_KEY);
  if (token) headers.Authorization = "Bearer " + token;
  if (path && !path.startsWith("/")) path = "/" + path;
  return fetch(path, { method: "POST", headers, body: fd }).then(parseApiResponse);
}

function adminLoggedIn() {
  return !!localStorage.getItem(ADMIN_TOKEN_KEY);
}

function adminLogout() {
  const token = localStorage.getItem(ADMIN_TOKEN_KEY);
  if (token) {
    fetch("/api/logout", { method: "POST", headers: { Authorization: "Bearer " + token } }).catch(() => {});
  }
  localStorage.removeItem(ADMIN_TOKEN_KEY);
}

function fmtMoney(v) {
  return (v || 0).toFixed(2).replace(".", ",") + " €";
}

function copyToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text);
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  document.body.appendChild(ta);
  ta.select();
  document.execCommand("copy");
  document.body.removeChild(ta);
  return Promise.resolve();
}

function showMsg(id, msg, type) {
  const box = document.getElementById(id);
  if (!box) return;
  box.className = "alert mt-3 mb-0 alert-" + (type || "info");
  box.classList.remove("d-none");
  box.textContent = msg;
}

function switchTab(tab) {
  document.querySelectorAll(".admin-tab").forEach((b) => {
    b.classList.toggle("active", b.dataset.tab === tab);
  });
  const ordersPanel = document.getElementById("ordersPanel");
  const inventory = document.getElementById("inventory");
  const messagesPanel = document.getElementById("messagesPanel");
  const statsPanel = document.getElementById("statsPanel");
  const fieldplanPanel = document.getElementById("fieldplanPanel");
  const backupPanel = document.getElementById("backupPanel");
  const couponsPanel = document.getElementById("couponsPanel");
  if (ordersPanel) ordersPanel.classList.toggle("d-none", tab !== "orders");
  if (inventory) inventory.classList.toggle("d-none", tab !== "inventory");
  if (messagesPanel) messagesPanel.classList.toggle("d-none", tab !== "messages");
  if (statsPanel) statsPanel.classList.toggle("d-none", tab !== "stats");
  if (fieldplanPanel) fieldplanPanel.classList.toggle("d-none", tab !== "fieldplan");
  if (backupPanel) backupPanel.classList.toggle("d-none", tab !== "backup");
  if (couponsPanel) couponsPanel.classList.toggle("d-none", tab !== "coupons");
  try {
    if (tab === "inventory") renderInventory();
    if (tab === "messages") renderMessages();
    if (tab === "stats") loadStats();
    if (tab === "fieldplan") loadFieldPlans();
    if (tab === "coupons") renderCoupons();
  } catch (e) {
    console.error("Tab-Fehler:", e);
    showMsg("ordersMsg", "Fehler beim Anzeigen: " + (e && e.message ? e.message : e), "danger");
  }
}

function renderAdmin() {
  const setupCard = document.getElementById("setupCard");
  const loginCard = document.getElementById("loginCard");
  const dashboard = document.getElementById("dashboard");
  const logoutBtn = document.getElementById("adminLogoutBtn");

  if (adminLoggedIn()) {
    if (setupCard) setupCard.classList.add("d-none");
    if (loginCard) loginCard.classList.add("d-none");
    if (dashboard) dashboard.classList.remove("d-none");
    if (logoutBtn) logoutBtn.classList.remove("d-none");
    switchTab("orders");
    loadDashboard();
    loadInventory();
    loadMessages();
    loadStats();
  } else {
    if (setupCard) setupCard.classList.add("d-none");
    if (loginCard) loginCard.classList.remove("d-none");
    if (dashboard) dashboard.classList.add("d-none");
    if (logoutBtn) logoutBtn.classList.add("d-none");
  }
}

// ---------------------------------------------------------------- orders

function loadDashboard() {
  adminApi("api/admin/orders")
    .then((data) => {
      window.ADMIN_ORDERS = data.orders || [];
      renderDashboard();
    })
    .catch((err) => {
      showMsg("ordersMsg", err.message || "Bestellungen konnten nicht geladen werden.", "danger");
    });
}

function waPhone(phone) {
  let d = String(phone || "").replace(/[^\d+]/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("0")) d = "49" + d.slice(1);
  return d.replace(/^\+/, "");
}

function contactCell(o) {
  const name = o.customerName || o.user || "";
  const email = o.customerEmail || "";
  const phone = o.customerPhone || "";
  const lines = [];
  if (name) lines.push(esc(name));
  if (phone) lines.push(esc(phone));
  if (email) lines.push('<span class="text-muted">' + esc(email) + "</span>");
  const btns = [];
  if (phone) {
    const wa = waPhone(phone);
    btns.push(
      '<a class="btn btn-sm btn-success" style="line-height:1;" href="https://wa.me/' + wa +
        '" target="_blank" rel="noopener" title="WhatsApp: ' + esc(phone) + '"><i class="bi bi-whatsapp"></i></a>'
    );
    btns.push(
      '<a class="btn btn-sm btn-outline-irm" style="line-height:1;" href="tel:' +
        esc(String(phone).replace(/\s+/g, "")) + '" title="Anrufen: ' + esc(phone) + '"><i class="bi bi-telephone"></i></a>'
    );
  }
  if (email) {
    btns.push(
      '<a class="btn btn-sm btn-outline-secondary" style="line-height:1;" href="mailto:' + esc(email) +
        '" title="E-Mail: ' + esc(email) + '"><i class="bi bi-envelope"></i></a>'
    );
  }
  return (
    lines.join("<br>") +
    (btns.length ? '<div class="d-flex gap-1 mt-1 flex-wrap">' + btns.join("") + "</div>" : "")
  );
}

function filterOrders(list) {
  const q = (window.ADMIN_ORDERS_QUERY || "").trim().toLowerCase();
  if (!q) return list;
  return list.filter((o) => {
    const name = String(o.customerName || o.user || "").toLowerCase();
    const id = String(o.order_no || "").toLowerCase();
    return name.includes(q) || id.includes(q);
  });
}

function orderSortKey(o) {
  const s = o.status || "";
  const rank = STATUSES.indexOf(s) >= 0 ? STATUSES.indexOf(s) : STATUSES_SHIPPING.indexOf(s);
  return rank >= 0 ? rank : 99;
}

function sortOrders(list) {
  const mode = window.ADMIN_ORDERS_SORT || "newest";
  const sorted = list.slice();
  const byDate = (a, b) => new Date(b.created_at) - new Date(a.created_at);
  const byId = (a, b) => {
    const na = parseInt(String(a.order_no || "").replace(/\D/g, ""), 10) || 0;
    const nb = parseInt(String(b.order_no || "").replace(/\D/g, ""), 10) || 0;
    return na - nb;
  };
  const byName = (a, b) => {
    const na = String(a.customerName || a.user || "").toLowerCase();
    const nb = String(b.customerName || b.user || "").toLowerCase();
    return na.localeCompare(nb, "de");
  };
  switch (mode) {
    case "oldest":
      return sorted.sort((a, b) => byDate(a, b) * -1);
    case "name_asc":
      return sorted.sort((a, b) => byName(a, b) || byDate(b, a));
    case "name_desc":
      return sorted.sort((a, b) => byName(b, a) || byDate(b, a));
    case "id_asc":
      return sorted.sort((a, b) => byId(a, b) || byDate(b, a));
    case "id_desc":
      return sorted.sort((a, b) => byId(b, a) || byDate(b, a));
    case "status":
      return sorted.sort((a, b) => orderSortKey(a) - orderSortKey(b) || byDate(b, a));
    default:
      return sorted.sort(byDate);
  }
}

const ordersSortEl = document.getElementById("ordersSort");
if (ordersSortEl) {
  ordersSortEl.addEventListener("change", () => {
    window.ADMIN_ORDERS_SORT = ordersSortEl.value;
    renderDashboard();
  });
}

const ordersSearchEl = document.getElementById("ordersSearch");
if (ordersSearchEl) {
  ordersSearchEl.addEventListener("input", () => {
    window.ADMIN_ORDERS_QUERY = ordersSearchEl.value;
    renderDashboard();
  });
}

function renderDashboard() {
  const orders = sortOrders(filterOrders(window.ADMIN_ORDERS || []));
  const body = document.getElementById("ordersBody");
  const noOrders = document.getElementById("noOrders");
  const tableWrap = document.getElementById("ordersTableArea");

  document.getElementById("statTotal").textContent = orders.length;
  document.getElementById("statOpen").textContent = orders.filter((o) => o.status !== "Abgeschlossen").length;
  const revenue = orders.reduce((sum, o) => sum + (o.refunded ? 0 : o.total || 0), 0);
  document.getElementById("statRevenue").textContent = fmtMoney(revenue);

  if (orders.length === 0) {
    if (noOrders) {
      const hasOrders = (window.ADMIN_ORDERS || []).length > 0;
      const emptyTitle = noOrders.querySelector("h4");
      const emptyText = noOrders.querySelector("p");
      if (hasOrders) {
        if (emptyTitle) emptyTitle.textContent = "Keine Treffer";
        if (emptyText) emptyText.textContent = "Keine Bestellung passt auf Ihre Suche.";
      } else {
        if (emptyTitle) emptyTitle.textContent = "Noch keine Bestellungen";
        if (emptyText) emptyText.textContent = "Sobald Kunden über den Shop bestellen, erscheinen die Bestellungen hier.";
      }
      noOrders.classList.remove("d-none");
    }
    if (tableWrap) tableWrap.classList.add("d-none");
    return;
  }
  if (noOrders) noOrders.classList.add("d-none");
  if (tableWrap) tableWrap.classList.remove("d-none");

  body.innerHTML = orders
    .map((o) => {
      const addrParts = [
        o.delivery && o.delivery.street ? o.delivery.street : "",
        o.delivery && o.delivery.zip && o.delivery.city ? o.delivery.zip + " " + o.delivery.city : o.delivery && o.delivery.city ? o.delivery.city : "",
      ].filter(Boolean);
      const copyText = [o.user, ...addrParts].filter(Boolean).join("\n");
      const items =
        '<ul class="list-unstyled mb-0 small">' +
        (o.items || [])
          .map((it) => "<li>" + esc(it.name) + " × " + it.qty + "</li>")
          .join("") +
        (o.delivery && o.delivery.method === "delivery"
          ? "</ul><span class='badge text-bg-info small copy-address' role='button' title='Klicken zum Kopieren' style='cursor:pointer' data-address='" +
            esc(copyText) +
            "'>Versand an " +
            esc(addrParts.join(", ")) +
            " <i class='bi bi-clipboard'></i></span>"
          : "</ul><span class='badge text-bg-secondary small'>Abholung</span>") +
        (o.customerConfirmed
          ? "<span class='badge text-bg-success small ms-1' title='Vom Kunden bestätigt am " +
            (o.customerConfirmedAt ? new Date(o.customerConfirmedAt).toLocaleDateString("de-DE") : "?") +
            "'>Kunde bestätigt</span>"
          : "") +
        (o.returnRequested
          ? "<span class='badge text-bg-danger small ms-1' title='" +
            esc(o.returnReason || "Kein Grund angegeben") +
            "'>Rückgabe angefordert</span>"
          : "") +
        (o.returnProcessed
          ? "<span class='badge text-bg-secondary small ms-1'>Rückgabe erledigt</span>"
          : "") +
        (o.refunded
          ? "<span class='badge text-bg-dark small ms-1' title='Erstattet am " +
            (o.refundedAt ? new Date(o.refundedAt).toLocaleDateString("de-DE") : "?") +
            "'>Erstattet</span>"
          : "") +
        (o.couponCode
          ? "<span class='badge text-bg-info small ms-1' title='Rabatt: -" +
            (o.discount || 0).toFixed(2).replace(".", ",") + " €'>Gutschein: " + esc(o.couponCode) + "</span>"
          : "");
      const isShipping = o.delivery && o.delivery.method === "delivery";
      const statusList = isShipping ? STATUSES_SHIPPING : STATUSES;
      const statusOptions = statusList.map(
        (s) => '<option value="' + s + '"' + (s === o.status ? " selected" : "") + ">" + s + "</option>"
      ).join("");
      return (
        '<tr>' +
        "<td><strong>" + esc(o.order_no) + "</strong></td>" +
        "<td>" + new Date(o.created_at).toLocaleString("de-DE") + "</td>" +
        "<td>" + contactCell(o) + "</td>" +
        "<td>" + items + "</td>" +
        "<td>" + fmtMoney(o.total) +
        (o.discount > 0 ? '<br><small class="text-success">-' + (o.discount).toFixed(2).replace(".", ",") + " €</small>" : "") +
        "</td>" +
        '<td><select class="form-select form-select-sm status-select" data-order="' + esc(o.order_no) + '">' + statusOptions + "</select></td>" +
        '<td class="text-end">' +
        (o.returnRequested && !o.returnProcessed
          ? '<button class="btn btn-sm btn-outline-warning return-done" data-order="' + esc(o.order_no) + '" title="Rückgabe als erledigt markieren"><i class="bi bi-check2-circle"></i></button> '
          : "") +
        (o.stripe_session_id && !o.refunded && o.status !== "Zahlung ausstehend"
          ? '<button class="btn btn-sm btn-outline-danger refund-btn" data-order="' + esc(o.order_no) + '" title="Betrag über Stripe erstatten"><i class="bi bi-cash-coin"></i></button> '
          : "") +
        '<button class="btn btn-sm btn-outline-danger order-delete" data-order="' + esc(o.order_no) + '" title="Löschen"><i class="bi bi-trash"></i></button></td>' +
        "</tr>"
      );
    })
    .join("");

  body.querySelectorAll(".status-select").forEach((sel) => {
    sel.addEventListener("change", () => {
      const orderNo = sel.dataset.order;
      const status = sel.value;
      adminApi("api/admin/orders/" + encodeURIComponent(orderNo), "PATCH", { status })
        .then(() => {
          showMsg("ordersMsg", "Status von " + orderNo + " auf „" + status + "“ gesetzt.", "success");
          loadDashboard();
        })
        .catch((err) => showMsg("ordersMsg", err.message, "danger"));
    });
  });
  body.querySelectorAll(".order-delete").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (confirm("Bestellung " + btn.dataset.order + " wirklich löschen?")) {
        adminApi("api/admin/orders/" + encodeURIComponent(btn.dataset.order), "DELETE")
          .then(() => {
            showMsg("ordersMsg", "Bestellung " + btn.dataset.order + " gelöscht.", "success");
            loadDashboard();
          })
          .catch((err) => showMsg("ordersMsg", err.message, "danger"));
      }
    });
  });
  body.querySelectorAll(".return-done").forEach((btn) => {
    btn.addEventListener("click", () => {
      adminApi("api/admin/orders/" + encodeURIComponent(btn.dataset.order) + "/return-done", "POST")
        .then(() => {
          showMsg("ordersMsg", "Rückgabe für " + btn.dataset.order + " als erledigt markiert.", "success");
          loadDashboard();
        })
        .catch((err) => showMsg("ordersMsg", err.message, "danger"));
    });
  });
  body.querySelectorAll(".refund-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      refundOrder(btn.dataset.order, btn);
    });
  });
  body.querySelectorAll(".copy-address").forEach((el) => {
    el.addEventListener("click", () => {
      const text = el.dataset.address || "";
      if (!text) return;
      copyToClipboard(text).then(() => {
        const old = el.innerHTML;
        el.innerHTML = '<i class="bi bi-check2"></i> Adresse kopiert';
        setTimeout(() => {
          el.innerHTML = old;
        }, 1500);
      });
    });
  });
}

function refundOrder(orderNo, btn) {
  const o = (window.ADMIN_ORDERS || []).find((x) => x.order_no === orderNo);
  if (!o) return;
  if (!confirm("Bestellung " + orderNo + " über Stripe erstatten? (" + fmtMoney(o.total) + ")")) return;
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';
  }
  adminApi("api/admin/orders/" + encodeURIComponent(orderNo) + "/refund", "POST")
    .then((data) => {
      showMsg("ordersMsg", "Erstattung über Stripe ausgeführt (" + fmtMoney((data.amount || 0) / 100) + ").", "success");
      loadDashboard();
    })
    .catch((err) => {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-cash-coin"></i>';
      }
      showMsg("ordersMsg", err.message || "Die Erstattung fehlgeschlagen.", "danger");
    });
}

// ---------------------------------------------------------------- messages

function loadMessages() {
  return adminApi("api/admin/messages").then((data) => {
    window.ADMIN_MESSAGES = data.messages || [];
  }).catch((err) => {
    showMsg("messagesMsg", err.message || "Nachrichten konnten nicht geladen werden.", "danger");
  });
}

function renderMessages() {
  const list = document.getElementById("messagesList");
  if (!list) return;
  const msgs = window.ADMIN_MESSAGES || [];
  const unread = msgs.filter((m) => !m.read).length;
  const badge = document.getElementById("msgCountBadge");
  if (badge) {
    badge.textContent = unread;
    badge.classList.toggle("d-none", unread === 0);
  }
  const noMessages = document.getElementById("noMessages");
  const listWrap = document.getElementById("messagesListWrap");
  if (msgs.length === 0) {
    if (noMessages) noMessages.classList.remove("d-none");
    if (listWrap) listWrap.classList.add("d-none");
    list.innerHTML = "";
    return;
  }
  if (noMessages) noMessages.classList.add("d-none");
  if (listWrap) listWrap.classList.remove("d-none");

  list.innerHTML = msgs
    .map((m) => {
      return (
        '<div class="card message-card' + (m.read ? "" : " border-warning") + '">' +
        '<div class="card-body">' +
        '<div class="d-flex justify-content-between align-items-start flex-wrap gap-2 mb-2">' +
        '<div>' +
        '<strong>' + (m.read ? "" : '<span class="badge text-bg-danger me-1">Neu</span>') + esc(m.name) + "</strong>" +
        ' <a class="small text-muted" href="mailto:' + esc(m.email) + '">' + esc(m.email) + "</a>" +
        "</div>" +
        '<small class="text-muted">' + new Date(m.createdAt).toLocaleString("de-DE") + "</small>" +
        "</div>" +
        '<div class="p-3 message-box">' + esc(m.message) + "</div>" +
        '<div class="d-flex gap-2 mt-2">' +
        '<button class="btn btn-sm btn-outline-secondary msg-read" data-id="' + m.id + '"' + (m.read ? " disabled" : "") + '><i class="bi bi-check2"></i> Als gelesen</button> ' +
        '<button class="btn btn-sm btn-outline-danger msg-delete" data-id="' + m.id + '"><i class="bi bi-trash"></i> Löschen</button>' +
        "</div>" +
        "</div>" +
        "</div>"
      );
    })
    .join("");

  list.querySelectorAll(".msg-read").forEach((btn) => {
    btn.addEventListener("click", () => {
      adminApi("api/admin/messages/" + btn.dataset.id + "/read", "POST")
        .then(loadMessages)
        .then(renderMessages)
        .catch((err) => showMsg("messagesMsg", err.message, "danger"));
    });
  });
  list.querySelectorAll(".msg-delete").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (confirm("Nachricht wirklich löschen?")) {
        adminApi("api/admin/messages/" + btn.dataset.id, "DELETE")
          .then(loadMessages)
          .then(renderMessages)
          .catch((err) => showMsg("messagesMsg", err.message, "danger"));
      }
    });
  });
}

// ---------------------------------------------------------------- inventory

function loadInventory() {
  return adminApi("api/admin/products").then((data) => {
    window.ADMIN_PRODUCTS = data.products || [];
  }).catch((err) => {
    showMsg("inventoryMsg", err.message || "Lagerbestand konnte nicht geladen werden.", "danger");
  });
}

function renderInventory() {
  const body = document.getElementById("inventoryBody");
  if (!body) return;
  const products = window.ADMIN_PRODUCTS || [];
  const categories = [];
  products.forEach((p) => {
    if (!categories.includes(p.category)) categories.push(p.category);
  });
  const catList = document.getElementById("catOptions");
  if (catList) {
    catList.innerHTML = categories.map((c) => "<option value=\"" + esc(c) + "\">").join("");
  }
  body.innerHTML = products
    .map((p) => {
      const cur = p.stock;
      const badge =
        cur === null
          ? '<span class="badge bg-secondary">Unbegrenzt</span>'
          : cur <= 0
          ? '<span class="badge bg-danger">' + cur + "</span>"
          : cur <= 5
          ? '<span class="badge bg-warning text-dark">' + cur + "</span>"
          : '<span class="badge bg-success">' + cur + "</span>";
      const imgSrc = p.image ? "assets/img/" + p.image : "assets/img/kraeutergarten.jpg";
      const safePrice = Number(p.price);
      const priceVal = (isNaN(safePrice) ? 0 : safePrice).toFixed(2);
      return (
        "<tr>" +
        "<td>" + esc(p.name) + (p.custom ? ' <span class="badge bg-info text-dark">eigen</span>' : "") + "</td>" +
        "<td><small class=\"text-muted\">" + esc(p.category) + "</small></td>" +
        "<td>" + badge + "</td>" +
        '<td style="max-width:130px;"><input type="number" min="0" step="1" class="form-control form-control-sm stock-input" data-id="' + esc(p.id) + '" placeholder="Anzahl" value="' + (cur === null ? "" : cur) + '"></td>' +
        '<td style="max-width:110px;"><input type="number" min="0" step="0.1" class="form-control form-control-sm price-input" data-id="' + esc(p.id) + '" value="' + priceVal + '"></td>' +
        '<td class="text-nowrap"><img src="' + imgSrc + '" alt="Bild" style="width:44px;height:44px;object-fit:cover;" class="rounded me-2">' +
        '<input type="file" accept="image/*" class="d-none img-file" data-id="' + esc(p.id) + '">' +
        '<button class="btn btn-sm btn-outline-secondary img-upload" data-id="' + esc(p.id) + '" title="Bild hochladen"><i class="bi bi-image"></i></button></td>' +
        '<td class="text-end text-nowrap">' +
        '<button class="btn btn-sm btn-outline-irm product-details" data-id="' + esc(p.id) + '" title="Details bearbeiten (Name, Kategorie, Preis, Bestand, Beschreibung)"><i class="bi bi-pencil-square"></i> Details</button> ' +
        '<button class="btn btn-sm btn-irm stock-save" data-id="' + esc(p.id) + '"><i class="bi bi-check-lg"></i> Speichern</button> ' +
        '<button class="btn btn-sm btn-outline-secondary stock-unlimited" data-id="' + esc(p.id) + '" title="Als unbegrenzt markieren"><i class="bi bi-infinity"></i></button> ' +
        '<button class="btn btn-sm btn-outline-danger stock-delete" data-id="' + esc(p.id) + '" title="Artikel löschen"><i class="bi bi-trash"></i></button>' +
        "</td>" +
        "</tr>"
      );
    })
    .join("");

  body.querySelectorAll(".stock-save").forEach((btn) => {
    btn.addEventListener("click", () => {
      const stockInput = body.querySelector('.stock-input[data-id="' + btn.dataset.id + '"]');
      const priceInput = body.querySelector('.price-input[data-id="' + btn.dataset.id + '"]');
      const value = stockInput ? stockInput.value : "";
      const stock = value === "" ? null : Math.max(0, Math.floor(Number(value)) || 0);
      const payload = { stock };
      if (priceInput && priceInput.value !== "") {
        payload.price = Math.max(0, Number(priceInput.value) || 0);
      }
      adminApi("api/admin/products/" + encodeURIComponent(btn.dataset.id), "PATCH", payload)
        .then(() => {
          showToast("Bestand und Preis gespeichert.");
          return loadInventory();
        })
        .then(renderInventory)
        .catch((err) => showToast(err.message));
    });
  });
  body.querySelectorAll(".stock-unlimited").forEach((btn) => {
    btn.addEventListener("click", () => {
      adminApi("api/admin/products/" + encodeURIComponent(btn.dataset.id), "PATCH", { stock: null })
        .then(() => {
          showToast("Als unbegrenzt markiert.");
          return loadInventory();
        })
        .then(renderInventory)
        .catch((err) => showToast(err.message));
    });
  });
  body.querySelectorAll(".img-upload").forEach((btn) => {
    btn.addEventListener("click", () => {
      const input = body.querySelector('.img-file[data-id="' + btn.dataset.id + '"]');
      if (input) input.click();
    });
  });
  body.querySelectorAll(".img-file").forEach((input) => {
    input.addEventListener("change", () => {
      const file = input.files && input.files[0];
      if (!file) return;
      const id = input.dataset.id;
      adminUpload("api/admin/products/" + encodeURIComponent(id) + "/image", file)
        .then(() => {
          showToast("Bild gespeichert.");
          return loadInventory();
        })
        .then(renderInventory)
        .catch((err) => showToast(err.message));
    });
  });
  body.querySelectorAll(".stock-delete").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (confirm("Artikel wirklich löschen? Er verschwindet dann aus dem Shop.")) {
        adminApi("api/admin/products/" + encodeURIComponent(btn.dataset.id), "DELETE")
          .then(() => {
            showToast("Artikel gelöscht.");
            return loadInventory();
          })
          .then(renderInventory)
          .catch((err) => showToast(err.message));
      }
    });
  });
  body.querySelectorAll(".product-details").forEach((btn) => {
    btn.addEventListener("click", () => {
      const product = (window.ADMIN_PRODUCTS || []).find((p) => p.id === btn.dataset.id);
      if (!product) return;
      document.getElementById("pdName").value = product.name || "";
      document.getElementById("pdId").value = product.id || "";
      document.getElementById("pdPrice").value = product.price != null ? product.price.toFixed(2) : "";
      document.getElementById("pdStock").value = product.stock === null ? "" : product.stock;
      document.getElementById("pdCategory").value = product.category || "";
      document.getElementById("pdDesc").value = product.desc || "";
      bootstrap.Modal.getOrCreateInstance(document.getElementById("productDetailsModal")).show();
    });
  });
}

document.addEventListener("DOMContentLoaded", () => {
  renderAdmin();
  initCouponForm();

  const loginForm = document.getElementById("adminLoginForm");
  if (loginForm) {
    loginForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const user = document.getElementById("adminUser").value.trim();
      const pass = document.getElementById("adminPass").value;
      adminApi("api/login", "POST", { username: user, password: pass })
        .then((data) => {
          if (data.role !== "admin") {
            throw new Error("Dieser Benutzer hat keine Administrator-Rechte.");
          }
          localStorage.setItem(ADMIN_TOKEN_KEY, data.token);
          showMsg("loginMsg", "", "info");
          renderAdmin();
          showToast("Angemeldet als Admin.");
        })
        .catch((err) => showMsg("loginMsg", err.message || "Falsches Passwort.", "danger"));
    });
  }

  const logoutBtn = document.getElementById("adminLogoutBtn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", () => {
      adminLogout();
      renderAdmin();
      showToast("Abgemeldet.");
    });
  }

  document.querySelectorAll(".admin-tab").forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });

  const pdSave = document.getElementById("pdSave");
  if (pdSave) {
    pdSave.addEventListener("click", () => {
      const id = document.getElementById("pdId").value;
      const name = document.getElementById("pdName").value.trim();
      if (!id || !name) {
        showToast("Bitte einen Namen angeben.");
        return;
      }
      const priceVal = document.getElementById("pdPrice").value;
      const stockVal = document.getElementById("pdStock").value;
      const payload = {
        name,
        category: document.getElementById("pdCategory").value.trim(),
        desc: document.getElementById("pdDesc").value.trim(),
      };
      if (priceVal !== "") payload.price = Math.max(0, Number(priceVal) || 0);
      payload.stock = stockVal === "" ? null : Math.max(0, Math.floor(Number(stockVal)) || 0);
      adminApi("api/admin/products/" + encodeURIComponent(id), "PATCH", payload)
        .then(() => {
          showToast("Artikeldetails gespeichert.");
          bootstrap.Modal.getOrCreateInstance(document.getElementById("productDetailsModal")).hide();
          return loadInventory();
        })
        .then(renderInventory)
        .catch((err) => showToast(err.message));
    });
  }

  const msgRefresh = document.getElementById("msgRefresh");
  if (msgRefresh) {
    msgRefresh.addEventListener("click", () => {
      loadMessages()
        .then(renderMessages)
        .catch((err) => showMsg("messagesMsg", err.message, "danger"));
    });
  }

  const statsRefresh = document.getElementById("statsRefresh");
  if (statsRefresh) {
    statsRefresh.addEventListener("click", () => {
      loadStats();
    });
  }

  const addProductForm = document.getElementById("addProductForm");
  if (addProductForm) {
    addProductForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const name = document.getElementById("apName").value.trim();
      const price = document.getElementById("apPrice").value;
      const id = document.getElementById("apId").value.trim().toLowerCase().replace(/\s+/g, "-");
      if (!name || price === "" || !id) {
        showMsg("addProductMsg", "Bitte Name, Artikel-ID und Preis angeben.", "danger");
        return;
      }
      const stock = document.getElementById("apStock").value;
      const imageInput = document.getElementById("apImage");
      adminApi("api/admin/products", "POST", {
        id: id,
        name: name,
        price: price,
        category: document.getElementById("apCategory").value,
        stock: stock === "" ? null : Number(stock),
        desc: document.getElementById("apDesc").value.trim(),
      })
        .then((data) => {
          const file = imageInput && imageInput.files && imageInput.files[0];
          if (!file) return Promise.resolve(data);
          return adminUpload("api/admin/products/" + encodeURIComponent(id) + "/image", file);
        })
        .then(() => {
          addProductForm.reset();
          showToast("Artikel " + name + " angelegt.");
          return loadInventory();
        })
        .then(renderInventory)
        .catch((err) => showMsg("addProductMsg", err.message || "Artikel konnte nicht angelegt werden.", "danger"));
    });
  }
});

// ---------------------------------------------------------------- stats

function loadStats() {
  return adminApi("api/admin/stats")
    .then((data) => {
      window.ADMIN_STATS = data;
      renderStats();
    })
    .catch((err) => {
      showMsg("statsMsg", err.message || "Statistiken konnten nicht geladen werden.", "danger");
    });
}

function renderStats() {
  const s = window.ADMIN_STATS;
  const totalEl = document.getElementById("statViewsTotal");
  const todayEl = document.getElementById("statViewsToday");
  const weekEl = document.getElementById("statViewsWeek");
  const visitorsTotalEl = document.getElementById("statVisitorsTotal");
  const visitorsTodayEl = document.getElementById("statVisitorsToday");
  const visitorsWeekEl = document.getElementById("statVisitorsWeek");
  const body = document.getElementById("statsTopBody");
  if (!s) return;
  if (totalEl) totalEl.textContent = (s.total || 0).toLocaleString("de-DE");
  if (todayEl) todayEl.textContent = (s.today || 0).toLocaleString("de-DE");
  if (weekEl) weekEl.textContent = (s.week || 0).toLocaleString("de-DE");
  if (visitorsTotalEl) visitorsTotalEl.textContent = (s.unique_total || 0).toLocaleString("de-DE");
  if (visitorsTodayEl) visitorsTodayEl.textContent = (s.unique_today || 0).toLocaleString("de-DE");
  if (visitorsWeekEl) visitorsWeekEl.textContent = (s.unique_week || 0).toLocaleString("de-DE");
  if (body) {
    const pages = s.top_pages || [];
    body.innerHTML = pages.length
      ? pages
          .map(
            (p) =>
              '<tr><td><code>' + esc(p.path) + "</code></td><td class=\"text-end\">" +
              (p.count || 0).toLocaleString("de-DE") + "</td></tr>"
          )
          .join("")
      : '<tr><td colspan="2" class="text-center text-muted py-4">Noch keine Besuche aufgezeichnet.</td></tr>';
  }
  renderViewsChart();
  renderVisitorsChart();
}

function renderViewsChart() {
  const canvas = document.getElementById("viewsChart");
  const s = window.ADMIN_STATS;
  if (!canvas || !s || typeof Chart === "undefined") return;
  const labels = (s.daily || []).map((d) => {
    const p = d.date.split("-");
    return p[2] + "." + p[1] + ".";
  });
  const counts = (s.daily || []).map((d) => d.count);
  if (window.__viewsChart) window.__viewsChart.destroy();
  window.__viewsChart = new Chart(canvas, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Besuche",
          data: counts,
          backgroundColor: "rgba(63, 107, 59, 0.75)",
          borderColor: "rgba(63, 107, 59, 1)",
          borderWidth: 1,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, ticks: { precision: 0 } },
        x: { grid: { display: false } },
      },
    },
  });
}

function renderVisitorsChart() {
  const canvas = document.getElementById("visitorsChart");
  const s = window.ADMIN_STATS;
  if (!canvas || !s || typeof Chart === "undefined") return;
  const labels = (s.daily_visitors || []).map((d) => {
    const p = d.date.split("-");
    return p[2] + "." + p[1] + ".";
  });
  const counts = (s.daily_visitors || []).map((d) => d.count);
  if (window.__visitorsChart) window.__visitorsChart.destroy();
  window.__visitorsChart = new Chart(canvas, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Einzigartige Besucher",
          data: counts,
          backgroundColor: "rgba(23, 111, 142, 0.15)",
          borderColor: "rgba(23, 111, 142, 1)",
          borderWidth: 2,
          fill: true,
          tension: 0.3,
          pointRadius: 3,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, ticks: { precision: 0 } },
        x: { grid: { display: false } },
      },
    },
  });
}

function showToast(message) {
  const container = document.getElementById("toastContainer");
  if (!container) return;
  const wrapper = document.createElement("div");
  wrapper.className = "toast align-items-center text-bg-success border-0";
  wrapper.setAttribute("role", "alert");
  wrapper.innerHTML =
    '<div class="d-flex"><div class="toast-body">' + message + "</div>" +
    '<button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Schließen"></button></div>';
  container.appendChild(wrapper);
  const toast = new bootstrap.Toast(wrapper, { delay: 2500 });
  toast.show();
  wrapper.addEventListener("hidden.bs.toast", () => wrapper.remove());
}

// ---------------------------------------------------------------- backup

function backupShowMsg(id, msg, type) {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = "alert mt-3 mb-0" + (type ? " alert-" + type : "");
  el.textContent = msg;
  el.classList.remove("d-none");
}

function createBackup() {
  const btn = document.getElementById("backupCreateBtn");
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Backup wird erstellt…';
  }
  const headers = { Accept: "application/zip" };
  const token = localStorage.getItem(ADMIN_TOKEN_KEY);
  if (token) headers.Authorization = "Bearer " + token;
  fetch("/api/admin/backup", { headers })
    .then((res) => {
      if (!res.ok) {
        return parseApiResponse(res).then(() => {
          throw new Error("Backup fehlgeschlagen (HTTP " + res.status + ").");
        });
      }
      const cd = res.headers.get("Content-Disposition") || "";
      let name = "irmgaertchen-backup.zip";
      const m = cd.match(/filename="?([^"]+)"?/);
      if (m) name = m[1];
      return res.blob().then((blob) => ({ blob, name }));
    })
    .then(({ blob, name }) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      backupShowMsg("backupMsg", "Backup heruntergeladen: " + name, "success");
    })
    .catch((err) => {
      backupShowMsg("backupMsg", (err && err.message ? err.message : "Backup fehlgeschlagen."), "danger");
    })
    .finally(() => {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-download"></i> Backup jetzt erstellen';
      }
    });
}

function restoreBackup() {
  const input = document.getElementById("backupRestoreFile");
  const file = input && input.files && input.files[0];
  const confirmMsg =
    "ACHTUNG: Diese Aktion ersetzt ALLE aktuellen Daten (Bestellungen, Kunden, Lager, " +
    "Statistiken, Bilder) durch den Stand der Sicherung. Dies kann nicht rückgängig gemacht werden.\n\n" +
    "Möchten Sie wirklich fortfahren?";
  if (!file) {
    backupShowMsg("backupRestoreMsg", "Bitte zuerst eine Backup-Datei (.zip) auswählen.", "warning");
    return;
  }
  if (!confirm(confirmMsg)) return;
  const btn = document.getElementById("backupRestoreBtn");
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Wird wiederhergestellt…';
  }
  adminUpload("api/admin/backup/restore", file)
    .then((data) => {
      if (data.new_token) localStorage.setItem(ADMIN_TOKEN_KEY, data.new_token);
      const tables = (data.tables_restored || []).length;
      backupShowMsg(
        "backupRestoreMsg",
        "Wiederherstellung abgeschlossen: " + tables + " Tabellen, " +
        (data.images_restored || 0) + " Bilder. Seite wird neu geladen …",
        "success"
      );
      setTimeout(() => location.reload(), 1500);
    })
    .catch((err) => {
      backupShowMsg("backupRestoreMsg", (err && err.message ? err.message : "Wiederherstellung fehlgeschlagen."), "danger");
    })
     .finally(() => {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-upload"></i> Sicherung einspielen';
      }
    });
}

// ---------------------------------------------------------------- coupons

function generateCouponCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function renderCoupons() {
  adminApi("api/admin/coupons")
    .then((data) => {
      const coupons = data.coupons || [];
      const body = document.getElementById("couponsBody");
      const empty = document.getElementById("couponsEmpty");
      const tableArea = body ? body.closest(".table-responsive") : null;
      if (!body) return;
      if (coupons.length === 0) {
        if (empty) empty.classList.remove("d-none");
        if (tableArea) tableArea.classList.add("d-none");
        return;
      }
      if (empty) empty.classList.add("d-none");
      if (tableArea) tableArea.classList.remove("d-none");
      const now = new Date().toISOString();
      body.innerHTML = coupons
        .map((c) => {
          const valueLabel =
            c.discount_type === "percent" ? c.discount_value + "%" : fmtMoney(c.discount_value / 100);
          const minLabel = c.min_total_cents > 0 ? "ab " + fmtMoney(c.min_total_cents / 100) : "–";
          const usesLabel = c.max_uses === 0 ? c.used_count + " / ∞" : c.used_count + " / " + c.max_uses;
          const untilLabel = c.valid_until
            ? new Date(c.valid_until).toLocaleDateString("de-DE")
            : "Unbegrenzt";
          let statusBadge;
          if (!c.active) {
            statusBadge = '<span class="badge bg-secondary">Deaktiviert</span>';
          } else if (c.valid_until && c.valid_until < now) {
            statusBadge = '<span class="badge bg-secondary">Abgelaufen</span>';
          } else if (c.max_uses > 0 && c.used_count >= c.max_uses) {
            statusBadge = '<span class="badge bg-warning text-dark">Aufgebraucht</span>';
          } else {
            statusBadge = '<span class="badge bg-success">Aktiv</span>';
          }
          return (
            "<tr>" +
            "<td><strong>" + esc(c.code) + "</strong></td>" +
            "<td>" + (c.discount_type === "percent" ? "Prozent" : "Festbetrag") + "</td>" +
            "<td>" + valueLabel + "</td>" +
            "<td>" + minLabel + "</td>" +
            "<td>" + usesLabel + "</td>" +
            "<td>" + untilLabel + "</td>" +
            "<td>" + statusBadge + "</td>" +
            '<td class="text-end">' +
            '<button class="btn btn-sm btn-outline-primary coupon-edit" data-id="' + c.id + '" title="Bearbeiten"><i class="bi bi-pencil"></i></button> ' +
            '<button class="btn btn-sm btn-outline-danger coupon-delete" data-id="' + c.id + '" title="Löschen"><i class="bi bi-trash"></i></button>' +
            "</td></tr>"
          );
        })
        .join("");
      body.querySelectorAll(".coupon-edit").forEach((btn) => {
        btn.addEventListener("click", () => editCoupon(btn.dataset.id));
      });
      body.querySelectorAll(".coupon-delete").forEach((btn) => {
        btn.addEventListener("click", () => deleteCoupon(btn.dataset.id));
      });
    })
    .catch(() => {});
}

function editCoupon(id) {
  adminApi("api/admin/coupons")
    .then((data) => {
      const c = (data.coupons || []).find((x) => String(x.id) === String(id));
      if (!c) return;
      document.getElementById("couponEditId").value = c.id;
      document.getElementById("couponCode").value = c.code;
      document.getElementById("couponCode").disabled = true;
      document.getElementById("couponType").value = c.discount_type;
      document.getElementById("couponValue").value = c.discount_value;
      document.getElementById("couponMinTotal").value = (c.min_total_cents / 100).toFixed(2);
      document.getElementById("couponMaxUses").value = c.max_uses;
      if (c.valid_until) {
        document.getElementById("couponValidUntil").value = c.valid_until.split("T")[0];
      } else {
        document.getElementById("couponValidUntil").value = "";
      }
      document.getElementById("couponCancelEdit").classList.remove("d-none");
      updateCouponValueHint();
    });
}

function deleteCoupon(id) {
  if (!confirm("Gutschein wirklich löschen?")) return;
  adminApi("api/admin/coupons/" + id, "DELETE")
    .then(() => {
      showMsg("couponsMsg", "Gutschein gelöscht.", "success");
      renderCoupons();
    })
    .catch((err) => showMsg("couponsMsg", err.message, "danger"));
}

function updateCouponValueHint() {
  const input = document.getElementById("couponValue");
  const type = document.getElementById("couponType").value;
  if (input) input.placeholder = type === "percent" ? "z.B. 10" : "z.B. 500";
}

function initCouponForm() {
  const form = document.getElementById("couponForm");
  const randomBtn = document.getElementById("couponCodeRandom");
  const cancelBtn = document.getElementById("couponCancelEdit");
  const typeSelect = document.getElementById("couponType");

  if (randomBtn) {
    randomBtn.addEventListener("click", () => {
      document.getElementById("couponCode").value = generateCouponCode();
    });
  }
  if (typeSelect) {
    typeSelect.addEventListener("change", updateCouponValueHint);
  }
  if (cancelBtn) {
    cancelBtn.addEventListener("click", () => {
      form.reset();
      document.getElementById("couponEditId").value = "";
      document.getElementById("couponCode").disabled = false;
      cancelBtn.classList.add("d-none");
      updateCouponValueHint();
    });
  }
  if (form) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const editId = document.getElementById("couponEditId").value;
      const code = document.getElementById("couponCode").value.trim().toUpperCase();
      const dtype = document.getElementById("couponType").value;
      const rawValue = document.getElementById("couponValue").value;
      const value = dtype === "percent" ? parseInt(rawValue) : Math.round(parseFloat(rawValue) * 100);
      const minTotal = Math.round((parseFloat(document.getElementById("couponMinTotal").value) || 0) * 100);
      const maxUses = parseInt(document.getElementById("couponMaxUses").value) || 0;
      const untilRaw = document.getElementById("couponValidUntil").value;
      const validUntil = untilRaw ? untilRaw + "T23:59:59Z" : "";
      if (!code || code.length < 2) {
        showMsg("couponsMsg", "Code muss mindestens 2 Zeichen lang sein.", "danger");
        return;
      }
      if (!value || value <= 0) {
        showMsg("couponsMsg", "Bitte einen gültigen Rabattwert eingeben.", "danger");
        return;
      }
      const body = {
        code: code,
        discount_type: dtype,
        discount_value: value,
        min_total_cents: minTotal,
        max_uses: maxUses,
        valid_until: validUntil,
      };
      const action = editId
        ? adminApi("api/admin/coupons/" + editId, "PUT", body)
        : adminApi("api/admin/coupons", "POST", body);
      action
        .then(() => {
          showMsg("couponsMsg", editId ? "Gutschein aktualisiert." : "Gutschein angelegt.", "success");
          form.reset();
          document.getElementById("couponEditId").value = "";
          document.getElementById("couponCode").disabled = false;
          cancelBtn.classList.add("d-none");
          updateCouponValueHint();
          renderCoupons();
        })
        .catch((err) => showMsg("couponsMsg", err.message, "danger"));
    });
  }
}

// ---------------------------------------------------------------- field plans / crop planner

const FIELD_COLORS = [
  "#3f6b3b", "#c9a227", "#176f8e", "#b04a5a",
  "#6a5acd", "#e07020", "#2e8b57", "#cd5c5c",
  "#4682b4", "#9b59b6",
];
const GROWTH_STAGES = ["Saaten", "Keimlinge", "Wachstum", "Reif", "Geerntet"];
const GROWTH_COLORS = {
  "Saaten": "#8B4513",
  "Keimlinge": "#90EE90",
  "Wachstum": "#3f6b3b",
  "Reif": "#c9a227",
  "Geerntet": "#6c757d",
};

let fpState = {
  plan: null,
  sections: [],
  drawing: false,
  drawPoints: [],
  calibrating: false,
  calibPoints: [],
  selectedSection: null,
  image: null,
  colorIdx: 0,
  lastClickTime: 0,
};

function loadFieldPlans() {
  return adminApi("api/admin/field-plans")
    .then((data) => {
      window.FIELD_PLANS = data.plans || [];
      renderFieldPlanList();
    })
    .catch((err) => {
      showMsg("fieldplanMsg", err.message || "Pläne konnten nicht geladen werden.", "danger");
    });
}

function renderFieldPlanList() {
  const cards = document.getElementById("fieldplanCards");
  const empty = document.getElementById("fieldplanEmpty");
  const plans = window.FIELD_PLANS || [];
  if (!cards) return;
  if (plans.length === 0) {
    if (empty) empty.classList.remove("d-none");
    cards.innerHTML = "";
    return;
  }
  if (empty) empty.classList.add("d-none");
  cards.innerHTML = plans.map((p) => {
    const img = p.image ? "assets/img/" + esc(p.image) : "";
    const dims = p.width_meters && p.height_meters
      ? ' <span class="fp-card-dims d-none">' + esc(String(p.width_meters)) + ' m × ' + esc(String(p.height_meters)) + ' m</span>' +
        '<button class="btn btn-link btn-sm p-0 fp-card-toggle" title="Maße ein/ausblenden"><i class="bi bi-rulers"></i></button>'
      : '';
    return (
      '<div class="col-md-6 col-lg-4">' +
      '<div class="card h-100">' +
      (img
        ? '<img src="' + img + '" class="card-img-top" style="height:160px;object-fit:cover;" alt="' + esc(p.name) + '">'
        : '<div class="card-img-top d-flex align-items-center justify-content-center bg-light" style="height:160px;"><i class="bi bi-image display-4 text-muted"></i></div>') +
      '<div class="card-body">' +
      '<h5 class="card-title">' + esc(p.name) + '</h5>' +
      '<p class="card-text text-muted small mb-2">' + (p.section_count || 0) + ' Bereiche' + dims +
      '</p>' +
      '</div>' +
      '<div class="card-footer d-flex gap-2">' +
      '<button class="btn btn-sm btn-irm fieldplan-edit" data-id="' + p.id + '"><i class="bi bi-pencil"></i> Bearbeiten</button> ' +
      '<button class="btn btn-sm btn-outline-danger fieldplan-delete" data-id="' + p.id + '" data-name="' + esc(p.name) + '"><i class="bi bi-trash"></i></button>' +
      '</div>' +
      '</div></div>'
    );
  }).join("");
  cards.querySelectorAll(".fieldplan-edit").forEach((btn) => {
    btn.addEventListener("click", () => openFieldPlanEditor(parseInt(btn.dataset.id)));
  });
  cards.querySelectorAll(".fieldplan-delete").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (confirm('Plan "' + btn.dataset.name + '" wirklich löschen?')) {
        adminApi("api/admin/field-plans/" + btn.dataset.id, "DELETE")
          .then(() => { showMsg("fieldplanMsg", "Plan gelöscht.", "success"); loadFieldPlans(); })
          .catch((err) => showMsg("fieldplanMsg", err.message, "danger"));
      }
    });
  });
  cards.querySelectorAll(".fp-card-toggle").forEach((btn) => {
    btn.addEventListener("click", () => {
      const span = btn.parentElement.querySelector(".fp-card-dims");
      if (span) span.classList.toggle("d-none");
    });
  });
}

document.addEventListener("DOMContentLoaded", () => {
  const fpCreateBtn = document.getElementById("fieldplanCreateBtn");
  if (fpCreateBtn) {
    fpCreateBtn.addEventListener("click", () => {
      const name = prompt("Name des Anbauplans:");
      if (!name || !name.trim()) return;
      adminApi("api/admin/field-plans", "POST", { name: name.trim() })
        .then((data) => {
          showMsg("fieldplanMsg", "Plan angelegt.", "success");
          openFieldPlanEditor(data.id);
        })
        .catch((err) => showMsg("fieldplanMsg", err.message, "danger"));
    });
  }
  const fpBackBtn = document.getElementById("fieldplanBackBtn");
  if (fpBackBtn) {
    fpBackBtn.addEventListener("click", () => {
      closeFieldEditor();
      loadFieldPlans();
    });
  }
  const fpImageBtn = document.getElementById("fieldplanImageBtn");
  const fpImageInput = document.getElementById("fieldplanImageInput");
  if (fpImageBtn && fpImageInput) {
    fpImageBtn.addEventListener("click", () => fpImageInput.click());
    fpImageInput.addEventListener("change", () => {
      const file = fpImageInput.files && fpImageInput.files[0];
      if (!file || !fpState.plan) return;
      adminUpload("api/admin/field-plans/" + fpState.plan.id + "/image", file)
        .then(() => { showToast("Grundriss hochgeladen."); fpImageInput.value = ""; return reloadFieldPlan(); })
        .catch((err) => showToast(err.message));
    });
  }
  const fpCalibrateBtn = document.getElementById("fieldplanCalibrateBtn");
  if (fpCalibrateBtn) {
    fpCalibrateBtn.addEventListener("click", () => startCalibration());
  }
  const fpDrawBtn = document.getElementById("fieldplanDrawBtn");
  if (fpDrawBtn) {
    fpDrawBtn.addEventListener("click", () => {
      if (fpState.drawing) {
        cancelDrawing();
      } else {
        startDrawing();
      }
    });
  }
});

function openFieldPlanEditor(planId) {
  adminApi("api/admin/field-plans/" + planId)
    .then((data) => {
      fpState.plan = data.plan;
      fpState.sections = data.sections || [];
      fpState.drawing = false;
      fpState.drawPoints = [];
      fpState.calibrating = false;
      fpState.calibPoints = [];
      fpState.selectedSection = null;
      fpState.image = null;
      fpState.colorIdx = 0;
      document.getElementById("fieldplanList").classList.add("d-none");
      document.getElementById("fieldplanEditor").classList.remove("d-none");
      document.getElementById("fieldplanEditorTitle").textContent = data.plan.name;
      showSectionPanel(null);
      renderScalePanel();
      loadFieldImage();
    })
    .catch((err) => showToast(err.message));
}

function closeFieldEditor() {
  fpState.plan = null;
  fpState.sections = [];
  fpState.image = null;
  fpState.drawing = false;
  fpState.calibrating = false;
  fpState.selectedSection = null;
  document.getElementById("fieldplanEditor").classList.add("d-none");
  document.getElementById("fieldplanList").classList.remove("d-none");
  const canvas = document.getElementById("fieldCanvas");
  if (canvas) canvas.classList.add("d-none");
  const noImg = document.getElementById("fieldplanNoImage");
  if (noImg) noImg.classList.remove("d-none");
  const drawBtn = document.getElementById("fieldplanDrawBtn");
  if (drawBtn) {
    drawBtn.innerHTML = '<i class="bi bi-pencil-square"></i> Bereich zeichnen';
    drawBtn.classList.remove("active");
  }
}

function reloadFieldPlan() {
  if (!fpState.plan) return;
  return adminApi("api/admin/field-plans/" + fpState.plan.id)
    .then((data) => {
      fpState.plan = data.plan;
      fpState.sections = data.sections || [];
      loadFieldImage();
    });
}

function loadFieldImage() {
  const canvas = document.getElementById("fieldCanvas");
  const noImg = document.getElementById("fieldplanNoImage");
  if (!fpState.plan || !fpState.plan.image) {
    if (canvas) canvas.classList.add("d-none");
    if (noImg) noImg.classList.remove("d-none");
    return;
  }
  const img = new Image();
  img.onload = () => {
    fpState.image = img;
    if (noImg) noImg.classList.add("d-none");
    if (canvas) canvas.classList.remove("d-none");
    setupCanvas();
    renderFieldCanvas();
  };
  img.onerror = () => {
    if (canvas) canvas.classList.add("d-none");
    if (noImg) noImg.classList.remove("d-none");
  };
  img.src = "/api/field-plans/" + fpState.plan.id + "/image?t=" + Date.now();
}

function setupCanvas() {
  const container = document.getElementById("fieldCanvasContainer");
  const canvas = document.getElementById("fieldCanvas");
  if (!container || !canvas || !fpState.image) return;
  canvas.onclick = onCanvasClick;
  canvas.ondblclick = onCanvasDblClick;
  canvas.onmousemove = onCanvasMouseMove;
  canvas.oncontextmenu = onCanvasContextMenu;
  canvas.style.cursor = fpState.drawing ? "crosshair" : "default";
  const cw = container.clientWidth || 800;
  const ratio = fpState.image.height / fpState.image.width;
  let w = cw;
  let h = Math.round(w * ratio);
  if (h > 600) { h = 600; w = Math.round(h / ratio); }
  canvas.width = w;
  canvas.height = h;
  canvas.style.width = "100%";
  canvas.style.height = "auto";
  renderFieldCanvas();
}

function renderFieldCanvas() {
  const canvas = document.getElementById("fieldCanvas");
  if (!canvas || !fpState.image) return;
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(fpState.image, 0, 0, w, h);

  fpState.sections.forEach((s) => {
    const pts = s.points || [];
    if (pts.length < 3) return;
    ctx.beginPath();
    ctx.moveTo(pts[0].x * w, pts[0].y * h);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x * w, pts[i].y * h);
    ctx.closePath();
    ctx.fillStyle = hexToRGBA(s.color || "#3f6b3b", 0.3);
    ctx.fill();
    ctx.strokeStyle = s.color || "#3f6b3b";
    ctx.lineWidth = fpState.selectedSection === s.id ? 3 : 2;
    ctx.stroke();

    if (pts.length >= 3) {
      const cx = pts.reduce((sum, p) => sum + p.x, 0) / pts.length * w;
      const cy = pts.reduce((sum, p) => sum + p.y, 0) / pts.length * h;
      ctx.fillStyle = "#fff";
      ctx.font = "bold 13px Inter, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const label = s.plant_name || s.name || "";
      if (label) {
        const tw = ctx.measureText(label).width + 10;
        ctx.fillStyle = "rgba(0,0,0,0.55)";
        ctx.fillRect(cx - tw / 2, cy - 10, tw, 20);
        ctx.fillStyle = "#fff";
        ctx.fillText(label, cx, cy);
      }
    }
  });

  if (fpState.drawPoints.length > 0) {
    ctx.beginPath();
    ctx.moveTo(fpState.drawPoints[0].x * w, fpState.drawPoints[0].y * h);
    for (let i = 1; i < fpState.drawPoints.length; i++) {
      ctx.lineTo(fpState.drawPoints[i].x * w, fpState.drawPoints[i].y * h);
    }
    ctx.strokeStyle = "#ff4444";
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
    fpState.drawPoints.forEach((p, idx) => {
      ctx.beginPath();
      ctx.arc(p.x * w, p.y * h, idx === 0 ? 6 : 4, 0, Math.PI * 2);
      ctx.fillStyle = idx === 0 ? "#ff8800" : "#ff4444";
      ctx.fill();
    });
    if (fpState.drawPoints.length >= 3) {
      const first = fpState.drawPoints[0];
      const last = fpState.drawPoints[fpState.drawPoints.length - 1];
      const dx = (last.x - first.x) * w;
      const dy = (last.y - first.y) * h;
      const close = Math.sqrt(dx * dx + dy * dy) < 15;
      ctx.beginPath();
      ctx.arc(first.x * w, first.y * h, 12, 0, Math.PI * 2);
      ctx.strokeStyle = close ? "#00cc00" : "rgba(255,136,0,0.6)";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    const hintY = 20;
    ctx.font = "12px Inter, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    const n = fpState.drawPoints.length;
    let hint = n + " Punkt" + (n !== 1 ? "e" : "") + " · Doppelklick = fertig · Rechtsklick/Backspace = rückgängig · Esc = abbrechen";
    if (n >= 3) hint = n + " Punkte · Auf ersten Punkt klicken = schließen · Enter = fertig · Rechtsklick/Backspace = rückgängig";
    const tw = ctx.measureText(hint).width + 12;
    ctx.fillStyle = "rgba(0,0,0,0.7)";
    ctx.fillRect(4, hintY - 2, tw, 20);
    ctx.fillStyle = "#fff";
    ctx.fillText(hint, 10, hintY);
  }

  drawDimensions(ctx, w, h);
}

function drawDimensions(ctx, w, h) {
  fpState.sections.forEach((s) => {
    const pts = s.points || [];
    if (pts.length < 2) return;
    const ppm = getPixelsPerMeter();
    if (!ppm) return;
    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length;
      const x1 = pts[i].x * w, y1 = pts[i].y * h;
      const x2 = pts[j].x * w, y2 = pts[j].y * h;
      const pxLen = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
      const mLen = pxLen / ppm;
      if (mLen < 0.3) continue;
      const mx = (x1 + x2) / 2;
      const my = (y1 + y2) / 2;
      const angle = Math.atan2(y2 - y1, x2 - x1);
      ctx.save();
      ctx.translate(mx, my);
      let rot = angle;
      if (rot > Math.PI / 2) rot -= Math.PI;
      if (rot < -Math.PI / 2) rot += Math.PI;
      ctx.rotate(rot);
      const text = mLen.toFixed(2) + " m";
      ctx.font = "bold 11px Inter, sans-serif";
      const tw = ctx.measureText(text).width + 6;
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.fillRect(-tw / 2, -9, tw, 18);
      ctx.fillStyle = "#2b2b2b";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(text, 0, 0);
      ctx.restore();
    }
  });
}

function getPixelsPerMeter() {
  const canvas = document.getElementById("fieldCanvas");
  if (!canvas || !fpState.plan) return null;
  const p = fpState.plan;
  if (p.width_meters && p.height_meters && p.width_meters > 0 && p.height_meters > 0) {
    return canvas.width / p.width_meters;
  }
  if (p.calibration_x1 != null && p.calibration_x2 != null && p.calibration_meters && p.calibration_meters > 0) {
    const dx = (p.calibration_x2 - p.calibration_x1) * canvas.width;
    const dy = (p.calibration_y2 - p.calibration_y1) * canvas.height;
    const pxLen = Math.sqrt(dx * dx + dy * dy);
    return pxLen / p.calibration_meters;
  }
  return null;
}

function hexToRGBA(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return "rgba(" + r + "," + g + "," + b + "," + alpha + ")";
}

// ---- drawing

function startDrawing() {
  fpState.drawing = true;
  fpState.drawPoints = [];
  fpState.calibrating = false;
  fpState.calibPoints = [];
  fpState.selectedSection = null;
  showSectionPanel(null);
  const canvas = document.getElementById("fieldCanvas");
  if (canvas) canvas.style.cursor = "crosshair";
  const drawBtn = document.getElementById("fieldplanDrawBtn");
  if (drawBtn) {
    drawBtn.innerHTML = '<i class="bi bi-x-lg"></i> Abbrechen';
    drawBtn.classList.add("active");
  }
  document.addEventListener("keydown", onDrawKeydown);
  renderFieldCanvas();
}

function cancelDrawing() {
  fpState.drawing = false;
  fpState.drawPoints = [];
  const canvas = document.getElementById("fieldCanvas");
  if (canvas) canvas.style.cursor = "default";
  const drawBtn = document.getElementById("fieldplanDrawBtn");
  if (drawBtn) {
    drawBtn.innerHTML = '<i class="bi bi-pencil-square"></i> Bereich zeichnen';
    drawBtn.classList.remove("active");
  }
  document.removeEventListener("keydown", onDrawKeydown);
  renderFieldCanvas();
}

function onCanvasClick(e) {
  if (e.button === 2) return;
  const now = Date.now();
  if (now - fpState.lastClickTime < 300) return;
  fpState.lastClickTime = now;
  const canvas = e.target;
  const rect = canvas.getBoundingClientRect();
  const x = (e.clientX - rect.left) / rect.width;
  const y = (e.clientY - rect.top) / rect.height;

  if (fpState.calibrating) {
    fpState.calibPoints.push({ x, y });
    if (fpState.calibPoints.length === 2) {
      finishCalibration();
    }
    renderFieldCanvas();
    drawCalibLine();
    return;
  }

  if (fpState.drawing) {
    if (fpState.drawPoints.length >= 3) {
      const first = fpState.drawPoints[0];
      const dx = (x - first.x) * rect.width;
      const dy = (y - first.y) * rect.height;
      if (Math.sqrt(dx * dx + dy * dy) < 15) {
        finishDrawing();
        return;
      }
    }
    fpState.drawPoints.push({ x, y });
    renderFieldCanvas();
    return;
  }

  let hit = null;
  for (let i = fpState.sections.length - 1; i >= 0; i--) {
    if (pointInPolygon({ x, y }, fpState.sections[i].points || [])) {
      hit = fpState.sections[i];
      break;
    }
  }
  fpState.selectedSection = hit ? hit.id : null;
  showSectionPanel(hit);
  renderFieldCanvas();
}

function onCanvasDblClick(e) {
  if (!fpState.drawing || fpState.drawPoints.length < 3) return;
  e.preventDefault();
  finishDrawing();
}

function finishDrawing() {
  if (!fpState.drawing || fpState.drawPoints.length < 3) return;
  const points = fpState.drawPoints.slice();
  cancelDrawing();
  const color = FIELD_COLORS[fpState.colorIdx % FIELD_COLORS.length];
  fpState.colorIdx++;
  const payload = {
    name: "",
    points: points,
    color: color,
    growth_stage: "Saaten",
  };
  adminApi("api/admin/field-plans/" + fpState.plan.id + "/sections", "POST", payload)
    .then((data) => {
      showToast("Bereich angelegt.");
      return reloadFieldPlan();
    })
    .then(() => {
      const newSec = fpState.sections.find((s) => s.points_json === JSON.stringify(points));
      if (newSec) {
        fpState.selectedSection = newSec.id;
        showSectionPanel(newSec);
        renderFieldCanvas();
      }
    })
    .catch((err) => showToast(err.message));
}

function undoDrawPoint() {
  if (!fpState.drawing || fpState.drawPoints.length === 0) return;
  fpState.drawPoints.pop();
  renderFieldCanvas();
}

function onDrawKeydown(e) {
  if (!fpState.drawing) return;
  if (e.key === "Escape") {
    cancelDrawing();
  } else if (e.key === "Backspace" || e.key === "Delete" || (e.ctrlKey && e.key === "z")) {
    e.preventDefault();
    undoDrawPoint();
  } else if (e.key === "Enter" && fpState.drawPoints.length >= 3) {
    finishDrawing();
  }
}

function onCanvasContextMenu(e) {
  e.preventDefault();
  if (fpState.drawing) {
    undoDrawPoint();
  }
}

function onCanvasMouseMove(e) {
  if (!fpState.drawing) return;
  const canvas = e.target;
  const rect = canvas.getBoundingClientRect();
  const mx = (e.clientX - rect.left) / rect.width;
  const my = (e.clientY - rect.top) / rect.height;
  renderFieldCanvas();
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  if (fpState.drawPoints.length > 0) {
    const last = fpState.drawPoints[fpState.drawPoints.length - 1];
    ctx.beginPath();
    ctx.moveTo(last.x * w, last.y * h);
    ctx.lineTo(mx * w, my * h);
    ctx.strokeStyle = "rgba(255,68,68,0.5)";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

function pointInPolygon(pt, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    if (((yi > pt.y) !== (yj > pt.y)) && (pt.x < (xj - xi) * (pt.y - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

// ---- calibration

function startCalibration() {
  if (!fpState.image) { showToast("Bitte zuerst einen Grundriss hochladen."); return; }
  fpState.calibrating = true;
  fpState.calibPoints = [];
  fpState.drawing = false;
  fpState.drawPoints = [];
  const canvas = document.getElementById("fieldCanvas");
  if (canvas) canvas.style.cursor = "crosshair";
  showToast("Zwei Punkte auf dem Bild klicken und dann den Abstand eingeben.");
  renderFieldCanvas();
}

function drawCalibLine() {
  const canvas = document.getElementById("fieldCanvas");
  if (!canvas || fpState.calibPoints.length === 0) return;
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  fpState.calibPoints.forEach((p) => {
    ctx.beginPath();
    ctx.arc(p.x * w, p.y * h, 5, 0, Math.PI * 2);
    ctx.fillStyle = "#ff8800";
    ctx.fill();
  });
  if (fpState.calibPoints.length === 2) {
    const [a, b] = fpState.calibPoints;
    ctx.beginPath();
    ctx.moveTo(a.x * w, a.y * h);
    ctx.lineTo(b.x * w, b.y * h);
    ctx.strokeStyle = "#ff8800";
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

function finishCalibration() {
  fpState.calibrating = false;
  const canvas = document.getElementById("fieldCanvas");
  if (canvas) canvas.style.cursor = "default";
  const meters = prompt("Wie lang ist die Strecke zwischen den beiden Punkten (in Metern)?");
  if (!meters || isNaN(parseFloat(meters)) || parseFloat(meters) <= 0) {
    fpState.calibPoints = [];
    renderFieldCanvas();
    return;
  }
  const [a, b] = fpState.calibPoints;
  adminApi("api/admin/field-plans/" + fpState.plan.id + "/calibrate", "POST", {
    x1: a.x, y1: a.y, x2: b.x, y2: b.y, meters: parseFloat(meters),
  })
    .then(() => { showToast("Kalibrierung gespeichert."); return reloadFieldPlan(); })
    .catch((err) => showToast(err.message));
  fpState.calibPoints = [];
  renderFieldCanvas();
}

function renderScalePanel() {
  const body = document.getElementById("fieldScaleBody");
  if (!body || !fpState.plan) return;
  const p = fpState.plan;
  const hasManual = p.width_meters && p.height_meters;
  const hasCalib = p.calibration_x1 != null && p.calibration_meters;
  let html = "";
  if (hasManual) {
    html += '<p class="small mb-2"><strong>Manuell:</strong> ' + p.width_meters + ' m × ' + p.height_meters + ' m</p>';
  } else if (hasCalib) {
    html += '<p class="small mb-2"><strong>Kalibriert:</strong> ' + p.calibration_meters + ' m Referenzlinie</p>';
  }
  html += '<hr class="my-2">';
  html += '<p class="small text-muted mb-2">Manuelle Skalierung:</p>';
  html += '<div class="row g-2 mb-2">';
  html += '<div class="col-6"><input type="number" min="0.1" step="0.1" class="form-control form-control-sm" id="fpScaleW" placeholder="Breite (m)" value="' + (hasManual ? p.width_meters : '') + '"></div>';
  html += '<div class="col-6"><input type="number" min="0.1" step="0.1" class="form-control form-control-sm" id="fpScaleH" placeholder="Höhe (m)" value="' + (hasManual ? p.height_meters : '') + '"></div>';
  html += '</div>';
  html += '<button class="btn btn-sm btn-outline-irm w-100 mb-2" id="fpScaleApply">Anwenden</button>';
  if (hasManual || hasCalib) {
    html += '<button class="btn btn-sm btn-outline-danger w-100" id="fpScaleClear">Kalibrierung entfernen</button>';
  }
  body.innerHTML = html;
  const applyBtn = document.getElementById("fpScaleApply");
  if (applyBtn) {
    applyBtn.addEventListener("click", () => {
      const w = parseFloat(document.getElementById("fpScaleW").value);
      const h = parseFloat(document.getElementById("fpScaleH").value);
      if (!w || !h || w <= 0 || h <= 0) { showToast("Bitte Breite und Höhe > 0 eingeben."); return; }
      adminApi("api/admin/field-plans/" + fpState.plan.id + "/calibrate", "POST", { width_meters: w, height_meters: h })
        .then(() => { showToast("Skalierung gespeichert."); return reloadFieldPlan(); })
        .then(renderScalePanel)
        .catch((err) => showToast(err.message));
    });
  }
  const clearBtn = document.getElementById("fpScaleClear");
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      adminApi("api/admin/field-plans/" + fpState.plan.id + "/calibrate", "POST", { width_meters: null, height_meters: null })
        .then(() => { showToast("Kalibrierung entfernt."); return reloadFieldPlan(); })
        .then(renderScalePanel)
        .catch((err) => showToast(err.message));
    });
  }
}

// ---- section properties panel

function showSectionPanel(section) {
  const body = document.getElementById("fieldSectionBody");
  if (!body) return;
  if (!section) {
    body.innerHTML = '<p class="text-muted small mb-0">Zeichnen Sie einen Bereich auf dem Grundriss, oder klicken Sie auf einen bestehenden Bereich.</p>';
    return;
  }
  const growthOptions = GROWTH_STAGES.map(
    (g) => '<option value="' + g + '"' + (g === section.growth_stage ? " selected" : "") + '>' + g + '</option>'
  ).join("");
  body.innerHTML =
    '<div class="mb-2">' +
    '<label class="form-label small">Name</label>' +
    '<input type="text" class="form-control form-control-sm" id="fsName" value="' + esc(section.name || '') + '">' +
    '</div>' +
    '<div class="mb-2">' +
    '<label class="form-label small">Pflanze</label>' +
    '<input type="text" class="form-control form-control-sm" id="fsPlant" value="' + esc(section.plant_name || '') + '" placeholder="z.B. Salbei">' +
    '</div>' +
    '<div class="mb-2">' +
    '<label class="form-label small">Sorte</label>' +
    '<input type="text" class="form-control form-control-sm" id="fsVariety" value="' + esc(section.plant_variety || '') + '" placeholder="z.B. Bergsalbei">' +
    '</div>' +
    '<div class="row g-2 mb-2">' +
    '<div class="col-6">' +
    '<label class="form-label small">Pflanzdatum</label>' +
    '<input type="date" class="form-control form-control-sm" id="fsPlantDate" value="' + (section.planting_date || '') + '">' +
    '</div>' +
    '<div class="col-6">' +
    '<label class="form-label small">Ernte erwartet</label>' +
    '<input type="date" class="form-control form-control-sm" id="fsHarvest" value="' + (section.expected_harvest || '') + '">' +
    '</div>' +
    '</div>' +
    '<div class="mb-2">' +
    '<label class="form-label small">Wachstumsphase</label>' +
    '<select class="form-select form-select-sm" id="fsStage">' + growthOptions + '</select>' +
    '</div>' +
    '<div class="mb-2">' +
    '<label class="form-label small">Bewässerung</label>' +
    '<input type="text" class="form-control form-control-sm" id="fsWater" value="' + esc(section.watering_schedule || '') + '" placeholder="z.B. Jeden 2. Tag">' +
    '</div>' +
    '<div class="mb-2">' +
    '<label class="form-label small">Notizen</label>' +
    '<textarea class="form-control form-control-sm" id="fsNotes" rows="2">' + esc(section.notes || '') + '</textarea>' +
    '</div>' +
    '<div class="mb-2">' +
    '<label class="form-label small">Farbe</label>' +
    '<input type="color" class="form-control form-control-sm form-control-color" id="fsColor" value="' + (section.color || '#3f6b3b') + '">' +
    '</div>' +
    '<div class="d-flex gap-2">' +
    '<button class="btn btn-sm btn-irm flex-grow-1" id="fsSave"><i class="bi bi-check-lg"></i> Speichern</button>' +
    '<button class="btn btn-sm btn-outline-danger" id="fsDelete" title="Löschen"><i class="bi bi-trash"></i></button>' +
    '</div>';
  document.getElementById("fsSave").addEventListener("click", () => saveSection(section.id));
  document.getElementById("fsDelete").addEventListener("click", () => {
    if (!confirm("Bereich wirklich löschen?")) return;
    adminApi("api/admin/field-plans/" + fpState.plan.id + "/sections/" + section.id, "DELETE")
      .then(() => { showToast("Bereich gelöscht."); fpState.selectedSection = null; showSectionPanel(null); return reloadFieldPlan(); })
      .catch((err) => showToast(err.message));
  });
}

function saveSection(sectionId) {
  const data = {
    name: document.getElementById("fsName").value.trim(),
    plant_name: document.getElementById("fsPlant").value.trim(),
    plant_variety: document.getElementById("fsVariety").value.trim(),
    planting_date: document.getElementById("fsPlantDate").value || null,
    expected_harvest: document.getElementById("fsHarvest").value || null,
    growth_stage: document.getElementById("fsStage").value,
    watering_schedule: document.getElementById("fsWater").value.trim(),
    notes: document.getElementById("fsNotes").value.trim(),
    color: document.getElementById("fsColor").value,
  };
  adminApi("api/admin/field-plans/" + fpState.plan.id + "/sections/" + sectionId, "PUT", data)
    .then(() => { showToast("Bereich gespeichert."); return reloadFieldPlan(); })
    .then(() => renderFieldCanvas())
    .catch((err) => showToast(err.message));
}
