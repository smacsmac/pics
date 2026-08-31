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
| Sélectionner toute une journée | — (voir *Tout sélectionner*) | — | pastille à droite de la date |
| Refermer une barre latérale | **B** | Échap | clic dans la vue principale |
| Définir la photo affichée comme couverture | **LS** (clic du stick gauche) | — | Modifier l'album → couverture |
| Viser un mois dans le curseur de dates | **stick droit ↑ ↓** | Page préc. / Page suiv. | survol |
| Se rendre au mois visé | **A** | Entrée | clic sur le mois, à droite |
| Tags d'un album (sur sa carte) | **X** | — | clic droit → Modifier les tags |
| Épingler un album en haut | — | — | clic droit → Épingler en haut |
| Tourner une photo d'un quart de tour | **RS** (clic du stick droit) | **R** | clic droit → Tourner |
| Lancer le diaporama | **Start** | — | bouton *Diaporama* de l'en-tête |
| Mettre le diaporama en pause | **A** | Entrée | clic sur la photo |
| Régler la vitesse du diaporama | **LB** / **RB** | `[` `]` | boutons − / + |
| Quitter le diaporama | **B** ou **Start** | Échap | bouton ✕ |
| Faire un album d'un moment (écran Souvenirs) | **Y** | — | bouton *En faire un album* |
| Enregistrer une copie | — | — | clic droit → Enregistrer |
| Menu contextuel | — | — | clic droit |

Les deux barres verticales n'apparaissent que lorsque leur bouton est
surligné : **Chercher** à gauche, **Paramètres** à droite. Elles se posent
**par-dessus** les photos : la grille occupe toute la largeur de l'écran en
permanence et ne se décale jamais quand une barre s'ouvre ou se ferme. Par
défaut, ↑ et ↓ font défiler la chronologie principale.

Pour refermer une barre : **B** ou Échap, ou simplement **un clic dans la vue
principale** — sur n'importe quel écran.

**LT et RT sont réservées à la barre du haut.** Où que vous soyez — dans les
filtres, dans les réglages, dans la grille — elles font passer au bouton
précédent ou suivant, et referment au passage la barre latérale ouverte. La
croix directionnelle et le stick, eux, restent locaux : à l'intérieur d'une
barre, ← et → passent d'un champ à l'autre, par exemple de `[avr.]` à `[2018]`.

Tout est aussi cliquable à la souris, y compris à l'intérieur des barres :
les pastilles de date, les cases de volume, les teintes, les langues.

Sur une photo surlignée, les trois actions forment un cercle qui reprend la
disposition de la manette : **Y** en haut, **X** à gauche, **A** en bas.

### Le curseur de dates au stick droit

Le curseur des mois, à droite de l'écran, **fait défiler la chronologie
jusqu'au mois choisi**. Il ne filtre rien : tout ce qui est plus récent reste
au-dessus, il suffit de remonter. Le mois demandé se pose en première ligne, pas
« quelque part dans les parages ».

Le repère allumé suit la position réelle : c'est un « vous êtes ici », qui se
déplace tout seul quand vous faites défiler à la main.

À la manette, le **stick droit** *vise* d'abord : le mois pointé grossit, se
souligne et s'accompagne d'une pastille **A** — la vue ne bouge pas tant que
vous n'avez pas confirmé.

* **stick droit ↑ / ↓** — viser le mois précédent ou suivant ; maintenez pour
  faire défiler.
* **A** — s'y rendre pour de bon.
* **B** — abandonner ; la vue reste exactement où elle était.

Viser réveille le curseur, normalement estompé : sans souris à l'écran, rien
d'autre ne le ferait apparaître. Le stick gauche continue de parcourir les
photos, comme avant.

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
* **Souvenirs** — ce que Photon retrouve tout seul : les photos prises un même
  jour les années passées, et les « moments ».
* **Nouvel album** — nom, couleur, musique, tags.
* **Les deux tuiles suivantes** — les albums les plus récents. LB/RB pour
  faire défiler les suivants.
* **Paramètres** — taille du texte, volume, thème, mode enfant, dossiers, langue.

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

### Ranger la grille d'albums

Quand les albums se comptent par dizaines, deux outils :

* **Épingler** — clic droit sur une carte → *Épingler en haut*. L'album passe
  juste après les Favoris et y reste **quel que soit le tri**, les autres
  suivent derrière. Clic droit → *Ne plus épingler* pour le relâcher.
* **Trier** — le bouton de tri dans l'en-tête de l'écran Albums propose quatre
  ordres : *modifiés récemment* (par défaut), *par nom*, *année la plus récente
  d'abord* et *année la plus ancienne d'abord*.

