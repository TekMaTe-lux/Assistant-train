// Ta clé API
const apiKey = '242fac11-6d98-45fb-93df-28174d362447'; // Ajoute ta clé ici
const apiUrl = 'https://api.sncf.com/v1/coverage/sncf/stop_areas/stop_area:SNCF:82001000/arrivals';

// Fonction pour formater la date dans le format attendu par l'API (yyyy-MM-ddTHH:mm:ss)
function formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');

    return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
}

// Récupérer la date actuelle
const currentDateTime = formatDate(new Date());

// Fonction pour obtenir les arrivées des trains depuis l'API
async function getTrainArrivals() {
    try {
        const response = await fetch(`${apiUrl}?datetime=${currentDateTime}`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${apiKey}`
            }
        });

        const data = await response.json();
        updateTrainArrivals(data);
    } catch (error) {
        console.error("Erreur lors de la récupération des données : ", error);
        document.getElementById('train-arrivals').innerHTML = '<p>Erreur de chargement des données.</p>';
    }
}

// Fonction pour mettre à jour le contenu HTML avec les arrivées des trains
function updateTrainArrivals(data) {
    const arrivalsContainer = document.getElementById('train-arrivals');
    arrivalsContainer.innerHTML = '';  // Efface le contenu précédent

    if (data && data.arrivals && data.arrivals.length > 0) {
        const list = document.createElement('ul');

        data.arrivals.forEach(train => {
            const listItem = document.createElement('li');
            const trainInfo = `
                <strong>Train ${train.trip.short_id}</strong><br>
                Destination: ${train.stop_area.name}<br>
                Heure d'arrivée: ${train.expectedArrivalTime}<br>
                Statut: ${train.status}
            `;
            listItem.innerHTML = trainInfo;
            list.appendChild(listItem);
        });

        arrivalsContainer.appendChild(list);
    } else {
        arrivalsContainer.innerHTML = '<p>Aucune arrivée pour l\'instant.</p>';
    }
}

// Appel initial pour charger les arrivées des trains
getTrainArrivals();

// Mise à jour automatique toutes les 5 minutes (300000 ms)
setInterval(getTrainArrivals, 300000);
