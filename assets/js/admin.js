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
    .replace(/"/g, "&quot;");
}

function adminApi(path, method, body) {
  const headers = { Accept: "application/json", "Content-Type": "application/json" };
  const token = localStorage.getItem(ADMIN_TOKEN_KEY);
  if (token) headers.Authorization = "Bearer " + token;
  const opts = { method: method || "GET", headers };
  if (body !== undefined) opts.body = JSON.stringify(body);
  return fetch(path, opts).then((res) =>
    res.json().then((data) => {
      if (!res.ok) throw new Error(data.error || "Anfrage fehlgeschlagen.");
      return data;
    })
  );
}

function adminUpload(path, file) {
  const fd = new FormData();
  fd.append("file", file);
  const headers = { Accept: "application/json" };
  const token = localStorage.getItem(ADMIN_TOKEN_KEY);
  if (token) headers.Authorization = "Bearer " + token;
  return fetch(path, { method: "POST", headers, body: fd }).then((res) =>
    res.json().then((data) => {
      if (!res.ok) throw new Error(data.error || "Upload fehlgeschlagen.");
      return data;
    })
  );
}

function adminLoggedIn() {
  return !!localStorage.getItem(ADMIN_TOKEN_KEY);
}

function adminLogout() {
  const token = localStorage.getItem(ADMIN_TOKEN_KEY);
  if (token) {
    fetch("api/logout", { method: "POST", headers: { Authorization: "Bearer " + token } }).catch(() => {});
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
  if (ordersPanel) ordersPanel.classList.toggle("d-none", tab !== "orders");
  if (inventory) inventory.classList.toggle("d-none", tab !== "inventory");
  if (messagesPanel) messagesPanel.classList.toggle("d-none", tab !== "messages");
  if (statsPanel) statsPanel.classList.toggle("d-none", tab !== "stats");
  if (tab === "inventory") renderInventory();
  if (tab === "messages") renderMessages();
  if (tab === "stats") loadStats();
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

function renderDashboard() {
  const orders = window.ADMIN_ORDERS || [];
  const body = document.getElementById("ordersBody");
  const noOrders = document.getElementById("noOrders");
  const tableWrap = document.getElementById("ordersTableWrap");

  document.getElementById("statTotal").textContent = orders.length;
  document.getElementById("statOpen").textContent = orders.filter((o) => o.status !== "Abgeschlossen").length;
  const revenue = orders.reduce((sum, o) => sum + (o.refunded ? 0 : o.total || 0), 0);
  document.getElementById("statRevenue").textContent = fmtMoney(revenue);

  if (orders.length === 0) {
    if (noOrders) noOrders.classList.remove("d-none");
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
        "<td>" + esc(o.user || "") + "</td>" +
        "<td>" + items + "</td>" +
        "<td>" + fmtMoney(o.total) + "</td>" +
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
      return (
        "<tr>" +
        "<td>" + esc(p.name) + (p.custom ? ' <span class="badge bg-info text-dark">eigen</span>' : "") + "</td>" +
        "<td><small class=\"text-muted\">" + esc(p.category) + "</small></td>" +
        "<td>" + badge + "</td>" +
        '<td style="max-width:130px;"><input type="number" min="0" step="1" class="form-control form-control-sm stock-input" data-id="' + esc(p.id) + '" placeholder="Anzahl" value="' + (cur === null ? "" : cur) + '"></td>' +
        '<td style="max-width:110px;"><input type="number" min="0" step="0.1" class="form-control form-control-sm price-input" data-id="' + esc(p.id) + '" value="' + p.price.toFixed(2) + '"></td>' +
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
  const body = document.getElementById("statsTopBody");
  if (!s) return;
  if (totalEl) totalEl.textContent = (s.total || 0).toLocaleString("de-DE");
  if (todayEl) todayEl.textContent = (s.today || 0).toLocaleString("de-DE");
  if (weekEl) weekEl.textContent = (s.week || 0).toLocaleString("de-DE");
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
