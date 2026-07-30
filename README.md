<!--
HISTORIQUE DES VERSIONS

v7
- Ajout de « Exporter l’historique » sur chaque fiche véhicule.
- PDF au même format et avec la même mise en page que l’export du Carnet d’atelier.
- Inclusion des opérations personnelles et des opérations WheelerBrothers visibles sur la fiche.

v6
- Prise en charge de la désactivation globale d’un compte WB Carnet.
- Déconnexion immédiate d’une session active lorsque le compte est désactivé depuis WheelerBrothers.
- Blocage des créations et lectures par les règles Firestore tant que le compte est désactivé.
- Réactivation possible uniquement au moyen d’une nouvelle invitation WheelerBrothers valide.

v5.7
- Correction de l’activation des invitations avant accès à la fiche protégée.
-->

# WheelerBrothers Carnet v7

WB Carnet reste accessible uniquement après une invitation créée depuis WheelerBrothers Atelier.

Lorsqu’un compte est désactivé globalement, il est déconnecté, ne peut plus accéder à ses véhicules et ne peut plus créer d’opérations. Une nouvelle invitation valide peut le réactiver ; les anciens accès ne sont pas restaurés automatiquement.
