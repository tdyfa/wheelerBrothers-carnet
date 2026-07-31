<!--
HISTORIQUE DES VERSIONS

v8
- Ajout du bouton Rapport sur les opérations issues du Générateur WheelerBrothers.
- Chargement sécurisé du rapport source et de ses photos.
- Génération locale du PDF avec le même moteur et la même mise en page que l’Atelier.
- Aucun PDF supplémentaire stocké dans Firebase.

v7
- Export de l’historique complet d’un véhicule.

v6
- Désactivation globale d’un compte WB Carnet.
-->

# WheelerBrothers Carnet — version 8

WB Carnet reste accessible uniquement après une invitation créée depuis WheelerBrothers Atelier.

## Bouton Rapport

Une opération synchronisée depuis un rapport affiche le bouton **Rapport**. Lors du clic :

1. WB Carnet vérifie que le compte possède toujours un accès actif au véhicule ;
2. le rapport source est récupéré dans Firestore ;
3. ses photos existantes sont chargées depuis Firebase Storage ;
4. le PDF est généré localement avec la mise en page du Générateur WheelerBrothers ;
5. le fichier est téléchargé sur l’appareil.

Aucun PDF n’est conservé dans Firebase.

## Déploiement

Placer tous les fichiers à la racine du dépôt GitHub Pages `wheelerBrothers-carnet`.

Publier ensuite les règles Firestore et Storage fournies dans le dossier Firebase du paquet complet.
