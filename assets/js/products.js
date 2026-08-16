const IRM_BASE_PRODUCTS = [
  { id: "salbei", name: "Salbei (Bio-Pflanze)", price: 3.5, category: "Heilkräuterpflanzen", desc: "Echte Salbeipflanze für Tee, Gurgelwasser und vieles mehr." },
  { id: "thymian", name: "Thymian (Bio-Pflanze)", price: 3.5, category: "Heilkräuterpflanzen", desc: "Aromatischer Thymian, bewährt bei Erkältungen." },
  { id: "rosmarin", name: "Rosmarin (Bio-Pflanze)", price: 3.5, category: "Heilkräuterpflanzen", desc: "Duftender Rosmarin für Küche und Kräutergarten." },
  { id: "melisse", name: "Zitronenmelisse (Bio-Pflanze)", price: 3.2, category: "Heilkräuterpflanzen", desc: "Beruhigendes Zitronenkraut für Tee und Tinkturen." },
  { id: "kamille", name: "Kamille (Bio-Pflanze)", price: 3.2, category: "Heilkräuterpflanzen", desc: "Die klassische Heilpflanze mit vielseitiger Wirkung." },
  { id: "lavendel", name: "Lavendel (Bio-Pflanze)", price: 3.5, category: "Heilkräuterpflanzen", desc: "Duftender Lavendel für Entspannung und Kübel." },
  { id: "minze", name: "Pfefferminze (Bio-Pflanze)", price: 3.2, category: "Heilkräuterpflanzen", desc: "Frische Pfefferminze, ideal für Tee und Erfrischung." },
  { id: "basilikum", name: "Basilikum (Bio-Topf)", price: 3.2, category: "Heilkräuterpflanzen", desc: "Aromatisches Basilikum, frisch für die Küche." },
  { id: "salbeitee", name: "Salbei-Kräutertee", price: 6.5, category: "Heilkräuter-Tees", desc: "Beruhigender Salbeitee aus eigenem Anbau, lose im Beutel." },
  { id: "kamillentee", name: "Kamillenblüten-Tee", price: 6.5, category: "Heilkräuter-Tees", desc: "Sanfter Kamillentee aus frisch geernteten Blüten." },
  { id: "minztee", name: "Pfefferminz-Tee", price: 6.0, category: "Heilkräuter-Tees", desc: "Erfrischend-klarer Pfefferminztee, handverlesen." },
  { id: "melissentee", name: "Melissen-Tee", price: 6.0, category: "Heilkräuter-Tees", desc: "Wohltuender Melissentee für ruhige Abende." },
  { id: "kraeuterbuendel", name: "Frisches Heilkräuterbündel", price: 4.0, category: "Heilkräuter-Tees", desc: "Saisonales Bündel mit verschiedenen frischen Heilkräutern." },
  { id: "ringelblume", name: "Ringelblume (Blume)", price: 2.0, category: "Blumen", desc: "Wunderschöne Ringelblumen für Bauerngarten und Beet." },
  { id: "kapuzinerkresse", name: "Kapuzinerkresse (Blume)", price: 2.0, category: "Blumen", desc: "Bunte Bauerngartenblume, auch genießbar." },
];

window.IRM_BASE_PRODUCTS = IRM_BASE_PRODUCTS;
window.PRODUCTS = IRM_BASE_PRODUCTS.slice();

function loadProducts() {
  const embedded = document.getElementById("product-data");
  if (embedded) {
    try {
      window.PRODUCTS = [JSON.parse(embedded.textContent)];
      return Promise.resolve(window.PRODUCTS);
    } catch (e) {
      /* fall back to API */
    }
  }
  return fetch("/api/products", { headers: { Accept: "application/json" } })
    .then((r) => {
      if (!r.ok) throw new Error("Produkte konnten nicht geladen werden.");
      return r.json().catch(() => []);
    })
    .then((data) => {
      const base = {};
      IRM_BASE_PRODUCTS.forEach((p) => (base[p.id] = p));
      window.PRODUCTS = (data.products || []).map((p) => Object.assign({}, base[p.id] || {}, p));
      return window.PRODUCTS;
    })
    .catch(() => {
      window.PRODUCTS = IRM_BASE_PRODUCTS.slice();
      return window.PRODUCTS;
    });
}

window.loadProducts = loadProducts;