Les deux tris par année lisent **l'année écrite dans le nom** (« Vacances
2026 » → 2026), parce que c'est ainsi qu'on nomme les albums en pratique — pas
la date de création du dossier. Un album sans année lisible passe à la fin,
rangé par nom. Le chiffre doit être une vraie année isolée : « Sortie 662068 »
n'est pas lu comme 2068.

**Créer un album à partir d'une sélection** : sélectionnez les photos, **Y** →
*Ajouter à un album* → *Nouvel album*. Le formulaire annonce combien de photos
attendent, et elles entrent dans l'album dès sa création — on arrive donc
directement dans un album déjà rempli, sans avoir à refaire l'opération.
Abandonner le formulaire abandonne aussi la sélection en attente.

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

Les tags s'ajoutent à la main, jamais devinés.

**Sur une photo** : clic droit → *Modifier les tags*. La fenêtre s'ouvre sur
**les tags que la photo porte déjà** — un clic sur la croix en retire un, et les
autres tags de la bibliothèque sont proposés en dessous.

En mode sélection multiple, le tag s'applique à toute la sélection d'un coup.
Les tags présents sur **une partie seulement** de la sélection apparaissent en
pointillé : un clic les étend à tout le monde, la croix les retire de tout le
monde. Les tags communs à toutes les photos, eux, sont pleins.

### Couleurs

Chaque tag peut recevoir sa propre couleur, indépendante de la teinte du thème.
Passez la souris sur un tag, cliquez la petite palette et choisissez une teinte
— ou la croix pour revenir au neutre. Le tag devient alors un bouton plein à
cette couleur, texte blanc, et il garde cette couleur partout : dans l'éditeur,
dans le sélecteur de tags et sur les filtres actifs de la recherche.

Un tag coloré n'est jamais effacé automatiquement, même s'il ne sert plus à
aucune photo : la couleur est un choix délibéré, et le perdre en retirant le tag
de sa dernière photo serait une mauvaise surprise. Remettez sa couleur à
*aucune* pour qu'il redevienne effaçable.

**Sur un album** : clic droit sur sa carte → *Modifier les tags*, ou **X** à la
manette quand il est surligné. Le champ *tags* du formulaire *Nouvel album* et
*Modifier l'album* fait la même chose.

### Chercher par tag

La barre de recherche **s'adapte à ce qu'on regarde** :

* sur l'accueil, dans un album ou dans les vidéos, elle filtre les **photos** :
  dates, lieu, tags ;
* sur l'écran **Albums**, il n'y a pas de dates ni de lieu à filtrer : elle
  cherche un album par son **nom** ou par ses **tags**.

Le filtre par tags est un « et » : une photo — ou un album — doit porter *tous*
les tags demandés pour rester à l'écran.

### Un tag d'album déteint sur ses photos

Taguer un album **taekwondo** suffit : depuis l'accueil, chercher ce tag ramène
les photos de l'album en plus de celles taguées une par une. Pas besoin de
taguer chaque photo — ranger une photo dans l'album lui donne le tag, l'en
retirer le lui reprend.

Les deux sortes de tags restent distinctes là où ça compte :

* en plein écran (**A** sur une photo), un tag hérité est suivi de la mention
  *venu de l'album* ;
* *Modifier les tags* sur une photo ne montre que **ses** tags, puisqu'un tag
  hérité s'enlève sur l'album, pas sur la photo.

> **Une confusion corrigée.** La pilule de la rangée *tags* montre le tag
> *candidat*, celui que **A** (ou LB/RB) ajouterait au filtre. Elle s'affichait
> comme un filtre déjà posé, ce qui donnait l'impression d'avoir filtré alors
> que toutes les photos restaient là. Elle est maintenant estompée et préfixée
> d'un `+` tant qu'on n'a pas confirmé ; les filtres réellement appliqués sont
> les pastilles pleines juste en dessous, qu'un clic retire.

## Souvenirs

Le bouton **Souvenirs** de la barre du haut ouvre un écran que Photon remplit
sans qu'on lui demande rien.

### Ce jour-là

Une bande par année : les photos prises le même jour du même mois, les années
précédentes. Le 31 août, vous retrouvez les 31 août de 2024, 2022, 2019…
L'année en cours est écartée — ce ne serait pas un souvenir.

Cliquez une vignette pour lancer le diaporama de cette année-là à partir d'elle,
ou *Lancer* pour la reprendre depuis le début.

Certains jours la bande est vide : rien n'a été pris à cette date les années
passées. C'est écrit, plutôt que de laisser un blanc.

### Moments

Photon regroupe les photos prises coup sur coup au même endroit. Vingt photos
en un après-midi à Hamilton forment un moment ; deux photos isolées, non. Un
moment se termine après **huit heures** sans photo, ou en changeant de ville —
un lieu inconnu ne coupe pas, faute de GPS c'est le temps qui décide. Il faut au
moins **quatre photos** pour qu'un moment existe.

