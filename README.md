# Photon

Galerie photo locale, sombre et néon, pilotable à la manette Xbox.

Tout tourne sur votre ordinateur : aucune photo n'est envoyée nulle part, aucun
compte, aucune connexion Internet requise. Vos fichiers ne sont **jamais**
déplacés, copiés ni supprimés — Photon se contente de les lire là où ils sont.

---

## Démarrer

**Windows** — double-cliquez sur `start.bat`. La première fois, il installe les
dépendances et construit l'interface (une minute environ), puis ouvre le
navigateur.

**Linux / macOS** — `./start.sh`

> Si la fenêtre se ferme aussitôt, ou que rien ne semble se passer, ouvrez une
> invite de commandes dans le dossier (barre d'adresse de l'explorateur → tapez
> `cmd` → Entrée) et lancez `start.bat` depuis là : les messages d'erreur
> resteront affichés. Voir aussi *Si ça ne démarre pas* plus bas.

Ensuite, ouvrez la roue dentée (en haut à droite) → **Dossiers**, et indiquez le
chemin complet de votre dossier de photos, par exemple `C:\Users\moi\Images`.
Le scan démarre tout seul.

### Depuis un autre appareil du réseau

Au démarrage, Photon affiche une deuxième adresse du type
`http://192.168.1.42:7777`. Tapez-la dans le navigateur d'un téléphone, d'une
tablette ou d'un autre PC connecté au même Wi-Fi : c'est la même bibliothèque,
avec la même interface, tactile en prime.

---

## Les commandes

