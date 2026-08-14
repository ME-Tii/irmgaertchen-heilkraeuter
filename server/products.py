SHIPPING_COST_CENTS = 590
FREE_SHIPPING_FROM_CENTS = 4000


def shipping_fee_cents(subtotal_cents):
    if subtotal_cents >= FREE_SHIPPING_FROM_CENTS:
        return 0
    return SHIPPING_COST_CENTS


# id -> {name, category, price_cents, desc}
CATALOG = {
    "salbei": {"name": "Salbei (Bio-Pflanze)", "category": "Heilkräuterpflanzen", "price_cents": 350, "desc": "Echte Salbeipflanze für Tee, Gurgelwasser und vieles mehr."},
    "thymian": {"name": "Thymian (Bio-Pflanze)", "category": "Heilkräuterpflanzen", "price_cents": 350, "desc": "Aromatischer Thymian, bewährt bei Erkältungen."},
    "rosmarin": {"name": "Rosmarin (Bio-Pflanze)", "category": "Heilkräuterpflanzen", "price_cents": 350, "desc": "Duftender Rosmarin für Küche und Kräutergarten."},
    "melisse": {"name": "Zitronenmelisse (Bio-Pflanze)", "category": "Heilkräuterpflanzen", "price_cents": 320, "desc": "Beruhigendes Zitronenkraut für Tee und Tinkturen."},
    "kamille": {"name": "Kamille (Bio-Pflanze)", "category": "Heilkräuterpflanzen", "price_cents": 320, "desc": "Die klassische Heilpflanze mit vielseitiger Wirkung."},
    "lavendel": {"name": "Lavendel (Bio-Pflanze)", "category": "Heilkräuterpflanzen", "price_cents": 350, "desc": "Duftender Lavendel für Entspannung und Kübel."},
    "minze": {"name": "Pfefferminze (Bio-Pflanze)", "category": "Heilkräuterpflanzen", "price_cents": 320, "desc": "Frische Pfefferminze, ideal für Tee und Erfrischung."},
    "basilikum": {"name": "Basilikum (Bio-Topf)", "category": "Heilkräuterpflanzen", "price_cents": 320, "desc": "Aromatisches Basilikum, frisch für die Küche."},
    "salbeitee": {"name": "Salbei-Kräutertee", "category": "Heilkräuter-Tees", "price_cents": 650, "desc": "Beruhigender Salbeitee aus eigenem Anbau, lose im Beutel."},
    "kamillentee": {"name": "Kamillenblüten-Tee", "category": "Heilkräuter-Tees", "price_cents": 650, "desc": "Sanfter Kamillentee aus frisch geernteten Blüten."},
    "minztee": {"name": "Pfefferminz-Tee", "category": "Heilkräuter-Tees", "price_cents": 600, "desc": "Erfrischend-klarer Pfefferminztee, handverlesen."},
    "melissentee": {"name": "Melissen-Tee", "category": "Heilkräuter-Tees", "price_cents": 600, "desc": "Wohltuender Melissentee für ruhige Abende."},
    "kraeuterbuendel": {"name": "Frisches Heilkräuterbündel", "category": "Heilkräuter-Tees", "price_cents": 400, "desc": "Saisonales Bündel mit verschiedenen frischen Heilkräutern."},
    "ringelblume": {"name": "Ringelblume (Blume)", "category": "Blumen", "price_cents": 200, "desc": "Wunderschöne Ringelblumen für Bauerngarten und Beet."},
    "kapuzinerkresse": {"name": "Kapuzinerkresse (Blume)", "category": "Blumen", "price_cents": 200, "desc": "Bunte Bauerngartenblume, auch genießbar."},
}
