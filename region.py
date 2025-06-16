import requests
import pandas as pd

# URL de base de l'API Opendatasoft
url = "https://ressources.data.sncf.com/api/records/1.0/search/"

# Paramètres pour filtrer les données de 2025 et la région Grand Est
params = {
    'dataset': 'regularite-mensuelle-ter',
    'rows': 1000,  # nombre d'enregistrements à récupérer
    'sort': 'date',
    'refine.date': '2025',
    'refine.region': 'Grand Est'
}

# Requête HTTP GET
response = requests.get(url, params=params)

# Vérification
if response.status_code == 200:
    data = response.json()
    records = data['records']
    
    # On extrait uniquement les fields
    records_data = [record['fields'] for record in records]
    
    # Chargement dans un DataFrame pandas
    df = pd.DataFrame(records_data)
    
    # Affichage du tableau
    print(df)
    
else:
    print("Erreur de récupération:", response.status_code)