| Geste | Manette | Clavier | Souris |
|---|---|---|---|
| Parcourir la barre du haut | stick gauche ← →, LT / RT, croix directionnelle | ← → | survol |
| Descendre dans la page | stick gauche ↓ | ↓ | molette |
| Sélectionner / ouvrir | **A** | Entrée | clic |
| Retour | **B** | Échap | — |
| Ajouter à un album | **Y** | — | bouton **+** sur la photo |
| Cacher (ou retirer de l'album) | **X** | — | bouton ⦰ sur la photo |
| Plus / moins (mois, volume, thème, taille des vignettes) | **LB** / **RB** | `[` `]` ou `-` `=` | clic |
| Mode sélection multiple | bouton **Back** | **Alt+S** | clic droit → Sélection |
| Menu contextuel | — | — | clic droit |

Les deux barres verticales n'apparaissent que lorsque leur bouton est
surligné : **Chercher** à gauche, **Paramètres** à droite. Par défaut, ↑ et ↓
font défiler la chronologie principale.

Sur une photo surlignée, les trois actions forment un cercle qui reprend la
disposition de la manette : **Y** en haut, **X** à gauche, **A** en bas.

### La manette

Une manette Xbox 360 avec récepteur Windows fonctionne telle quelle : le
navigateur la voit via XInput. Deux détails à connaître —

* la page doit avoir le focus (cliquez dedans une fois) ;
* le navigateur n'expose la manette qu'**après une première pression de bouton**.
  Appuyez sur A, et l'icône de manette apparaît en bas à droite.

---

## Ce que fait chaque bouton du haut

* **Chercher** — filtre la chronologie par période (`de` mois/année `à`
  mois/année, bornes incluses), par lieu et par tags. Sur `[Jan]` ou `[2026]` :
  LB/RB pour avancer d'un cran, **A** pour ouvrir le carrousel complet.
* **Albums** — la grille de tous les albums.
* **Favoris** — un album comme les autres, simplement épinglé. On y ajoute une
  photo par **Y** → *Favoris*.
* **Vidéos** — la même chronologie, vidéos seulement.
* **Nouvel album** — nom, couleur, musique, tags.
* **Les deux tuiles suivantes** — les albums les plus récents. LB/RB pour
  faire défiler les suivants.
* **Paramètres** — taille du texte, volume, thème, admin, dossiers, langue.

## Albums

Créez, renommez, changez la couleur ou la musique, choisissez la photo de
couverture (clic droit sur une photo dans l'album → *Définir comme couverture*),
supprimez l'album — les photos, elles, restent dans la bibliothèque.

La couleur de l'album remplace la couleur globale tant qu'on est dedans : le
liseré néon des photos et les boutons prennent sa teinte.

## Musique

Dans **Paramètres → Dossiers**, ajoutez un dossier de type *musique* contenant
`1.mp3`, `2.mp3`, … `5.mp3`. Chaque album peut alors pointer vers l'un des cinq
emplacements ; la piste démarre en boucle à l'ouverture de l'album, au volume
réglé dans les paramètres. (Le navigateur exige une première interaction avant
d'autoriser le son — un clic suffit.)

## Tags

Les tags s'ajoutent à la main : clic droit sur une photo → **Modifier les
tags**. En mode sélection multiple, le tag s'applique à toute la sélection d'un
coup. Un album peut lui aussi porter des tags.

## Lieux

Si vos photos contiennent des coordonnées GPS, Photon les traduit en nom de
ville **hors ligne**, grâce à une base de 135 000 villes embarquée. Une photo
prise aux chutes Sherman ressort en « Hamilton, Ontario, Canada », traduit selon
la langue choisie. Aucune requête réseau n'est faite.

À population comparable, la ville la plus proche gagne ; à distance comparable,
la plus peuplée gagne — sinon une photo prise à Vancouver ressortirait au nom du
quartier voisin.

## Cacher plutôt que supprimer

Photon ne supprime jamais un fichier. **X** (ou le menu contextuel) *cache* une
photo : elle disparaît des vues, le fichier reste intact sur le disque. Pour les
revoir : **Paramètres → Voir les photos cachées** (admin).

## Admin

L'application écoute sur le réseau local, donc masquer un bouton ne protège
rien : toutes les opérations sensibles sont vérifiées **côté serveur**.

Au premier démarrage il n'y a pas de mot de passe et tout est ouvert. Dès que
vous en choisissez un (Paramètres → Admin), les actions suivantes exigent d'être
déverrouillé : cacher une photo, gérer les albums, modifier les tags, configurer
les dossiers. Les autres appareils du Wi-Fi peuvent alors regarder, sans rien
modifier.

---

## Essayer sans ses vraies photos

```
npm run seed
```

Génère `demo-photos/` : 50 images avec de vrais EXIF (date de prise de vue,
appareil, GPS à Hamilton, Montréal, Vancouver et Séoul) et 3 courtes vidéos.
Ajoutez ce dossier dans les réglages pour voir l'application remplie.

## Sous le capot

* **Serveur** — Node.js + Fastify, base SQLite, `sharp` pour les vignettes,
  `exifr` pour les métadonnées, `ffmpeg` (fourni) pour les vignettes et la durée
  des vidéos.
* **Interface** — React + Vite, CSS maison, aucune dépendance de composants.
* **Données** — la base et les vignettes vivent dans
  `%APPDATA%\Photon` (Windows) ou `~/.local/share/photon` (Linux).
  Supprimez ce dossier pour repartir de zéro : vos photos ne bougent pas.

### Réglages par variables d'environnement

| Variable | Effet |
|---|---|
| `PHOTON_PORT` | port d'écoute (défaut `7777`) |
| `PHOTON_HOST` | interface d'écoute (défaut `0.0.0.0`, tout le réseau local) |
| `PHOTON_DATA_DIR` | emplacement de la base et des vignettes |
| `PHOTON_OPEN=0` | ne pas ouvrir le navigateur au démarrage |

### Développement

```
npm run dev        # serveur + interface avec rechargement à chaud
npm run typecheck  # vérification TypeScript des deux côtés
```

## Si ça ne démarre pas

Ouvrez une invite de commandes dans le dossier du projet et lancez les étapes
une par une — chacune affiche son erreur :

```
node -v          rem doit repondre v20 ou plus ; sinon installez Node LTS
npm install
npm run build
npm start
```

* **`node` n'est pas reconnu** — Node.js n'est pas installé, ou pas dans le
  PATH. Installez la version **LTS** depuis <https://nodejs.org>, puis rouvrez
  une nouvelle invite de commandes (l'ancienne garde l'ancien PATH).
* **Le port 7777 est déjà pris** — lancez avec un autre port :
  `set PHOTON_PORT=7788 && npm start`
* **La fenêtre se ferme instantanément** — c'est le symptôme d'un `start.bat`
  dont les fins de ligne ont été converties en LF. Le dépôt force le CRLF via
  `.gitattributes` ; si vous avez édité le fichier, réenregistrez-le en CRLF.
* **Le pare-feu Windows demande une autorisation au premier lancement** —
  acceptez pour le réseau privé, sinon les autres appareils du Wi-Fi ne
  pourront pas se connecter.

## Limites connues

* Les photos **HEIC** (iPhone) sont décodées par une bibliothèque JavaScript de
  secours : la première génération de vignettes est nettement plus lente que
  pour du JPEG. Une fois faites, elles sont en cache.
* Le curseur de dates **ancre** la chronologie au mois choisi (elle démarre là).
  Pour revenir au plus récent, le bouton *Aujourd'hui* en haut à droite.
* Le champ « TBD » de la barre de recherche est resté vide, comme convenu.
* Les dossiers s'ajoutent en tapant leur chemin : un navigateur ne peut pas
  ouvrir de sélecteur de dossiers système sans y être autorisé fichier par
  fichier.
