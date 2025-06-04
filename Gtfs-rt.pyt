tes"] = stu.arrival.delay // 60
            if stu.HasField("departure") and stu.departure.HasField("delay"):
                data["departure_delay_minutes"] = stu.departure.delay // 60

            if "arrival_delay_minutes" in data or "departure_delay_minutes" in data:
                retard_trip.append(data)
                if stop_id_clean in gares_nancy_metz_lux:
                    contient_gare_region = True

        if contient_gare_region and retard_trip:
            trains_filtrés_groupés[train_number]["train_id"] = trip_id_complet
            trains_filtrés_groupés[train_number]["train_number"] = train_number
            trains_filtrés_groupés[train_number]["stops"].extend(retard_trip)

# --- Préparation JSON simplifié pour tableau HTML ---
retards_simplifie = {}

for train in trains_filtrés_groupés.values():
    numero = train["train_number"]
    retards_simplifie[numero] = {}

    for stop in train["stops"]:
        nom = stop["stop_name"]
        delay = stop.get("arrival_delay_minutes", stop.get("departure_delay_minutes", 0))
        retards_simplifie[numero][nom] = delay

# --- Enregistrement du fichier simplifié ---
os.makedirs("Assistant-train", exist_ok=True)
with open("Assistant-train/retards_nancymetzlux.json", "w", encoding="utf-8") as f:
    json.dump(retards_simplifie, f, ensure_ascii=False, indent=2)

print(f"{len(retards_simplifie)} trains enregistrés dans retards_nancymetzlux.json (format simplifié)")