**Rien n'est enregistré.** Les moments se recalculent à chaque ouverture de
l'écran : ils suivent votre bibliothèque toute seule, sans jamais se périmer.
Ajoutez des photos, ils se redécoupent.

Chaque carte propose deux choses :

* **Lancer** (ou **A**, ou un clic sur la couverture) — le diaporama du moment.
* **En faire un album** (ou **Y**) — le moment devient un vrai album, avec ses
  photos dedans, nommé d'après le lieu et la date : « Montréal — 12 juillet
  2026 ». C'est la façon de garder un moment pour de bon, puisqu'il se
  redécoupera sinon. Le nom se change ensuite comme celui de n'importe quel
  album.

## Diaporama

Le **bouton Start** de la manette lance le diaporama de ce que vous regardez —
la chronologie, un album, les vidéos, filtres compris — à partir de la photo
surlignée. Le bouton *Diaporama* de l'en-tête fait la même chose à la souris.

* **A** ou un clic — pause, puis reprise.
* **← →** — photo précédente ou suivante, même en pause.
* **LB / RB** ou les boutons − / + — la durée d'affichage, de 2 à 30 secondes.
* **B**, **Start** ou Échap — quitter.

Les photos s'enchaînent en fondu, avec un léger mouvement de caméra ; un trait
d'avancement en bas de l'écran annonce le changement. Les vidéos se lancent
toutes seules, avec leur son, et le diaporama repart à la fin — la musique
d'album s'atténue pendant ce temps, comme en plein écran. Une vidéo illisible ne
bloque rien : au bout de vingt secondes, on passe à la suivante.

Le diaporama boucle, et sur la chronologie il continue de charger les photos
plus anciennes au fur et à mesure : il ne s'arrête pas au bout des deux cents
premières.

### Quatre réglages, dans *Paramètres → Diaporama*

* **durée d'une photo** — de 2 à 30 secondes.
* **aléatoire** — l'ordre est tiré une fois au démarrage, et la photo d'où vous
  partez passe en tête. Chaque photo passe une fois avant que ça reboucle.
* **mouvement** — le léger zoom lent. Il se coupe tout seul si votre système
  demande de réduire les animations.
* **démarrage auto** — au bout de tant de minutes sans rien toucher, l'écran
  devient un cadre photo. Réglé sur **jamais** par défaut : rien ne se lance
  sans qu'on le demande. Le compte repart au moindre geste, souris, clavier ou
  manette, et rien ne démarre pendant qu'une fenêtre ou un formulaire est ouvert.

## Enregistrer une copie

*Clic droit sur une photo → **Enregistrer***, ou le bouton **Enregistrer** de la
barre de sélection pour tout un lot.

* Une seule photo arrive telle quelle, avec son nom d'origine.
* Plusieurs arrivent dans une archive ZIP, `photon-2026-08-31.zip`, fabriquée à
  la volée : le téléchargement démarre tout de suite, sans fichier temporaire ni
  attente. Deux photos qui portent le même nom sont numérotées, aucune n'écrase
  l'autre.

C'est une **copie**, et rien d'autre. Les fichiers d'origine ne sont ni
déplacés, ni renommés, ni effacés — c'est le navigateur qui reçoit le
téléchargement et vous demande où le ranger. Pratique depuis un téléphone : on
récupère les photos du PC sans câble.

En mode enfant, les photos cachées sont exclues du téléchargement.

## Lieux

Si vos photos contiennent des coordonnées GPS, Photon les traduit en nom de
ville **hors ligne**, grâce à une base de 135 000 villes embarquée. Une photo
prise aux chutes Sherman ressort en « Hamilton, Ontario, Canada », traduit selon
la langue choisie. Aucune requête réseau n'est faite.

À population comparable, la ville la plus proche gagne ; à distance comparable,
la plus peuplée gagne — sinon une photo prise à Vancouver ressortirait au nom du
quartier voisin.

## Vidéos du téléphone

Les téléphones récents (Pixel, iPhone) filment en **HEVC / H.265**. Les
navigateurs ne savent pas décoder ce format : on voyait la première image figée
et on entendait le son, alors que le fichier est parfaitement sain — il s'ouvre
sans problème dans l'explorateur Windows. Les vidéos venant de Google Photos, en
H.264, passaient sans rien faire.

Photon prépare donc une **copie lisible en H.264** de ces vidéos-là, à la
première ouverture. Un message *Préparation de la vidéo… %* suit l'avancement,
puis la lecture devient normale — et instantanée les fois suivantes.

* Le fichier d'origine n'est **jamais** modifié, déplacé ni remplacé. La copie
  vit à côté des vignettes, dans `videos-lisibles/` du dossier de données.
* Les vidéos déjà lisibles (H.264, VP9, AV1 dans un `.mp4`, `.webm`, `.mov`)
  sont servies telles quelles, sans conversion.
