# WheelerBrothers Carnet — v1

Nom complet de la PWA : **WheelerBrothers Carnet**  
Nom court sous l'icône : **WB Carnet**

## Publication

Le code suppose que le dépôt GitHub Pages s'appelle exactement :

```text
wheelerBrothers-carnet
```

URL prévue :

```text
https://tdyfa.github.io/wheelerBrothers-carnet/
```

1. Créer le dépôt `wheelerBrothers-carnet`.
2. Déposer tous les fichiers de ce dossier à la racine du dépôt.
3. Dans `Settings → Pages`, publier la branche `main`, dossier `/ (root)`.
4. Appliquer la configuration du dossier `../Firebase/`.

Si le nom du dépôt ou l'URL change, modifier `WB_CARNET_PUBLIC_URL` dans `firebase-config.js` et `CLIENT_URL` dans `wb-carnet-pro.js` de WheelerBrothers.

## Fonctionnement inclus

- connexion par numéro français et code SMS Firebase ;
- session conservée sur l'appareil ;
- activation d'un lien d'invitation dont le numéro est verrouillé ;
- lien consommé uniquement après validation réussie du code ;
- expiration après 24 heures ;
- liste **Mes véhicules** ;
- création et modification d'une fiche personnelle ;
- ajout, modification et suppression des opérations personnelles par leur auteur ;
- partage d'un véhicule avec plusieurs proches ;
- révocation indépendante de chaque accès ;
- historique commun visible par toutes les personnes autorisées ;
- opérations WheelerBrothers en lecture seule, sans temps passé ni rémunération ;
- fusion sécurisée avec une fiche personnelle de même immatriculation au moment de l'activation d'une invitation.

## Immatriculation et fusion

Les variantes suivantes produisent la même clé de rapprochement :

```text
AB-123-CD
ab 123 cd
AB123CD
```

L'immatriculation sert à détecter une fiche personnelle appartenant déjà à la personne qui accepte l'invitation. Les droits restent attachés à un identifiant Firestore interne et non directement à la plaque.

## Données non incluses dans la v1

WB Carnet v1 n'utilise pas Firebase Storage : aucune photo et aucune pièce jointe ne sont envoyées.
