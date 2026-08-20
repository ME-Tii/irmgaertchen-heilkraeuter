SHIPPING_COST_CENTS = 590
FREE_SHIPPING_FROM_CENTS = 4000


def shipping_fee_cents(subtotal_cents):
    if subtotal_cents >= FREE_SHIPPING_FROM_CENTS:
        return 0
    return SHIPPING_COST_CENTS


# id -> {name, category, price_cents, desc, image}
CATALOG = {
    "salbei": {"name": "Salbei (Bio-Pflanze)", "category": "Heilkräuterpflanzen", "price_cents": 350, "desc": "Echte Salbeipflanze für Tee, Gurgelwasser und vieles mehr.", "image": "salbei.jpg"},
    "thymian": {"name": "Thymian (Bio-Pflanze)", "category": "Heilkräuterpflanzen", "price_cents": 350, "desc": "Aromatischer Thymian, bewährt bei Erkältungen.", "image": "thymian.jpg"},
    "rosmarin": {"name": "Rosmarin (Bio-Pflanze)", "category": "Heilkräuterpflanzen", "price_cents": 350, "desc": "Duftender Rosmarin für Küche und Kräutergarten.", "image": "rosmarin.jpg"},
    "melisse": {"name": "Zitronenmelisse (Bio-Pflanze)", "category": "Heilkräuterpflanzen", "price_cents": 320, "desc": "Beruhigendes Zitronenkraut für Tee und Tinkturen.", "image": "melisse.jpg"},
    "kamille": {"name": "Kamille (Bio-Pflanze)", "category": "Heilkräuterpflanzen", "price_cents": 320, "desc": "Die klassische Heilpflanze mit vielseitiger Wirkung.", "image": "kamille.jpg"},
    "lavendel": {"name": "Lavendel (Bio-Pflanze)", "category": "Heilkräuterpflanzen", "price_cents": 350, "desc": "Duftender Lavendel für Entspannung und Kübel.", "image": "lavendel.jpg"},
    "minze": {"name": "Pfefferminze (Bio-Pflanze)", "category": "Heilkräuterpflanzen", "price_cents": 320, "desc": "Frische Pfefferminze, ideal für Tee und Erfrischung.", "image": "minze.jpg"},
    "basilikum": {"name": "Basilikum (Bio-Topf)", "category": "Heilkräuterpflanzen", "price_cents": 320, "desc": "Aromatisches Basilikum, frisch für die Küche.", "image": "basilikum.jpg"},
    "salbeitee": {"name": "Salbei-Kräutertee", "category": "Heilkräuter-Tees", "price_cents": 650, "desc": "Beruhigender Salbeitee aus eigenem Anbau, lose im Beutel.", "image": "salbei.jpg"},
    "kamillentee": {"name": "Kamillenblüten-Tee", "category": "Heilkräuter-Tees", "price_cents": 650, "desc": "Sanfter Kamillentee aus frisch geernteten Blüten.", "image": "kamille.jpg"},
    "minztee": {"name": "Pfefferminz-Tee", "category": "Heilkräuter-Tees", "price_cents": 600, "desc": "Erfrischend-klarer Pfefferminztee, handverlesen.", "image": "minze.jpg"},
    "melissentee": {"name": "Melissen-Tee", "category": "Heilkräuter-Tees", "price_cents": 600, "desc": "Wohltuender Melissentee für ruhige Abende.", "image": "melisse.jpg"},
    "kraeuterbuendel": {"name": "Frisches Heilkräuterbündel", "category": "Heilkräuter-Tees", "price_cents": 400, "desc": "Saisonales Bündel mit verschiedenen frischen Heilkräutern.", "image": "kraeuterbuendel.jpg"},
    "ringelblume": {"name": "Ringelblume (Blume)", "category": "Blumen", "price_cents": 200, "desc": "Wunderschöne Ringelblumen für Bauerngarten und Beet.", "image": "ringelblume.jpg"},
    "kapuzinerkresse": {"name": "Kapuzinerkresse (Blume)", "category": "Blumen", "price_cents": 200, "desc": "Bunte Bauerngartenblume, auch genießbar.", "image": "kapuzinerkresse.jpg"},
}
