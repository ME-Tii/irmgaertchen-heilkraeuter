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

function adminDownloadFile(path, filename) {
  const token = localStorage.getItem(ADMIN_TOKEN_KEY);
  const headers = {};
  if (token) headers["Authorization"] = "Bearer " + token;
  fetch(path, { headers }).then(function(r) {
    if (!r.ok) { r.json().then(function(d) { alert(d.error || "Fehler"); }).catch(function() { alert("Fehler"); }); return; }
    return r.blob();
  }).then(function(blob) {
    if (!blob) return;
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });
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
  const customersPanel = document.getElementById("customersPanel");
  const inventory = document.getElementById("inventory");
  const messagesPanel = document.getElementById("messagesPanel");
  const statsPanel = document.getElementById("statsPanel");
  const fieldplanPanel = document.getElementById("fieldplanPanel");
  const backupPanel = document.getElementById("backupPanel");
  const couponsPanel = document.getElementById("couponsPanel");
  const emailsPanel = document.getElementById("emailsPanel");
  if (ordersPanel) ordersPanel.classList.toggle("d-none", tab !== "orders");
  if (customersPanel) customersPanel.classList.toggle("d-none", tab !== "customers");
  if (inventory) inventory.classList.toggle("d-none", tab !== "inventory");
  if (messagesPanel) messagesPanel.classList.toggle("d-none", tab !== "messages");
  if (statsPanel) statsPanel.classList.toggle("d-none", tab !== "stats");
  if (fieldplanPanel) fieldplanPanel.classList.toggle("d-none", tab !== "fieldplan");
  if (backupPanel) backupPanel.classList.toggle("d-none", tab !== "backup");
  if (couponsPanel) couponsPanel.classList.toggle("d-none", tab !== "coupons");
  if (emailsPanel) emailsPanel.classList.toggle("d-none", tab !== "emails");
  try {
    if (tab === "customers") loadCustomers();
    if (tab === "inventory") renderInventory();
    if (tab === "messages") renderMessages();
    if (tab === "stats") loadStats();
    if (tab === "fieldplan") loadFieldPlans();
    if (tab === "coupons") renderCoupons();
    if (tab === "emails") loadEmailTemplates();
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
        '<button class="btn btn-sm btn-outline-primary me-1 invoice-download" data-order="' + esc(o.order_no) + '" title="Rechnung herunterladen"><i class="bi bi-file-earmark-pdf"></i></button>' +
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
  body.querySelectorAll(".invoice-download").forEach((btn) => {
    btn.addEventListener("click", () => {
      adminDownloadFile("/api/admin/orders/" + encodeURIComponent(btn.dataset.order) + "/invoice", "Rechnung-" + btn.dataset.order + ".pdf");
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

// ---- Phase 2: Total area summary

function computeTotalArea() {
  const canvas = document.getElementById("fieldCanvas");
  if (!canvas || !fpState.sections.length) return null;
  const ppm = getPixelsPerMeter();
  if (!ppm) return null;
  let total = 0;
  fpState.sections.forEach(function(s) {
    const pts = s.points || [];
    if (pts.length < 3) return;
    let area = 0;
    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length;
      area += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
    }
    total += Math.abs(area) / 2 * canvas.width * canvas.height / (ppm * ppm);
  });
  return total;
}

function getDisplayName(section, allSections) {
  var base = section.plant_name || section.name || "Bereich";
  var hasDuplicate = allSections.some(function(s) {
    return s.id !== section.id && (s.plant_name || s.name || "") === (section.plant_name || section.name || "");
  });
  if (!hasDuplicate) return base;
  var counter = 1;
  var seen = [];
  for (var i = 0; i < allSections.length; i++) {
    var s = allSections[i];
    var sLabel = s.plant_name || s.name || "";
    if (sLabel === (section.plant_name || section.name || "")) {
      seen.push(s);
      if (s.id === section.id) break;
    }
  }
  return base + " " + seen.length + ".";
}

function renderPlanSummary() {
  const el = document.getElementById("fieldplanSummary");
  if (!el) return;
  const total = computeTotalArea();
  const count = fpState.sections.length;
  if (!total && count === 0) {
    el.innerHTML = "";
    return;
  }
  let html = '<span class="me-3"><i class="bi bi-grid-3x3"></i> ' + count + ' Bereich' + (count !== 1 ? "e" : "") + '</span>';
  if (total) html += '<span class="me-3"><i class="bi bi-aspect-ratio"></i> Gesamtfläche: ' + total.toFixed(2) + ' m²</span>';
  let totalYield = 0;
  let totalProfit = 0;
  fpState.sections.forEach(function(s) {
    var ykg = YIELD_KG_PER_M2[s.plant_name];
    if (ykg && s.points && s.points.length >= 3) {
      var dims = computeSectionDims(s);
      if (dims) {
        var kg = ykg * parseFloat(dims.area);
        totalYield += kg;
        var price = getPriceForPlant(s.plant_name);
        if (price) totalProfit += kg * price;
      }
    }
  });
  if (totalYield > 0) html += '<span class="me-3"><i class="bi bi-basket"></i> Ertrag: ~' + totalYield.toFixed(1) + ' kg</span>';
  if (totalProfit > 0) html += '<span><i class="bi bi-cash-coin"></i> Umsatz: ~' + totalProfit.toFixed(0) + ' €</span>';
  el.innerHTML = html;
}

// ---- Phase 3: Companion planting (incompatible lines on canvas)

function drawIncompatibleLines(ctx, w, h) {
  fpState.sections.forEach(function(s1) {
    const e1 = getCatalogForDatalist().find(function(c) { return c.name === (s1.plant_name || ""); });
    if (!e1) return;
    fpState.sections.forEach(function(s2) {
      if (s2.id <= s1.id) return;
      const e2 = getCatalogForDatalist().find(function(c) { return c.name === (s2.plant_name || ""); });
      if (!e2) return;
      if (e1.incompatible.indexOf(s2.plant_name) === -1 && e2.incompatible.indexOf(s1.plant_name) === -1) return;
      const pts1 = s1.points || [];
      const pts2 = s2.points || [];
      if (pts1.length < 3 || pts2.length < 3) return;
      const cx1 = pts1.reduce(function(s, p) { return s + p.x; }, 0) / pts1.length * w;
      const cy1 = pts1.reduce(function(s, p) { return s + p.y; }, 0) / pts1.length * h;
      const cx2 = pts2.reduce(function(s, p) { return s + p.x; }, 0) / pts2.length * w;
      const cy2 = pts2.reduce(function(s, p) { return s + p.y; }, 0) / pts2.length * h;
      ctx.beginPath();
      ctx.moveTo(cx1, cy1);
      ctx.lineTo(cx2, cy2);
      ctx.strokeStyle = "rgba(220,53,69,0.6)";
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc((cx1 + cx2) / 2, (cy1 + cy2) / 2, 10, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(220,53,69,0.85)";
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.font = "bold 12px Inter, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("!", (cx1 + cx2) / 2, (cy1 + cy2) / 2);
    });
  });
}

// ---- Phase 4: Seasonal timeline

function renderTimeline() {
  const el = document.getElementById("fieldTimeline");
  if (!el) return;
  const items = [];
  fpState.sections.forEach(function(s) {
    if (!s.planting_date && !s.expected_harvest) return;
    items.push({
      name: getDisplayName(s, fpState.sections),
      start: s.planting_date || null,
      end: s.expected_harvest || null,
      color: s.color || "#3f6b3b"
    });
  });
  if (items.length === 0) {
    el.innerHTML = '<p class="text-muted small mb-0">Fügen Sie Pflanz- und Erntedaten hinzu, um den Zeitplan anzuzeigen.</p>';
    return;
  }
  let minDate = null;
  let maxDate = null;
  items.forEach(function(it) {
    if (it.start) { var d = new Date(it.start); if (!minDate || d < minDate) minDate = d; }
    if (it.end) { var d2 = new Date(it.end); if (!maxDate || d2 > maxDate) maxDate = d2; }
  });
  if (!minDate) minDate = new Date();
  if (!maxDate) maxDate = new Date(minDate);
  if (minDate.getTime() === maxDate.getTime()) {
    maxDate = new Date(minDate);
    maxDate.setMonth(maxDate.getMonth() + 3);
  }
  var range = maxDate.getTime() - minDate.getTime();
  if (range <= 0) range = 90 * 24 * 3600 * 1000;
  var months = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
  var headerHtml = '<div class="d-flex justify-content-between small text-muted mb-1">';
  var m0 = minDate.getMonth();
  for (var mi = 0; mi <= 6; mi++) {
    var mIdx = (m0 + mi) % 12;
    headerHtml += '<span>' + months[mIdx] + '</span>';
  }
  headerHtml += '</div>';
  var barsHtml = '';
  items.forEach(function(it) {
    var s = it.start ? new Date(it.start) : minDate;
    var e = it.end ? new Date(it.end) : new Date(s.getTime() + 60 * 24 * 3600 * 1000);
    var left = Math.max(0, (s.getTime() - minDate.getTime()) / range * 100);
    var width = Math.max(2, (e.getTime() - s.getTime()) / range * 100);
    if (left + width > 100) width = 100 - left;
    barsHtml += '<div class="position-relative mb-1" style="height:24px;">' +
      '<div class="position-absolute rounded" style="left:' + left + '%;width:' + width + '%;top:2px;height:20px;background:' + esc(it.color) + ';opacity:0.85;"></div>' +
      '<span class="position-absolute small text-truncate" style="left:' + Math.max(0, left + 0.5) + '%;top:3px;line-height:18px;max-width:' + Math.max(5, width - 1) + '%;color:#fff;padding-left:4px;font-weight:500;">' + esc(it.name) + '</span>' +
      '</div>';
  });
  el.innerHTML = headerHtml + barsHtml;
}

// ---- Phase 5: Watering calendar

var WATERING_FREQ = {
  "trocken halten": 7,
  "trocken bis mäßig": 5,
  "mäßig feucht": 3,
  "gleichmäßig feucht": 2,
  "feucht halten": 1,
  "regelmäßig feucht halten": 1,
  "regelmäßig feucht": 1
};

function getWateringFrequencyDays(section) {
  if (section.watering_interval && section.watering_interval > 0) return section.watering_interval;
  var s = (section.watering_schedule || "").toLowerCase().trim();
  for (var key in WATERING_FREQ) {
    if (s.indexOf(key) !== -1) return WATERING_FREQ[key];
  }
  var entry = getCatalogForDatalist().find(function(c) { return c.name === (section.plant_name || ""); });
  if (entry) {
    var ws = (entry.watering || "").toLowerCase();
    for (var k2 in WATERING_FREQ) {
      if (ws.indexOf(k2) !== -1) return WATERING_FREQ[k2];
    }
  }
  return 0;
}

function getNextWateringDate(section) {
  var freq = getWateringFrequencyDays(section);
  if (freq <= 0) return null;
  var last = section.watering_last ? new Date(section.watering_last + "T00:00:00") : null;
  if (!last) return new Date();
  var next = new Date(last);
  next.setDate(next.getDate() + freq);
  return next;
}

function renderWateringCalendar() {
  var el = document.getElementById("fieldWateringBody");
  if (!el) return;
  var sections = fpState.sections || [];
  var today = new Date();
  today.setHours(0, 0, 0, 0);
  var days = [];
  var dayNames = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
  for (var d = 0; d < 7; d++) {
    var dt = new Date(today);
    dt.setDate(dt.getDate() + d);
    days.push({ date: dt, label: (d === 0 ? "Heute" : dayNames[dt.getDay()] + " " + dt.getDate() + "." + (dt.getMonth() + 1)), sections: [] });
  }
  sections.forEach(function(s) {
    var next = getNextWateringDate(s);
    if (!next) return;
    next.setHours(0, 0, 0, 0);
    var name = getDisplayName(s, fpState.sections);
    for (var i = 0; i < days.length; i++) {
      var diff = Math.round((days[i].date.getTime() - next.getTime()) / 86400000);
      var freq = getWateringFrequencyDays(s);
      if (freq > 0 && diff >= 0 && diff % freq === 0) {
        days[i].sections.push({ id: s.id, name: name, color: s.color || "#3f6b3b", auto: !!s.watering_auto });
      }
    }
  });
  var hasAny = days.some(function(d) { return d.sections.length > 0; });
  if (!hasAny) {
    el.innerHTML = '<p class="text-muted small mb-0 p-3">Fügen Sie Pflanzen mit Gießplan hinzu, um den Gießkalender anzuzeigen.</p>';
    return;
  }
  var html = '<div class="d-flex flex-column" style="max-height:300px;overflow-y:auto;">';
  days.forEach(function(d) {
    html += '<div class="d-flex align-items-start border-bottom px-3 py-2' + (d.date.getTime() === today.getTime() ? ' bg-irm bg-opacity-10' : '') + '">';
    html += '<div style="min-width:80px;" class="fw-bold small' + (d.date.getTime() === today.getTime() ? ' text-irm' : ' text-muted') + '">' + esc(d.label) + '</div>';
    html += '<div class="d-flex flex-wrap gap-1">';
    if (d.sections.length === 0) {
      html += '<span class="text-muted small">—</span>';
    } else {
      d.sections.forEach(function(sec) {
        if (sec.auto) {
          html += '<span class="badge d-flex align-items-center gap-1" style="background:' + esc(sec.color) + ';color:#fff;font-weight:500;opacity:0.65;border:1px dashed rgba(255,255,255,0.5);">' + esc(sec.name) + ' <i class="bi bi-magic" style="font-size:0.65rem;" title="Automatische Bewässerung"></i></span>';
        } else {
          html += '<span class="badge d-flex align-items-center gap-1" style="background:' + esc(sec.color) + ';color:#fff;font-weight:500;">' + esc(sec.name);
          html += '<button class="btn btn-sm p-0 border-0 bg-transparent text-white lh-1 water-mark-btn" data-id="' + sec.id + '" title="Als gegossen markieren" style="font-size:0.7rem;">&#10003;</button>';
          html += '</span>';
        }
      });
    }
    html += '</div></div>';
  });
  html += '</div>';
  el.innerHTML = html;
  el.querySelectorAll(".water-mark-btn").forEach(function(btn) {
    btn.addEventListener("click", function(e) {
      e.stopPropagation();
      var sectionId = parseInt(btn.dataset.id);
      adminApi("api/admin/field-plans/" + fpState.plan.id + "/sections/" + sectionId + "/water", "POST")
        .then(function() { return reloadFieldPlan(); })
        .then(function() { renderWateringCalendar(); })
        .catch(function(err) { showToast(err.message); });
    });
  });
}

// ---- Phase 6: Plant catalog management

function loadPlantCatalogForAdmin() {
  var el = document.getElementById("fieldPlantCatalogBody");
  if (!el) return;
  adminApi("api/admin/plant-catalog")
    .then(function(data) {
      var plants = data.plants || [];
      window._lastPlantCatalog = plants;
      renderPlantCatalogList(plants);
      var searchEl = document.getElementById("plantCatalogSearch");
      if (searchEl && !searchEl._bound) {
        searchEl._bound = true;
        searchEl.addEventListener("input", function() {
          var q = searchEl.value.toLowerCase();
          var filtered = plants.filter(function(p) { return p.name.toLowerCase().indexOf(q) !== -1 || p.category.toLowerCase().indexOf(q) !== -1; });
          renderPlantCatalogList(filtered);
        });
      }
    })
    .catch(function(err) { el.innerHTML = '<p class="text-danger small mb-0 p-3">' + esc(err.message) + '</p>'; });
}

function renderPlantCatalogList(plants) {
  var el = document.getElementById("fieldPlantCatalogBody");
  if (!el) return;
  if (plants.length === 0) {
    el.innerHTML = '<p class="text-muted small mb-0 p-3">Keine Pflanzen gefunden.</p>';
    return;
  }
  var cats = {};
  plants.forEach(function(p) {
    if (!cats[p.category]) cats[p.category] = [];
    cats[p.category].push(p);
  });
  var html = '';
  Object.keys(cats).sort().forEach(function(cat) {
    html += '<div class="px-3 pt-2 pb-1 fw-bold small text-muted">' + esc(cat) + '</div>';
    cats[cat].forEach(function(p) {
      html += '<div class="d-flex align-items-center justify-content-between px-3 py-1 border-bottom">';
      html += '<div class="small"><strong>' + esc(p.name) + '</strong>';
      if (p.yield_kg) html += ' <span class="text-muted">~' + p.yield_kg + ' kg/m²</span>';
      if (p.price_per_kg) html += ' <span class="text-muted">' + p.price_per_kg + ' €/kg</span>';
      html += '</div>';
      html += '<div class="d-flex gap-1">';
      html += '<button class="btn btn-sm p-0 border-0 text-irm plant-cat-edit" data-id="' + p.id + '" title="Bearbeiten"><i class="bi bi-pencil"></i></button>';
      html += '<button class="btn btn-sm p-0 border-0 text-danger plant-cat-delete" data-id="' + p.id + '" data-name="' + esc(p.name) + '" title="Löschen"><i class="bi bi-trash"></i></button>';
      html += '</div></div>';
    });
  });
  el.innerHTML = html;
  el.querySelectorAll(".plant-cat-edit").forEach(function(btn) {
    btn.addEventListener("click", function() { openPlantCatalogModal(parseInt(btn.dataset.id)); });
  });
  el.querySelectorAll(".plant-cat-delete").forEach(function(btn) {
    btn.addEventListener("click", function() {
      if (!confirm('Pflanze "' + btn.dataset.name + '" wirklich löschen?')) return;
      adminApi("api/admin/plant-catalog/" + btn.dataset.id, "DELETE")
        .then(function() { showToast("Gelöscht."); loadPlantCatalogForAdmin(); loadPlantCatalog(); })
        .catch(function(err) { showToast(err.message); });
    });
  });
}

function openPlantCatalogModal(entryId) {
  var isEdit = !!entryId;
  var entry = null;
  var doOpen = function(e) {
    entry = e;
    var title = document.getElementById("pcModalLabel");
    if (title) title.textContent = isEdit ? "Pflanze bearbeiten" : "Pflanze hinzufügen";
    document.getElementById("pcName").value = entry ? entry.name : "";
    document.getElementById("pcCategory").value = entry ? entry.category : "Küchenkräuter";
    document.getElementById("pcWatering").value = entry ? entry.watering : "";
    document.getElementById("pcYield").value = entry ? (entry.yield_kg || "") : "";
    document.getElementById("pcPrice").value = entry ? (entry.price_per_kg || "") : "";
    document.getElementById("pcCompanions").value = entry ? (entry.companions || []).join(", ") : "";
    document.getElementById("pcIncompatible").value = entry ? (entry.incompatible || []).join(", ") : "";
    document.getElementById("pcEntryId").value = entryId || "";
    bootstrap.Modal.getOrCreateInstance(document.getElementById("plantCatalogModal")).show();
  };
  if (isEdit) {
    adminApi("api/admin/plant-catalog/" + entryId).then(function(d) { doOpen(d.plant || d); });
  } else {
    doOpen(null);
  }
}

function savePlantCatalogEntry() {
  var entryId = document.getElementById("pcEntryId").value;
  var data = {
    name: document.getElementById("pcName").value.trim(),
    category: document.getElementById("pcCategory").value.trim(),
    watering: document.getElementById("pcWatering").value.trim(),
    yield_kg: parseFloat(document.getElementById("pcYield").value) || null,
    price_per_kg: parseFloat(document.getElementById("pcPrice").value) || null,
    companions: document.getElementById("pcCompanions").value.split(",").map(function(s) { return s.trim(); }).filter(Boolean),
    incompatible: document.getElementById("pcIncompatible").value.split(",").map(function(s) { return s.trim(); }).filter(Boolean),
  };
  if (!data.name) { showToast("Name ist erforderlich."); return; }
  var url = entryId ? "api/admin/plant-catalog/" + entryId : "api/admin/plant-catalog";
  var method = entryId ? "PUT" : "POST";
  adminApi(url, method, data)
    .then(function() {
      bootstrap.Modal.getInstance(document.getElementById("plantCatalogModal")).hide();
      showToast(entryId ? "Gespeichert." : "Hinzugefügt.");
      loadPlantCatalogForAdmin();
      loadPlantCatalog();
    })
    .catch(function(err) { showToast(err.message); });
}

function loadPlantCatalog() {
  return fetch("/api/field-plans/plant-catalog").then(function(r) { return r.json(); }).then(function(data) {
    window.PLANT_CATALOG_DB = data.plants || [];
  }).catch(function() {
    window.PLANT_CATALOG_DB = [];
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

var PLANT_CATALOG = [
  { name: "Basilikum", category: "Küchenkräuter", watering: "Regelmäßig feucht halten", companions: ["Tomaten", "Paprika", "Chili"], incompatible: ["Salbei", "Rauten"] },
  { name: "Petersilie", category: "Küchenkräuter", watering: "Gleichmäßig feucht", companions: ["Tomaten", "Chili", "Spargel"], incompatible: [] },
  { name: "Dill", category: "Küchenkräuter", watering: "Gleichmäßig feucht", companions: ["Gurke", "Kohlsorten", "Zwiebeln"], incompatible: ["Karotten"] },
  { name: "Schnittlauch", category: "Küchenkräuter", watering: "Mäßig feucht", companions: ["Tomaten", "Karotten"], incompatible: [] },
  { name: "Koriander", category: "Küchenkräuter", watering: "Regelmäßig feucht", companions: ["Spinat", "Kohlsorten"], incompatible: ["Fenchel"] },
  { name: "Kerbel", category: "Küchenkräuter", watering: "Gleichmäßig feucht", companions: ["Erbsen", "Tomaten"], incompatible: [] },
  { name: "Liebstöckel", category: "Küchenkräuter", watering: "Mäßig feucht", companions: ["Tomaten", "Paprika", "Karotten"], incompatible: [] },
  { name: "Borretsch", category: "Küchenkräuter", watering: "Regelmäßig feucht", companions: ["Tomaten", "Bohnen", "Zucchini"], incompatible: [] },
  { name: "Ringelblume", category: "Heilkräuter", watering: "Mäßig feucht", companions: ["Tomaten", "Bohnen"], incompatible: [] },
  { name: "Kamille", category: "Heilkräuter", watering: "Trocken bis mäßig", companions: ["Lavendel", "Thymian"], incompatible: ["Minze"] },
  { name: "Lavendel", category: "Heilkräuter", watering: "Trocken halten", companions: ["Rosmarin", "Thymian", "Salbei"], incompatible: [] },
  { name: "Salbei", category: "Heilkräuter", watering: "Trocken bis mäßig", companions: ["Rosmarin", "Thymian", "Lavendel"], incompatible: ["Basilikum", "Gurke"] },
  { name: "Thymian", category: "Heilkräuter", watering: "Trocken halten", companions: ["Rosmarin", "Lavendel", "Salbei"], incompatible: [] },
  { name: "Rosmarin", category: "Heilkräuter", watering: "Trocken halten", companions: ["Thymian", "Lavendel", "Salbei", "Bohnen"], incompatible: ["Gurke"] },
  { name: "Minze", category: "Heilkräuter", watering: "Feucht halten", companions: ["Tomaten", "Lattich"], incompatible: ["Kamille", "Chamisso"] },
  { name: "Echinacea", category: "Heilkräuter", watering: "Mäßig feucht", companions: ["Ringelblume", "Sonnenblume"], incompatible: [] },
  { name: "Arnikablume", category: "Heilkräuter", watering: "Mäßig feucht", companions: ["Sonnenblume"], incompatible: [] },
  { name: "Melisse", category: "Heilkräuter", watering: "Gleichmäßig feucht", companions: ["Tomaten", "Bohnen"], incompatible: ["Minze (Ausbreitung)"] },
  { name: "Ysop", category: "Heilkräuter", watering: "Trocken bis mäßig", companions: ["Kohlsorten", "Salbei"], incompatible: [] },
  { name: "Pfefferminze", category: "Heilkräuter", watering: "Feucht halten", companions: ["Tomaten", "Lattich"], incompatible: ["Kamille"] },
  { name: "Johanniskraut", category: "Heilkräuter", watering: "Mäßig feucht", companions: ["Sonnenblume"], incompatible: [] },
  { name: "Frauenmantel", category: "Heilkräuter", watering: "Gleichmäßig feucht", companions: ["Kamille"], incompatible: [] },
  { name: "Beinwell", category: "Heilkräuter", watering: "Feucht halten", companions: ["Tomaten", "Bohnen"], incompatible: [] },
  { name: "Oregano", category: "Küchenkräuter", watering: "Trocken bis mäßig", companions: ["Tomaten", "Paprika", "Bohnen"], incompatible: [] },
  { name: "Majoran", category: "Küchenkräuter", watering: "Mäßig feucht", companions: ["Tomaten", "Paprika"], incompatible: [] },
  { name: "Pimenton", category: "Küchenkräuter", watering: "Mäßig feucht", companions: ["Basilikum"], incompatible: [] },
  { name: "Tomaten", category: "Gemüse", watering: "Regelmäßig feucht", companions: ["Basilikum", "Petersilie", "Karotten", "Ringelblume"], incompatible: ["Fenchel", "Kohlsorten"] },
  { name: "Paprika", category: "Gemüse", watering: "Regelmäßig feucht", companions: ["Basilikum", "Tomaten", "Oregano"], incompatible: [] },
  { name: "Chili", category: "Gemüse", watering: "Regelmäßig feucht", companions: ["Basilikum", "Tomaten", "Petersilie"], incompatible: [] },
  { name: "Gurke", category: "Gemüse", watering: "Regelmäßig feucht halten", companions: ["Dill", "Erbsen", "Bohnen", "Sonnenblume"], incompatible: ["Salbei", "Rosmarin", "Minze"] },
  { name: "Zucchini", category: "Gemüse", watering: "Regelmäßig feucht", companions: ["Borretsch", "Bohnen", "Mais"], incompatible: [] },
  { name: "Kürbis", category: "Gemüse", watering: "Regelmäßig feucht", companions: ["Mais", "Bohnen", "Ringelblume"], incompatible: [] },
  { name: "Tomate", category: "Gemüse", watering: "Regelmäßig feucht", companions: ["Basilikum", "Petersilie", "Karotten"], incompatible: ["Fenchel", "Kohlsorten"] },
  { name: "Erbsen", category: "Gemüse", watering: "Gleichmäßig feucht", companions: ["Karotten", "Radieschen", "Gurke", "Dill"], incompatible: ["Zwiebeln", "Knoblauch"] },
  { name: "Bohnen", category: "Gemüse", watering: "Regelmäßig feucht", companions: ["Gurke", "Kürbis", "Zucchini", "Salat"], incompatible: ["Zwiebeln", "Knoblauch", "Fenchel"] },
  { name: "Karotten", category: "Gemüse", watering: "Gleichmäßig feucht", companions: ["Tomaten", "Erbsen", "Radieschen", "Schnittlauch"], incompatible: ["Dill"] },
  { name: "Radieschen", category: "Gemüse", watering: "Gleichmäßig feucht", companions: ["Erbsen", "Karotten", "Salat", "Spinat"], incompatible: [] },
  { name: "Spinat", category: "Gemüse", watering: "Gleichmäßig feucht", companions: ["Erbsen", "Radieschen", "Kohlsorten"], incompatible: [] },
  { name: "Salat", category: "Gemüse", watering: "Gleichmäßig feucht", companions: ["Bohnen", "Karotten", "Radieschen"], incompatible: [] },
  { name: "Kohlsorten", category: "Gemüse", watering: "Regelmäßig feucht", companions: ["Dill", "Salbei", "Spinat", "Ringelblume"], incompatible: ["Tomaten", "Erbsen", "Bohnen"] },
  { name: "Zwiebeln", category: "Gemüse", watering: "Mäßig feucht", companions: ["Karotten", "Salat", "Tomaten"], incompatible: ["Erbsen", "Bohnen"] },
  { name: "Knoblauch", category: "Gemüse", watering: "Mäßig feucht", companions: ["Tomaten", "Paprika", "Rosmarin"], incompatible: ["Erbsen", "Bohnen"] },
  { name: "Fenchel", category: "Gemüse", watering: "Gleichmäßig feucht", companions: ["Koriander"], incompatible: ["Tomaten", "Bohnen", "Kohlsorten"] },
  { name: "Sonnenblume", category: "Blumen", watering: "Mäßig feucht", companions: ["Gurke", "Kürbis", "Ringelblume"], incompatible: [] },
  { name: "Tagetes", category: "Blumen", watering: "Mäßig feucht", companions: ["Tomaten", "Bohnen"], incompatible: [] },
  { name: "Lattich", category: "Blumen", watering: "Gleichmäßig feucht", companions: ["Minze", "Pfefferminze"], incompatible: [] },
];

var YIELD_KG_PER_M2 = {
  "Basilikum": 0.8, "Petersilie": 0.6, "Dill": 0.5, "Schnittlauch": 0.5,
  "Koriander": 0.4, "Kerbel": 0.3, "Liebstöckel": 0.5, "Borretsch": 0.3,
  "Ringelblume": 0.2, "Kamille": 0.1, "Lavendel": 0.1, "Salbei": 0.3,
  "Thymian": 0.2, "Rosmarin": 0.2, "Minze": 1.0, "Echinacea": 0.1,
  "Arnikablume": 0.1, "Melisse": 0.6, "Ysop": 0.2, "Pfefferminze": 1.0,
  "Johanniskraut": 0.1, "Frauenmantel": 0.2, "Beinwell": 0.3,
  "Oregano": 0.4, "Majoran": 0.4, "Pimenton": 0.4,
  "Tomaten": 5.0, "Paprika": 3.0, "Chili": 1.5, "Gurke": 4.0,
  "Zucchini": 4.5, "Kürbis": 3.5, "Tomate": 5.0,
  "Erbsen": 1.0, "Bohnen": 1.5, "Karotten": 3.0, "Radieschen": 1.5,
  "Spinat": 1.0, "Salat": 2.0, "Kohlsorten": 3.0,
  "Zwiebeln": 2.5, "Knoblauch": 0.8, "Fenchel": 1.5,
  "Sonnenblume": 0.3, "Tagetes": 0.1, "Lattich": 1.5,
};

var PRICE_PER_KG = {
  "Basilikum": 15.0, "Petersilie": 10.0, "Dill": 10.0, "Schnittlauch": 12.0,
  "Koriander": 8.0, "Kerbel": 10.0, "Liebstöckel": 8.0, "Borretsch": 10.0,
  "Ringelblume": 20.0, "Kamille": 25.0, "Lavendel": 30.0, "Salbei": 12.0,
  "Thymian": 12.0, "Rosmarin": 12.0, "Minze": 10.0, "Echinacea": 30.0,
  "Arnikablume": 25.0, "Melisse": 12.0, "Ysop": 10.0, "Pfefferminze": 10.0,
  "Johanniskraut": 20.0, "Frauenmantel": 8.0, "Beinwell": 15.0,
  "Oregano": 12.0, "Majoran": 12.0, "Pimenton": 12.0,
  "Tomaten": 3.5, "Paprika": 4.0, "Chili": 8.0, "Gurke": 2.5,
  "Zucchini": 2.5, "Kürbis": 2.0, "Tomate": 3.5,
  "Erbsen": 4.0, "Bohnen": 4.0, "Karotten": 2.5, "Radieschen": 5.0,
  "Spinat": 3.0, "Salat": 3.0, "Kohlsorten": 2.5,
  "Zwiebeln": 1.5, "Knoblauch": 8.0, "Fenchel": 3.0,
  "Sonnenblume": 5.0, "Tagetes": 5.0, "Lattich": 3.0,
};

var PLANT_FAMILIES = {
  "Tomaten": "Nachtschattengewächse", "Tomate": "Nachtschattengewächse",
  "Paprika": "Nachtschattengewächse", "Chili": "Nachtschattengewächse",
  "Kartoffeln": "Nachtschattengewächse",
  "Gurke": "Kürbisgewächse", "Zucchini": "Kürbisgewächse", "Kürbis": "Kürbisgewächse",
  "Erbsen": "Hülsenfrüchte", "Bohnen": "Hülsenfrüchte",
  "Karotten": "Doldengewächse", "Fenchel": "Doldengewächse", "Petersilie": "Doldengewächse",
  "Dill": "Doldengewächse", "Koriander": "Doldengewächse", "Kerbel": "Doldengewächse",
  "Liebstöckel": "Doldengewächse", "Borretsch": "Raublattgewächse",
  "Salat": "Korbblütler", "Lattich": "Korbblütler", "Tagetes": "Korbblütler",
  "Ringelblume": "Korbblütler", "Kamille": "Korbblütler", "Echinacea": "Korbblütler",
  "Arnikablume": "Korbblütler",
  "Kohlsorten": "Kreuzblütler", "Radieschen": "Kreuzblütler",
  "Spinat": "Amarantgewächse",
  "Zwiebeln": "Amaryllisgewächse", "Knoblauch": "Amaryllisgewächse",
  "Lavendel": "Lippenblütler", "Salbei": "Lippenblütler", "Minze": "Lippenblütler",
  "Pfefferminze": "Lippenblütler", "Melisse": "Lippenblütler", "Thymian": "Lippenblütler",
  "Rosmarin": "Lippenblütler", "Oregano": "Lippenblütler", "Majoran": "Lippenblütler",
  "Ysop": "Lippenblütler", "Pimenton": "Lippenblütler",
  "Basilikum": "Lippenblütler", "Schnittlauch": "Amaryllisgewächse",
  "Johanniskraut": "Johanniskrautgewächse", "Frauenmantel": "Rosengewächse",
  "Beinwell": "Raublattgewächse", "Sonnenblume": "Korbblütler",
  "Lattich": "Korbblütler",
};

var PLANT_TIMING = {
  "Basilikum": { indoor_weeks: 6, outdoor_weeks: 0, growing_weeks: 8, harvest_weeks: 16 },
  "Petersilie": { indoor_weeks: 0, outdoor_weeks: -2, growing_weeks: 8, harvest_weeks: 24 },
  "Dill": { indoor_weeks: 0, outdoor_weeks: 0, growing_weeks: 6, harvest_weeks: 8 },
  "Schnittlauch": { indoor_weeks: 6, outdoor_weeks: 0, growing_weeks: 6, harvest_weeks: 24 },
  "Koriander": { indoor_weeks: 0, outdoor_weeks: 0, growing_weeks: 4, harvest_weeks: 8 },
  "Kerbel": { indoor_weeks: 0, outdoor_weeks: -2, growing_weeks: 5, harvest_weeks: 6 },
  "Liebstöckel": { indoor_weeks: 8, outdoor_weeks: 0, growing_weeks: 10, harvest_weeks: 16 },
  "Borretsch": { indoor_weeks: 0, outdoor_weeks: 0, growing_weeks: 6, harvest_weeks: 8 },
  "Ringelblume": { indoor_weeks: 4, outdoor_weeks: 0, growing_weeks: 8, harvest_weeks: 12 },
  "Kamille": { indoor_weeks: 0, outdoor_weeks: 0, growing_weeks: 8, harvest_weeks: 4 },
  "Lavendel": { indoor_weeks: 10, outdoor_weeks: 0, growing_weeks: 12, harvest_weeks: 4 },
  "Salbei": { indoor_weeks: 8, outdoor_weeks: 0, growing_weeks: 10, harvest_weeks: 16 },
  "Thymian": { indoor_weeks: 8, outdoor_weeks: 0, growing_weeks: 10, harvest_weeks: 24 },
  "Rosmarin": { indoor_weeks: 10, outdoor_weeks: 0, growing_weeks: 12, harvest_weeks: 24 },
  "Minze": { indoor_weeks: 8, outdoor_weeks: 0, growing_weeks: 6, harvest_weeks: 20 },
  "Echinacea": { indoor_weeks: 8, outdoor_weeks: 0, growing_weeks: 12, harvest_weeks: 4 },
  "Arnikablume": { indoor_weeks: 6, outdoor_weeks: 0, growing_weeks: 10, harvest_weeks: 4 },
  "Melisse": { indoor_weeks: 8, outdoor_weeks: 0, growing_weeks: 8, harvest_weeks: 16 },
  "Ysop": { indoor_weeks: 6, outdoor_weeks: 0, growing_weeks: 8, harvest_weeks: 12 },
  "Pfefferminze": { indoor_weeks: 8, outdoor_weeks: 0, growing_weeks: 6, harvest_weeks: 20 },
  "Johanniskraut": { indoor_weeks: 0, outdoor_weeks: 0, growing_weeks: 10, harvest_weeks: 4 },
  "Frauenmantel": { indoor_weeks: 0, outdoor_weeks: 0, growing_weeks: 8, harvest_weeks: 12 },
  "Beinwell": { indoor_weeks: 0, outdoor_weeks: 0, growing_weeks: 10, harvest_weeks: 8 },
  "Oregano": { indoor_weeks: 8, outdoor_weeks: 0, growing_weeks: 8, harvest_weeks: 20 },
  "Majoran": { indoor_weeks: 6, outdoor_weeks: 0, growing_weeks: 8, harvest_weeks: 16 },
  "Pimenton": { indoor_weeks: 6, outdoor_weeks: 0, growing_weeks: 8, harvest_weeks: 12 },
  "Tomaten": { indoor_weeks: 6, outdoor_weeks: 0, growing_weeks: 12, harvest_weeks: 8 },
  "Tomate": { indoor_weeks: 6, outdoor_weeks: 0, growing_weeks: 12, harvest_weeks: 8 },
  "Paprika": { indoor_weeks: 8, outdoor_weeks: 0, growing_weeks: 10, harvest_weeks: 8 },
  "Chili": { indoor_weeks: 8, outdoor_weeks: 0, growing_weeks: 12, harvest_weeks: 8 },
  "Gurke": { indoor_weeks: 3, outdoor_weeks: 0, growing_weeks: 8, harvest_weeks: 6 },
  "Zucchini": { indoor_weeks: 3, outdoor_weeks: 0, growing_weeks: 6, harvest_weeks: 10 },
  "Kürbis": { indoor_weeks: 3, outdoor_weeks: 0, growing_weeks: 10, harvest_weeks: 4 },
  "Erbsen": { indoor_weeks: 0, outdoor_weeks: -4, growing_weeks: 8, harvest_weeks: 4 },
  "Bohnen": { indoor_weeks: 0, outdoor_weeks: 0, growing_weeks: 8, harvest_weeks: 6 },
  "Karotten": { indoor_weeks: 0, outdoor_weeks: -2, growing_weeks: 10, harvest_weeks: 8 },
  "Radieschen": { indoor_weeks: 0, outdoor_weeks: 0, growing_weeks: 4, harvest_weeks: 2 },
  "Spinat": { indoor_weeks: 0, outdoor_weeks: -4, growing_weeks: 5, harvest_weeks: 6 },
  "Salat": { indoor_weeks: 4, outdoor_weeks: 0, growing_weeks: 6, harvest_weeks: 4 },
  "Kohlsorten": { indoor_weeks: 4, outdoor_weeks: 0, growing_weeks: 10, harvest_weeks: 6 },
  "Zwiebeln": { indoor_weeks: 0, outdoor_weeks: -4, growing_weeks: 14, harvest_weeks: 4 },
  "Knoblauch": { indoor_weeks: 0, outdoor_weeks: -16, growing_weeks: 8, harvest_weeks: 2 },
  "Fenchel": { indoor_weeks: 0, outdoor_weeks: 0, growing_weeks: 10, harvest_weeks: 4 },
  "Sonnenblume": { indoor_weeks: 0, outdoor_weeks: 0, growing_weeks: 10, harvest_weeks: 4 },
  "Tagetes": { indoor_weeks: 6, outdoor_weeks: 0, growing_weeks: 8, harvest_weeks: 8 },
  "Lattich": { indoor_weeks: 4, outdoor_weeks: 0, growing_weeks: 5, harvest_weeks: 3 },
};

function getCatalogForDatalist() {
  var db = window.PLANT_CATALOG_DB || [];
  if (db.length > 0) return db;
  return PLANT_CATALOG;
}

function getPriceForPlant(name) {
  var db = (window.PLANT_CATALOG_DB || []).find(function(c) { return c.name === name; });
  if (db && db.price_per_kg) return db.price_per_kg;
  return PRICE_PER_KG[name] || 0;
}

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
  clipboard: null,
  dragging: false,
  dragSectionId: null,
  dragStart: null,
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
    const img = p.image ? "/api/field-plans/" + p.id + "/image" : "";
    return (
      '<div class="col-md-6 col-lg-4">' +
      '<div class="card h-100">' +
      (img
        ? '<img src="' + img + '" class="card-img-top" style="height:160px;object-fit:cover;" alt="' + esc(p.name) + '">'
        : '<div class="card-img-top d-flex align-items-center justify-content-center bg-light" style="height:160px;"><i class="bi bi-image display-4 text-muted"></i></div>') +
      '<div class="card-body">' +
      '<h5 class="card-title">' + esc(p.name) + '</h5>' +
      '<p class="card-text text-muted small mb-2">' + (p.section_count || 0) + ' Bereiche</p>' +
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
  const fpWaterRefresh = document.getElementById("fieldWateringRefresh");
  if (fpWaterRefresh) {
    fpWaterRefresh.addEventListener("click", () => { renderWateringCalendar(); });
  }
  const fpExportBtn = document.getElementById("fieldplanExportBtn");
  if (fpExportBtn) {
    fpExportBtn.addEventListener("click", () => { exportFieldPlanPNG(); });
  }
  const fpPasteBtn = document.getElementById("fieldplanPasteBtn");
  if (fpPasteBtn) {
    fpPasteBtn.addEventListener("click", () => {
      if (!fpState.clipboard || !fpState.plan) return;
      var src = fpState.clipboard;
      var offset = 0.03;
      var newPoints = (src.points || []).map(function(p) {
        return { x: Math.min(1, p.x + offset), y: Math.min(1, p.y + offset) };
      });
      var payload = {
        points: newPoints,
        name: src.name || "",
        plant_name: src.plant_name || "",
        plant_variety: src.plant_variety || "",
        planting_date: src.planting_date || null,
        expected_harvest: src.expected_harvest || null,
        growth_stage: src.growth_stage || "Saaten",
        watering_interval: src.watering_interval || null,
        watering_last: src.watering_last || null,
        notes: src.notes || "",
        color: src.color || "#3f6b3b",
      };
      adminApi("api/admin/field-plans/" + fpState.plan.id + "/sections", "POST", payload)
        .then(() => { showToast("Bereich eingefügt."); return reloadFieldPlan(); })
        .catch(function(err) { showToast(err.message); });
    });
  }
  const pcAddBtn = document.getElementById("plantCatalogAdd");
  if (pcAddBtn) {
    pcAddBtn.addEventListener("click", () => { openPlantCatalogModal(null); });
  }
  const pcRefreshBtn = document.getElementById("plantCatalogRefresh");
  if (pcRefreshBtn) {
    pcRefreshBtn.addEventListener("click", () => { loadPlantCatalogForAdmin(); });
  }
  loadPlantCatalog();
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
      renderPlanSummary();
      renderTimeline();
      renderWateringCalendar();
      loadFieldImage();
      loadPlantCatalogForAdmin();
      adminApi("api/admin/rotation-history").then(function(d) { window._lastRotationHistory = d.history || []; }).catch(function() { window._lastRotationHistory = []; });
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
      renderPlanSummary();
      renderTimeline();
      renderWateringCalendar();
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
  canvas.onmousedown = onCanvasMouseDown;
  canvas.onmouseup = onCanvasMouseUp;
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
      const isMobile = window.innerWidth <= 768;
      const isSelected = fpState.selectedSection === s.id;
      if (isMobile && !isSelected) {
        ctx.beginPath();
        ctx.arc(cx, cy, 4, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255,255,255,0.7)";
        ctx.fill();
        ctx.beginPath();
        ctx.arc(cx, cy, 4, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(0,0,0,0.5)";
        ctx.lineWidth = 1;
        ctx.stroke();
        return;
      }
      const label = getDisplayName(s, fpState.sections);
      const ppm = getPixelsPerMeter();
      let areaText = "";
      if (ppm) {
        let areaPx = 0;
        for (let i = 0; i < pts.length; i++) {
          const j = (i + 1) % pts.length;
          areaPx += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
        }
        areaPx = Math.abs(areaPx) / 2;
        const areaM2 = areaPx * w * h / (ppm * ppm);
        areaText = areaM2.toFixed(2) + " m²";
      }
      const lines = [];
      if (label) lines.push(label);
      if (areaText) lines.push(areaText);
      if (lines.length === 0) return;
      ctx.font = "bold 13px Inter, sans-serif";
      const lineH = 18;
      const totalH = lines.length * lineH + 6;
      let maxW = 0;
      for (const l of lines) maxW = Math.max(maxW, ctx.measureText(l).width + 10);
      s._label = { x: cx, y: cy, ox: cx, oy: cy, w: maxW, h: totalH, lines: lines, lineH: lineH };
    }
  });

  const labelList = fpState.sections.map((s) => s._label).filter(Boolean);
  for (let iter = 0; iter < 50; iter++) {
    let moved = false;
    for (let i = 0; i < labelList.length; i++) {
      for (let j = i + 1; j < labelList.length; j++) {
        const a = labelList[i], b = labelList[j];
        const overlapX = (a.w / 2 + b.w / 2) - Math.abs(a.x - b.x);
        const overlapY = (a.h / 2 + b.h / 2) - Math.abs(a.y - b.y);
        if (overlapX > 0 && overlapY > 0) {
          moved = true;
          const dx = a.x - b.x || 1;
          const dy = a.y - b.y || 1;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const pushX = dx / dist * overlapX / 2;
          const pushY = dy / dist * overlapY / 2;
          a.x += pushX;
          a.y += pushY;
          b.x -= pushX;
          b.y -= pushY;
        }
      }
    }
    if (!moved) break;
  }

  fpState.sections.forEach((s) => {
    const lbl = s._label;
    if (!lbl) return;
    const displaced = Math.abs(lbl.x - lbl.ox) > 1 || Math.abs(lbl.y - lbl.oy) > 1;
    if (displaced) {
      ctx.beginPath();
      ctx.moveTo(lbl.ox, lbl.oy);
      ctx.lineTo(lbl.x, lbl.y);
      ctx.strokeStyle = "rgba(255,255,255,0.6)";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(lbl.ox, lbl.oy, 3, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      ctx.fill();
    }
    ctx.font = "bold 13px Inter, sans-serif";
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(lbl.x - lbl.w / 2, lbl.y - lbl.h / 2, lbl.w, lbl.h);
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let i = 0; i < lbl.lines.length; i++) {
      ctx.fillText(lbl.lines[i], lbl.x, lbl.y - lbl.h / 2 + lbl.lineH / 2 + 3 + i * lbl.lineH);
    }
    delete s._label;
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

  drawIncompatibleLines(ctx, w, h);
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

function computeSectionDims(section) {
  const canvas = document.getElementById("fieldCanvas");
  if (!canvas || !section || !section.points || section.points.length < 3) return null;
  const ppm = getPixelsPerMeter();
  if (!ppm) return null;
  const pts = section.points;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const widthM = (maxX - minX) * canvas.width / ppm;
  const heightM = (maxY - minY) * canvas.height / ppm;
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    area += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  const areaM2 = Math.abs(area) / 2 * canvas.width * canvas.height / (ppm * ppm);
  return { width: widthM.toFixed(2), height: heightM.toFixed(2), area: areaM2.toFixed(2) };
}

function exportFieldPlanPNG() {
  const canvas = document.getElementById("fieldCanvas");
  if (!canvas || !fpState.image) return;
  const tmpCanvas = document.createElement("canvas");
  tmpCanvas.width = canvas.width;
  tmpCanvas.height = canvas.height;
  const tmpCtx = tmpCanvas.getContext("2d");
  tmpCtx.drawImage(fpState.image, 0, 0, canvas.width, canvas.height);
  fpState.sections.forEach(function(s) {
    const pts = s.points || [];
    if (pts.length < 3) return;
    tmpCtx.beginPath();
    tmpCtx.moveTo(pts[0].x * canvas.width, pts[0].y * canvas.height);
    for (var i = 1; i < pts.length; i++) tmpCtx.lineTo(pts[i].x * canvas.width, pts[i].y * canvas.height);
    tmpCtx.closePath();
    tmpCtx.fillStyle = hexToRGBA(s.color || "#3f6b3b", 0.3);
    tmpCtx.fill();
    tmpCtx.strokeStyle = s.color || "#3f6b3b";
    tmpCtx.lineWidth = 2;
    tmpCtx.stroke();
    const cx = pts.reduce(function(sum, p) { return sum + p.x; }, 0) / pts.length * canvas.width;
    const cy = pts.reduce(function(sum, p) { return sum + p.y; }, 0) / pts.length * canvas.height;
    const label = getDisplayName(s, fpState.sections);
    if (!label) return;
    s._expLabel = { x: cx, y: cy, ox: cx, oy: cy, label: label };
  });

  const tmpFont = "bold 13px Inter, sans-serif";
  tmpCtx.font = tmpFont;
  fpState.sections.forEach(function(s) {
    if (!s._expLabel) return;
    const lbl = s._expLabel;
    const tw = tmpCtx.measureText(lbl.label).width + 10;
    lbl.w = tw;
    lbl.h = 24;
  });

  const labelList = fpState.sections.map(function(s) { return s._expLabel; }).filter(Boolean);
  for (var iter = 0; iter < 50; iter++) {
    var moved = false;
    for (var i = 0; i < labelList.length; i++) {
      for (var j = i + 1; j < labelList.length; j++) {
        var a = labelList[i], b = labelList[j];
        var overlapX = (a.w / 2 + b.w / 2) - Math.abs(a.x - b.x);
        var overlapY = (a.h / 2 + b.h / 2) - Math.abs(a.y - b.y);
        if (overlapX > 0 && overlapY > 0) {
          moved = true;
          var dx = a.x - b.x || 1;
          var dy = a.y - b.y || 1;
          var dist = Math.sqrt(dx * dx + dy * dy);
          var pushX = dx / dist * overlapX / 2;
          var pushY = dy / dist * overlapY / 2;
          a.x += pushX; a.y += pushY;
          b.x -= pushX; b.y -= pushY;
        }
      }
    }
    if (!moved) break;
  }

  tmpCtx.font = tmpFont;
  labelList.forEach(function(lbl) {
    var displaced = Math.abs(lbl.x - lbl.ox) > 1 || Math.abs(lbl.y - lbl.oy) > 1;
    if (displaced) {
      tmpCtx.beginPath();
      tmpCtx.moveTo(lbl.ox, lbl.oy);
      tmpCtx.lineTo(lbl.x, lbl.y);
      tmpCtx.strokeStyle = "rgba(255,255,255,0.6)";
      tmpCtx.lineWidth = 1;
      tmpCtx.stroke();
      tmpCtx.beginPath();
      tmpCtx.arc(lbl.ox, lbl.oy, 3, 0, Math.PI * 2);
      tmpCtx.fillStyle = "rgba(255,255,255,0.7)";
      tmpCtx.fill();
    }
    tmpCtx.fillStyle = "rgba(0,0,0,0.55)";
    tmpCtx.fillRect(lbl.x - lbl.w / 2, lbl.y - lbl.h / 2, lbl.w, lbl.h);
    tmpCtx.fillStyle = "#fff";
    tmpCtx.textAlign = "center";
    tmpCtx.textBaseline = "middle";
    tmpCtx.fillText(lbl.label, lbl.x, lbl.y);
  });

  fpState.sections.forEach(function(s) { delete s._expLabel; });

  tmpCanvas.toBlob(function(blob) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = (fpState.plan ? fpState.plan.name : "anbauplan") + ".png";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, "image/png");
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

function onCanvasMouseDown(e) {
  if (fpState.drawing || fpState.calibrating || e.button !== 0) return;
  const canvas = e.target;
  const rect = canvas.getBoundingClientRect();
  const x = (e.clientX - rect.left) / rect.width;
  const y = (e.clientY - rect.top) / rect.height;
  for (let i = fpState.sections.length - 1; i >= 0; i--) {
    if (pointInPolygon({ x, y }, fpState.sections[i].points || [])) {
      fpState.dragging = true;
      fpState.dragSectionId = fpState.sections[i].id;
      fpState.dragStart = { x, y };
      canvas.style.cursor = "grabbing";
      e.preventDefault();
      return;
    }
  }
}

function onCanvasMouseUp(e) {
  if (!fpState.dragging) return;
  fpState.dragging = false;
  const canvas = e.target;
  canvas.style.cursor = "default";
  const section = fpState.sections.find(function(s) { return s.id === fpState.dragSectionId; });
  if (section) {
    adminApi("api/admin/field-plans/" + fpState.plan.id + "/sections/" + section.id, "PUT", { points: section.points })
      .then(function() { return reloadFieldPlan(); })
      .catch(function(err) { showToast(err.message); });
  }
  fpState.dragSectionId = null;
  fpState.dragStart = null;
}

function onCanvasMouseMove(e) {
  if (fpState.dragging) {
    const canvas = e.target;
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) / rect.width;
    const my = (e.clientY - rect.top) / rect.height;
    const dx = mx - fpState.dragStart.x;
    const dy = my - fpState.dragStart.y;
    fpState.dragStart = { x: mx, y: my };
    const section = fpState.sections.find(function(s) { return s.id === fpState.dragSectionId; });
    if (section) {
      section.points = (section.points || []).map(function(p) {
        return { x: Math.max(0, Math.min(1, p.x + dx)), y: Math.max(0, Math.min(1, p.y + dy)) };
      });
      renderFieldCanvas();
    }
    return;
  }
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
  const hasCalib = p.calibration_x1 != null && p.calibration_meters;
  let html = "";
  if (hasCalib) {
    html += '<p class="small mb-2"><strong>Kalibriert:</strong> ' + p.calibration_meters + ' m Referenzlinie</p>';
    html += '<button class="btn btn-sm btn-outline-danger w-100" id="fpScaleClear">Kalibrierung entfernen</button>';
  } else {
    html += '<p class="small text-muted mb-0">Nutzen Sie die Referenzlinie zur Kalibrierung.</p>';
  }
  body.innerHTML = html;
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
  const header = document.querySelector("#fieldSectionPanel .card-header");
  if (!section) {
    if (header) header.innerHTML = '<i class="bi bi-pencil-square"></i> Bereich-Eigenschaften';
    body.innerHTML = '<p class="text-muted small mb-0">Zeichnen Sie einen Bereich auf dem Grundriss, oder klicken Sie auf einen bestehenden Bereich.</p>';
    return;
  }
  if (header) header.innerHTML = '<i class="bi bi-pencil-square"></i> ' + esc(getDisplayName(section, fpState.sections));
  const growthOptions = GROWTH_STAGES.map(
    (g) => '<option value="' + g + '"' + (g === section.growth_stage ? " selected" : "") + '>' + g + '</option>'
  ).join("");
  const dims = computeSectionDims(section);
  const dimsHtml = dims
    ? '<div class="row g-2 mb-2">' +
      '<div class="col-4"><span class="small text-muted d-block">Breite</span><strong>' + dims.width + ' m</strong></div>' +
      '<div class="col-4"><span class="small text-muted d-block">Höhe</span><strong>' + dims.height + ' m</strong></div>' +
      '<div class="col-4"><span class="small text-muted d-block">Fläche</span><strong>' + dims.area + ' m²</strong></div>' +
      (YIELD_KG_PER_M2[section.plant_name] ?
        '<div class="col-6"><span class="small text-muted d-block">Ertrag</span><strong>~' + (YIELD_KG_PER_M2[section.plant_name] * parseFloat(dims.area)).toFixed(1) + ' kg</strong></div>' +
        (getPriceForPlant(section.plant_name) ? '<div class="col-6"><span class="small text-muted d-block">Umsatz</span><strong>~' + (YIELD_KG_PER_M2[section.plant_name] * getPriceForPlant(section.plant_name) * parseFloat(dims.area)).toFixed(0) + ' €</strong></div>' : '')
        : '') +
      '</div>'
    : '';
  let companionHtml = '';
  const plantEntry = getCatalogForDatalist().find(function(c) { return c.name === (section.plant_name || ""); });
  if (plantEntry) {
    const bad = [];
    fpState.sections.forEach(function(other) {
      if (other.id === section.id) return;
      const otherEntry = getCatalogForDatalist().find(function(c) { return c.name === (other.plant_name || ""); });
      if (!otherEntry) return;
      if (plantEntry.incompatible.indexOf(other.plant_name) !== -1) {
        bad.push(other.plant_name);
      } else if (otherEntry.incompatible.indexOf(section.plant_name) !== -1) {
        bad.push(other.plant_name);
      }
    });
    if (bad.length > 0) {
      companionHtml = '<div class="alert alert-warning py-1 px-2 small mb-2"><i class="bi bi-exclamation-triangle"></i> Nicht kompatibel mit: ' + esc(bad.join(", ")) + '</div>';
    } else {
      const compat = [];
      fpState.sections.forEach(function(other) {
        if (other.id === section.id) return;
        if (plantEntry.companions.indexOf(other.plant_name) !== -1) compat.push(other.plant_name);
      });
      if (compat.length > 0) {
        companionHtml = '<div class="alert alert-success py-1 px-2 small mb-2"><i class="bi bi-check-circle"></i> Gut zusammen mit: ' + esc(compat.join(", ")) + '</div>';
      }
    }
  }
  var rotationHtml = '';
  var sectionHistory = (window._lastRotationHistory || []).filter(function(h) {
    return h.section_name === (section.name || "") && h.plant_name !== (section.plant_name || "");
  });
  if (sectionHistory.length > 0 && section.plant_name) {
    var h = sectionHistory[0];
    rotationHtml = '<div class="alert alert-warning py-1 px-2 small mb-2"><i class="bi bi-arrow-clockwise"></i> ' + esc(h.plant_name) + ' war hier in ' + h.plan_year + '.</div>';
  }
  body.innerHTML =
    '<div class="mb-2">' +
    '<label class="form-label small">Name</label>' +
    '<input type="text" class="form-control form-control-sm" id="fsName" value="' + esc(section.name || '') + '">' +
    '</div>' +
    '<div class="mb-2">' +
    '<label class="form-label small">Pflanze</label>' +
    '<input type="text" class="form-control form-control-sm" id="fsPlant" value="' + esc(section.plant_name || '') + '" placeholder="z.B. Salbei" list="plantDatalist">' +
    '<datalist id="plantDatalist">' + getCatalogForDatalist().map(function(p) { return '<option value="' + esc(p.name) + '">'; }).join("") + '</datalist>' +
    '</div>' +
    companionHtml +
    rotationHtml +
    '<div class="mb-2">' +
    '<label class="form-label small">Sorte</label>' +
    '<input type="text" class="form-control form-control-sm" id="fsVariety" value="' + esc(section.plant_variety || '') + '" placeholder="z.B. Bergsalbei">' +
    '</div>' +
    dimsHtml +
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
    '<div class="row g-2 mb-2">' +
    '<div class="col-6">' +
    '<label class="form-label small">Intervall (Tage)</label>' +
    '<input type="number" class="form-control form-control-sm" id="fsWaterInterval" min="1" max="30" value="' + (section.watering_interval || '') + '" placeholder="z.B. 2">' +
    '</div>' +
    '<div class="col-6">' +
    '<label class="form-label small">Zuletzt gegossen</label>' +
    '<input type="date" class="form-control form-control-sm" id="fsWaterLast" value="' + (section.watering_last || '') + '">' +
    '</div>' +
    '</div>' +
    '<div class="form-check mb-2">' +
    '<input class="form-check-input" type="checkbox" id="fsWaterAuto"' + (section.watering_auto ? ' checked' : '') + '>' +
    '<label class="form-check-label small" for="fsWaterAuto"><i class="bi bi-magic"></i> Automatische Bewässerung</label>' +
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
    '<button class="btn btn-sm btn-outline-secondary" id="fsCopy" title="Kopieren"><i class="bi bi-clipboard"></i></button>' +
    '<button class="btn btn-sm btn-outline-danger" id="fsDelete" title="Löschen"><i class="bi bi-trash"></i></button>' +
    '</div>';
  document.getElementById("fsSave").addEventListener("click", () => saveSection(section.id));
  document.getElementById("fsCopy").addEventListener("click", () => {
    fpState.clipboard = JSON.parse(JSON.stringify(section));
    document.getElementById("fieldplanPasteBtn").classList.remove("d-none");
    showToast("Bereich kopiert.");
  });
  document.getElementById("fsDelete").addEventListener("click", () => {
    if (!confirm("Bereich wirklich löschen?")) return;
    adminApi("api/admin/field-plans/" + fpState.plan.id + "/sections/" + section.id, "DELETE")
      .then(() => { showToast("Bereich gelöscht."); fpState.selectedSection = null; showSectionPanel(null); return reloadFieldPlan(); })
      .catch((err) => showToast(err.message));
  });
  var fsPlant = document.getElementById("fsPlant");
  if (fsPlant) {
    fsPlant.addEventListener("input", function() {
      var entry = getCatalogForDatalist().find(function(c) { return c.name === fsPlant.value; });
      if (entry) {
        var intervalInput = document.getElementById("fsWaterInterval");
        if (intervalInput && !intervalInput.value) {
          var freq = getWateringFrequencyDays({ watering_schedule: entry.watering, plant_name: entry.name });
          if (freq > 0) intervalInput.value = freq;
        }
      }
    });
  }
}

function saveSection(sectionId) {
  const intervalVal = document.getElementById("fsWaterInterval").value;
  const lastVal = document.getElementById("fsWaterLast").value;
  const data = {
    name: document.getElementById("fsName").value.trim(),
    plant_name: document.getElementById("fsPlant").value.trim(),
    plant_variety: document.getElementById("fsVariety").value.trim(),
    planting_date: document.getElementById("fsPlantDate").value || null,
    expected_harvest: document.getElementById("fsHarvest").value || null,
    growth_stage: document.getElementById("fsStage").value,
    watering_interval: intervalVal ? parseInt(intervalVal) || null : null,
    watering_last: lastVal || null,
    watering_auto: document.getElementById("fsWaterAuto").checked ? 1 : 0,
    notes: document.getElementById("fsNotes").value.trim(),
    color: document.getElementById("fsColor").value,
  };
  adminApi("api/admin/field-plans/" + fpState.plan.id + "/sections/" + sectionId, "PUT", data)
    .then(() => { showToast("Bereich gespeichert."); return reloadFieldPlan(); })
    .then(() => { renderFieldCanvas(); })
    .catch((err) => showToast(err.message));
}

// ---------------------------------------------------------------- email templates

var EMAIL_PLACEHOLDERS = {
  order_customer: ["order_no", "items", "subtotal", "discount", "shipping", "total", "delivery"],
  order_admin: ["order_no", "total", "delivery_text", "coupon", "name", "phone", "email"],
  status_change: ["order_no", "status"],
  contact_admin: ["name", "email", "message"],
  password_reset: ["name", "reset_url"],
};

var EMAIL_DESCRIPTIONS = {
  order_customer: "Wird an den Kunden nach erfolgreicher Zahlung gesendet. Enthält die Bestelldetails und Rechnung.",
  order_admin: "Benachrichtigung an den Admin bei neuer Bestellung.",
  status_change: "Informiert den Kunden bei Statusänderung seiner Bestellung.",
  contact_admin: "Benachrichtigung an den Admin bei neuer Kontaktanfrage.",
  password_reset: "Link zum Passwort-Zurücksetzen für Kunden.",
};

function loadEmailTemplates() {
  adminApi("api/admin/email-templates")
    .then(function(data) {
      window.ADMIN_EMAIL_TEMPLATES = data.templates || [];
      renderEmailTemplates();
    })
    .catch(function(err) {
      showMsg("emailsMsg", err.message || "E-Mail-Vorlagen konnten nicht geladen werden.", "danger");
    });
}

function renderEmailTemplates() {
  var list = document.getElementById("emailsList");
  if (!list) return;
  var templates = window.ADMIN_EMAIL_TEMPLATES || [];
  if (templates.length === 0) {
    list.innerHTML = '<p class="text-muted">Keine E-Mail-Vorlagen gefunden.</p>';
    return;
  }
  list.innerHTML = templates.map(function(tpl) {
    var placeholders = EMAIL_PLACEHOLDERS[tpl.key] || [];
    var desc = EMAIL_DESCRIPTIONS[tpl.key] || "";
    var phHtml = placeholders.length
      ? '<div class="mt-2"><span class="small text-muted">Platzhalter: </span>' +
        placeholders.map(function(p) { return '<code>{' + esc(p) + '}</code>'; }).join(" ") +
        '</div>'
      : '';
    return (
      '<div class="card mb-3" id="tplCard_' + esc(tpl.key) + '">' +
      '<div class="card-header d-flex justify-content-between align-items-center">' +
      '<div class="d-flex align-items-center gap-2">' +
      '<strong>' + esc(tpl.name) + '</strong>' +
      (tpl.enabled
        ? '<span class="badge bg-success">Aktiv</span>'
        : '<span class="badge bg-secondary">Deaktiviert</span>') +
      '</div>' +
      '<div class="form-check form-switch">' +
      '<input class="form-check-input tpl-toggle" type="checkbox" data-key="' + esc(tpl.key) + '"' +
      (tpl.enabled ? ' checked' : '') + ' title="Ein-/Ausschalten">' +
      '</div>' +
      '</div>' +
      '<div class="card-body">' +
      (desc ? '<p class="text-muted small mb-3">' + esc(desc) + '</p>' : '') +
      '<div class="mb-3">' +
      '<label class="form-label small fw-bold">Betreff</label>' +
      '<input type="text" class="form-control form-control-sm tpl-subject" data-key="' + esc(tpl.key) + '" value="' + esc(tpl.subject) + '">' +
      '</div>' +
      '<div class="mb-3">' +
      '<label class="form-label small fw-bold">Nachrichtentext</label>' +
      '<textarea class="form-control form-control-sm tpl-body" data-key="' + esc(tpl.key) + '" rows="6" style="font-family:monospace;font-size:0.85em;">' + esc(tpl.body) + '</textarea>' +
      phHtml +
      '</div>' +
      '<div class="text-end">' +
      '<button class="btn btn-sm btn-irm tpl-save" data-key="' + esc(tpl.key) + '">' +
      '<i class="bi bi-check-lg"></i> Speichern</button>' +
      '</div>' +
      '</div>' +
      '</div>'
    );
  }).join("");

  list.querySelectorAll(".tpl-toggle").forEach(function(el) {
    el.addEventListener("change", function() {
      var key = el.dataset.key;
      adminApi("api/admin/email-templates/" + encodeURIComponent(key), "PUT", { enabled: el.checked })
        .then(function() {
          showToast("Vorlage " + (el.checked ? "aktiviert" : "deaktiviert") + ".");
          loadEmailTemplates();
        })
        .catch(function(err) { showToast(err.message); });
    });
  });

  list.querySelectorAll(".tpl-save").forEach(function(btn) {
    btn.addEventListener("click", function() {
      var key = btn.dataset.key;
      var card = document.getElementById("tplCard_" + key);
      if (!card) return;
      var subject = card.querySelector(".tpl-subject").value.trim();
      var body = card.querySelector(".tpl-body").value;
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';
      adminApi("api/admin/email-templates/" + encodeURIComponent(key), "PUT", { subject: subject, body: body })
        .then(function() {
          showToast("Vorlage gespeichert.");
          btn.disabled = false;
          btn.innerHTML = '<i class="bi bi-check-lg"></i> Speichern';
        })
        .catch(function(err) {
          showToast(err.message);
          btn.disabled = false;
          btn.innerHTML = '<i class="bi bi-check-lg"></i> Speichern';
        });
    });
  });
}

// ---------------------------------------------------------------- customers

var CUSTOMERS_QUERY = "";

function loadCustomers() {
  adminApi("api/admin/customers")
    .then(function(data) {
      window.ADMIN_CUSTOMERS = data.customers || [];
      renderCustomers();
    })
    .catch(function(err) {
      showMsg("customersMsg", err.message || "Kunden konnten nicht geladen werden.", "danger");
    });
}

function filterCustomers(list) {
  var q = CUSTOMERS_QUERY.trim().toLowerCase();
  if (!q) return list;
  return list.filter(function(c) {
    return (c.name || "").toLowerCase().indexOf(q) !== -1 ||
           (c.email || "").toLowerCase().indexOf(q) !== -1 ||
           (c.username || "").toLowerCase().indexOf(q) !== -1;
  });
}

function renderCustomers() {
  var body = document.getElementById("customersBody");
  var noCustomers = document.getElementById("noCustomers");
  var tableWrap = document.getElementById("customersTableWrap");
  if (!body) return;
  var all = window.ADMIN_CUSTOMERS || [];
  var customers = filterCustomers(all);

  if (all.length === 0) {
    if (noCustomers) noCustomers.classList.remove("d-none");
    if (tableWrap) tableWrap.classList.add("d-none");
    body.innerHTML = "";
    return;
  }
  if (noCustomers) noCustomers.classList.add("d-none");
  if (tableWrap) tableWrap.classList.remove("d-none");

  body.innerHTML = customers.map(function(c) {
    var roleBadge = c.role === "admin"
      ? '<span class="badge bg-danger">Admin</span>'
      : '<span class="badge bg-secondary">Kunde</span>';
    var regDate = c.created_at ? new Date(c.created_at).toLocaleDateString("de-DE") : "–";
    return (
      "<tr>" +
      "<td><strong>" + esc(c.name || "–") + "</strong></td>" +
      "<td>" + (c.email ? '<a href="mailto:' + esc(c.email) + '">' + esc(c.email) + "</a>" : "–") + "</td>" +
      "<td>" + esc(c.phone || "–") + "</td>" +
      "<td><small class=\"text-muted\">" + esc(c.username) + "</small></td>" +
      "<td>" + roleBadge + "</td>" +
      "<td>" + (c.order_count || 0) + "</td>" +
      "<td>" + fmtMoney(c.total_spent) + "</td>" +
      "<td><small class=\"text-muted\">" + regDate + "</small></td>" +
      '<td class="text-end">' +
      '<button class="btn btn-sm btn-outline-irm customer-detail" data-id="' + c.id + '" title="Details anzeigen"><i class="bi bi-eye"></i></button>' +
      "</td>" +
      "</tr>"
    );
  }).join("");

  var searchEl = document.getElementById("customersSearch");
  if (searchEl && !searchEl._bound) {
    searchEl._bound = true;
    searchEl.addEventListener("input", function() {
      CUSTOMERS_QUERY = searchEl.value;
      renderCustomers();
    });
  }

  body.querySelectorAll(".customer-detail").forEach(function(btn) {
    btn.addEventListener("click", function() {
      showCustomerDetail(parseInt(btn.dataset.id));
    });
  });
}

function showCustomerDetail(userId) {
  var body = document.getElementById("customerDetailBody");
  if (!body) return;
  body.innerHTML = '<div class="text-center py-3"><span class="spinner-border spinner-border-sm"></span> Lade…</div>';
  adminApi("api/admin/customers/" + userId)
    .then(function(data) {
      var c = data.customer;
      var orders = data.orders || [];
      var regDate = c.created_at ? new Date(c.created_at).toLocaleString("de-DE") : "–";
      var roleBadge = c.role === "admin"
        ? '<span class="badge bg-danger">Admin</span>'
        : '<span class="badge bg-secondary">Kunde</span>';

      var ordersHtml = "";
      if (orders.length === 0) {
        ordersHtml = '<p class="text-muted small">Keine Bestellungen vorhanden.</p>';
      } else {
        ordersHtml =
          '<div class="table-responsive"><table class="table table-sm table-striped align-middle mb-0">' +
          '<thead><tr><th>Bestellnr.</th><th>Datum</th><th>Betrag</th><th>Status</th></tr></thead><tbody>' +
          orders.map(function(o) {
            var date = o.created_at ? new Date(o.created_at).toLocaleString("de-DE") : "–";
            var statusClass = STATUS_CLASS[o.status] || "bg-secondary";
            return (
              "<tr>" +
              "<td><strong>" + esc(o.order_no) + "</strong></td>" +
              "<td>" + date + "</td>" +
              "<td>" + fmtMoney(o.total) + "</td>" +
              '<td><span class="badge ' + statusClass + '">' + esc(o.status) + "</span></td>" +
              "</tr>"
            );
          }).join("") +
          "</tbody></table></div>";
      }

      body.innerHTML =
        '<div class="row g-3 mb-3">' +
        '<div class="col-md-6">' +
        '<div class="mb-2"><span class="text-muted small">Name:</span> <strong>' + esc(c.name || "–") + "</strong></div>" +
        '<div class="mb-2"><span class="text-muted small">E-Mail:</span> ' + (c.email ? '<a href="mailto:' + esc(c.email) + '">' + esc(c.email) + "</a>" : "–") + "</div>" +
        '<div class="mb-2"><span class="text-muted small">Telefon:</span> ' + esc(c.phone || "–") + "</div>" +
        '<div class="mb-2"><span class="text-muted small">Benutzername:</span> ' + esc(c.username) + "</div>" +
        "</div>" +
        '<div class="col-md-6">' +
        '<div class="mb-2"><span class="text-muted small">Rolle:</span> ' + roleBadge + "</div>" +
        '<div class="mb-2"><span class="text-muted small">Registriert:</span> ' + regDate + "</div>" +
        '<div class="mb-2"><span class="text-muted small">Bestellungen:</span> <strong>' + orders.length + "</strong></div>" +
        '<div class="mb-2"><span class="text-muted small">Gesamtumsatz:</span> <strong class="text-irm">' + fmtMoney(orders.reduce(function(s, o) { return s + (o.total || 0); }, 0)) + "</strong></div>" +
        "</div>" +
        "</div>" +
        '<h6 class="mb-2"><i class="bi bi-receipt"></i> Bestellhistorie</h6>' +
        ordersHtml;

      bootstrap.Modal.getOrCreateInstance(document.getElementById("customerDetailModal")).show();
    })
    .catch(function(err) {
      body.innerHTML = '<div class="alert alert-danger">' + esc(err.message) + "</div>";
    });
}
