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
| Parcourir la barre du haut | stick gauche ← →, croix directionnelle | ← → | survol |
| Revenir à la barre du haut depuis n'importe où | **LT / RT** | — | — |
| Descendre dans la page | stick gauche ↓ | ↓ | molette |
| Sélectionner / ouvrir | **A** | Entrée | clic |
| Retour | **B** | Échap | — |
| Ajouter à un album | **Y** | — | bouton **+** sur la photo |
| Cacher (ou retirer de l'album) | **X** | — | bouton ⦰ sur la photo |
| Plus / moins (mois, volume, thème, taille des vignettes) | **LB** / **RB** | `[` `]` ou `-` `=` | clic |
| Mode sélection multiple | bouton **Back** | **Alt+S** | clic droit → Sélection |
| Définir la photo affichée comme couverture | **LS** (clic du stick gauche) | — | Modifier l'album → couverture |
| Menu contextuel | — | — | clic droit |

Les deux barres verticales n'apparaissent que lorsque leur bouton est
surligné : **Chercher** à gauche, **Paramètres** à droite. Elles se posent
**par-dessus** les photos : la grille occupe toute la largeur de l'écran en
permanence et ne se décale jamais quand une barre s'ouvre ou se ferme. Par
défaut, ↑ et ↓ font défiler la chronologie principale.

**LT et RT sont réservées à la barre du haut.** Où que vous soyez — dans les
filtres, dans les réglages, dans la grille — elles font passer au bouton
précédent ou suivant, et referment au passage la barre latérale ouverte. La
croix directionnelle et le stick, eux, restent locaux : à l'intérieur d'une
barre, ← et → passent d'un champ à l'autre, par exemple de `[avr.]` à `[2018]`.

Tout est aussi cliquable à la souris, y compris à l'intérieur des barres :
les pastilles de date, les cases de volume, les teintes, les drapeaux.

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

* **Accueil** — la chronologie complète, le point de départ.
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

## Envoyer des photos depuis un téléphone

Ouvrez Photon dans le navigateur du téléphone (l'adresse `192.168.…` affichée au
démarrage), puis le bouton **Envoyer des photos**. Sélectionnez tout ce que vous
voulez, même la pellicule entière : ce qui a déjà été reçu est écarté avant tout
transfert, seules les nouveautés montent.

Les fichiers sont rangés sur le PC par date de prise de vue, dans le **dossier
de réception** défini dans Paramètres → Dossiers :

```
Recu\2026\7 - Juil\IMG_0042.jpg
Recu\2025\12 - Dec\IMG_0007.jpg
```

L'envoi est ouvert à tout le réseau local par défaut — c'est l'intérêt, que la
famille puisse envoyer sans mot de passe. Une bascule dans la gestion des
dossiers permet de le réserver à l'admin.

### Une photo supprimée ne revient jamais

Photon garde l'empreinte de chaque fichier reçu, même après que le fichier a
disparu du disque. Si vous supprimez une photo sur le PC, elle ne remontera
plus, quelle que soit le nombre de fois où vous resélectionnez la pellicule. La
seule façon d'ajouter reste l'envoi ; la seule façon d'enlever reste le PC.

### Boîte de dépôt et synchronisation automatique

Tout fichier déposé **à la racine** du dossier de réception est rangé
automatiquement dans son mois, en quelques secondes, sans rien lancer. Un câble,
un glisser-déposer, un partage réseau : ça marche pareil.

C'est aussi ce qui permet une vraie synchronisation automatique, que Photon ne
peut pas faire lui-même — un site web n'a pas le droit de lire le dossier photos
d'un téléphone, ni de s'exécuter en arrière-plan la nuit. Installez plutôt
**Syncthing** (gratuit, sur Android) et faites-lui déposer votre pellicule dans
le dossier de réception : Photon range et indexe le reste.

L'avantage de passer par la boîte de dépôt plutôt que par un dossier synchronisé
directement : Photon la vide au fur et à mesure, donc supprimer une photo sur le
PC ne la fait pas réapparaître au prochain cycle de synchronisation.

## Deux dispositions

À côté du titre, deux petits boutons changent la façon dont les photos sont
posées :

* **Une ligne par jour** — chaque journée commence sur sa propre ligne, avec sa
  date en tête. Lisible, mais une journée de trois photos laisse le reste de la
  ligne vide.
* **Condensée** — les journées se suivent en largeur, plusieurs par ligne. Une
  journée n'est jamais coupée en deux : si elle ne tient pas dans la place
  restante, elle bascule entière à la ligne suivante. (Une journée plus large
  qu'une ligne complète se replie sur plusieurs lignes, forcément.)

Le choix est retenu et s'applique partout : chronologie, album, vidéos.

À gauche de ces deux boutons, **−** et **+** changent la taille des vignettes.
LB et RB font la même chose à la manette, depuis la grille.

**Chaque écran garde son propre zoom.** Agrandir les photos de l'accueil ne
touche ni la grille d'albums, ni l'intérieur d'un album, ni les vidéos — chacun
retient son réglage.

Ces boutons sont atteignables à la manette : depuis la barre du haut, ↓ y passe
avant d'arriver aux photos ; depuis la grille, ↑ y remonte. ← → circulent entre
eux, **A** applique.

Sur téléphone, l'échelle se resserre automatiquement : le même cran de zoom
donne trois colonnes au lieu de deux, sans quoi l'écran serait à moitié vide.

## Albums

Créez, renommez, changez la couleur ou la musique, supprimez l'album — les
photos, elles, restent dans la bibliothèque.

Pour la **photo de couverture**, trois chemins : la bande de vignettes dans
*Modifier l'album*, le clic droit sur une photo de l'album → *Définir comme
couverture*, ou **LS** pendant qu'on la regarde en plein écran.

La couleur de l'album remplace la couleur globale tant qu'on est dedans : le
liseré néon des photos et les boutons prennent sa teinte.

### Arrière-plan d'album

Ajoutez d'abord un dossier de type *images d'arrière-plan* dans
Paramètres → Dossiers. Ses images deviennent alors sélectionnables dans
**Modifier l'album**, avec une **opacité** réglable en pourcentage juste en
dessous — un aperçu montre le rendu pendant que vous tapez. Comptez 30 à 50 %
pour garder assez de contraste sous les photos ; à 100 % l'image passe devant
tout le reste visuellement et gêne la lecture de la grille.

## Musique

Deux étapes, et c'est la seconde qu'on oublie :

1. **Le dossier**, une fois pour toutes — Paramètres → Dossiers → type
   *musique*, contenant `1.mp3`, `2.mp3`, … `5.mp3`.
2. **La piste, album par album** — ouvrez l'album → **Modifier l'album** (le
   crayon) → ligne *musique* → choisissez un numéro. C'est ici que ça se règle,
   pas dans les paramètres.

La piste démarre alors en boucle à l'ouverture de l'album, au volume réglé dans
les paramètres (volume à 0 = muet). Si le navigateur refuse le son parce que la
page n'a encore reçu aucune interaction, Photon le signale et relance la lecture
au premier clic ou à la première touche.

**Pendant une vidéo**, la musique baisse pour qu'on entende la bande son. Le
niveau se règle par album, dans le même formulaire : *musique pendant les
vidéos*, en pourcentage du volume global (20 % par défaut, 0 = silence total).
L'atténuation démarre dès que la vidéo s'affiche en plein écran, avec un fondu
d'un quart de seconde, et le volume remonte à la fermeture.

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
* L'envoi depuis un téléphone demande un geste : sélectionner les photos. Aucune
  application web ne peut lire une pellicule ni tourner en arrière-plan la nuit,
  sur aucun système. Pour de l'automatique complet, voir Syncthing plus haut.
* La surveillance des dossiers s'appuie sur le système de fichiers ; certains
  partages réseau la refusent. Dans ce cas le bouton *Relancer le scan* reste
  disponible, et le scan de démarrage fait le travail.