* Un `.mkv` ou un `.avi` dont les pistes sont déjà bonnes est simplement
  recopié dans un `.mp4`, sans réencodage : quelques secondes, aucune perte.
* Une seule conversion à la fois, pour ne pas monopoliser le PC.
* Ce dossier peut être supprimé sans risque : les copies se refont au besoin.

## Sélection multiple

**Back** à la manette, **Alt+S** au clavier, ou clic droit → *Sélection*. Une
pastille apparaît alors sur chaque photo : cochez celles qui vous intéressent,
puis *Ajouter à un album*, *Enregistrer*, *Modifier les tags* ou *Cacher*
s'appliquent à toute la sélection d'un coup.

**Une journée entière** se prend d'un seul geste : la même pastille apparaît à
droite de chaque date. Un clic coche toute la journée, un second la relâche.
Quand une partie seulement de la journée est cochée, la pastille est à demi
remplie — on voit d'un coup d'œil qu'il reste des photos à prendre. Ça marche
dans les deux dispositions, par jour comme condensée.

**B** ou Échap quitte le mode sélection.

## Tourner une photo

Une photo couchée se redresse d'un quart de tour à la fois :

* **clic du stick droit (RS)** en plein écran ;
* **R** au clavier ;
* **clic droit → Tourner**, dans la grille comme en plein écran.

Quatre appuis ramènent la photo à son point de départ, sans aucune perte : le
**fichier d'origine n'est jamais réécrit**. Photon note l'angle de son côté et
refait la vignette ; l'image sur le disque reste celle de l'appareil photo, à
l'octet près.

Les vidéos ne sont pas concernées : elles gardent leur orientation à la
lecture, et les tourner ne ferait qu'une vignette de travers par rapport au
film.

## Cacher plutôt que supprimer

Photon ne supprime jamais un fichier. **X** (ou le menu contextuel) *cache* une
photo : elle disparaît des vues, le fichier reste intact sur le disque. Pour les
revoir : **Paramètres → Voir les photos cachées**. La bascule agit tout de
suite, dans les deux sens — inutile de recharger la page.

## Mode enfant

Photon est **ouvert par défaut** : tout est permis, sans mot de passe à saisir.
Le verrou fonctionne dans l'autre sens — on le pose quand on en a besoin.

Avant de tendre l'application à un enfant, **Paramètres → Mode enfant →
*Activer le mode enfant***. Une pastille apparaît en bas de l'écran, et ces
gestes sont alors bloqués : cacher une photo, la tourner, gérer les albums et
leurs tags, toucher aux dossiers et aux réglages sensibles. Regarder les photos,
lui, reste libre.

**Pour en sortir, il faut le mot de passe** (Paramètres → Mode enfant, ou la
pastille en bas de l'écran). C'est le seul moment où on le demande. Un mauvais
mot de passe ne fait pas sortir du mode.

Entrer dans le mode enfant, en revanche, ne demande rien : il doit rester
possible de brider l'application en un geste, même si quelqu'un d'autre a le
mot de passe en tête. Choisissez-en un dans la même fenêtre si ce n'est pas déjà
fait — sans mot de passe, n'importe qui peut ressortir du mode.

L'application écoute sur le réseau local, donc masquer un bouton ne protège
rien : **toutes ces vérifications sont faites côté serveur**, pas seulement dans
l'interface. La session reste déverrouillée 30 jours par navigateur.

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
* Le curseur de dates fait **défiler** jusqu'au mois choisi, il ne filtre pas :
  tout ce qui est plus récent reste au-dessus. Pour remonter d'un geste, le
  bouton *Aujourd'hui* en haut à droite.
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
* Le **démarrage automatique** du diaporama est vérifié toutes les quinze
  secondes : avec un délai d'une minute, il peut donc partir jusqu'à un quart de
  minute plus tard. Sans conséquence pour un cadre photo.
* Un **moment** ne peut pas descendre sous quatre photos ni changer de seuil
  depuis l'interface : les valeurs (huit heures, quatre photos) sont écrites
  dans le code. Elles conviennent à des photos de famille ; une pratique très
  différente demanderait de les toucher.
* Le **téléchargement groupé** est plafonné à 2000 photos par archive. Au-delà,
  copier le dossier directement est plus simple et plus rapide.
* L'archive ZIP est en mode « stocké » : les photos et les vidéos étant déjà
  compressées, la recompresser ne gagnerait rien et empêcherait de commencer
  l'envoi avant d'avoir tout lu.
* La conversion d'une vidéo HEVC prend du temps la première fois : comptez à peu
  près la durée de la vidéo elle-même pour du 1080p, davantage en 4K. C'est fait
  une seule fois par vidéo, ensuite la lecture est immédiate. Ces copies
  occupent de la place — un peu moins que les originaux en général.
