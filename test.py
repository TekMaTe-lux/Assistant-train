import requests

# Liste des numéros de train
train_numbers = [
    88700, 88770, 88702, 88704, 88706, 88708, 88710, 88802, 88712, 88501, 
    88804, 88714, 88503, 88806, 88716, 88505, 88718, 88571, 88722, 88724, 
    88726, 88730, 88720, 88734, 88509, 88736, 88738, 88511, 837680, 837682, 
    88513, 88740, 88727, 88729
]

# URL de l'API pour récupérer les détails de chaque train
base_url = "https://api.sncf.com/v1/coverage/sncf/trips/SNCF:2025-05-13:{}:1187:Train"

# Fonction pour récupérer et afficher les informations pour chaque train
def get_train_info(train_number):
    # Construire l'URL pour ce numéro de train
    api_url = base_url.format(train_number)
    
    # Faire l'appel API pour récupérer les données
    response = requests.get(api_url)
    
    # Vérifier si l'appel API a réussi (code 200)
    if response.status_code == 200:
        train_data = response.json()
        
        # Affichage des informations de perturbation si disponibles
        print(f"Train {train_number}:")
        if 'disruptions' in train_data and len(train_data['disruptions']) > 0:
            for disruption in train_data['disruptions']:
                print(f"  - Perturbation: {disruption['severity']['name']}")
                print(f"  - Cause: {disruption['messages'][0]['text']}")
        else:
            print("  - Pas de perturbation")
        
        # Affichage des arrêts et horaires du train
        for stop in train_data['vehicle_journeys'][0]['stop_times']:
            stop_point = stop['stop_point']
            print(f"  - Arrêt à {stop_point['label']} à {stop['arrival_time']}")
        
        print("\n" + "-"*40 + "\n")
    else:
        print(f"Erreur pour le train {train_number}: {response.status_code}")

# Appel de la fonction pour chaque train
for train_number in train_numbers:
    get_train_info(train_number)
