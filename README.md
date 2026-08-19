<!--
HISTORIQUE DES VERSIONS

v8.3
- Suppression de la création de véhicules depuis WB Carnet.
- Les nouvelles fiches véhicule proviennent désormais uniquement de WheelerBrothers – Atelier.
- Les anciennes fiches personnelles existantes restent accessibles et ne sont pas supprimées.
- Le formulaire de création est verrouillé côté application, y compris s’il est appelé sans passer par l’interface.

v8.2
- Correction de l’export PDF de l’historique lorsqu’une opération est trop longue pour tenir sur une page.
- Une opération longue commence désormais dans l’espace disponible puis continue sur la page suivante.
- L’en-tête du tableau est répété sur chaque page de continuation.
- La date et le kilométrage restent affichés uniquement au début de l’opération.

v8.1
- Le titre de l’en-tête devient simplement « Carnet ».
- La version est déplacée sous la carte « Mon compte ».
- Ajout d’une pastille verte ou rouge indiquant l’état de connexion Firebase.

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

# WheelerBrothers Carnet — version 8.3

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
