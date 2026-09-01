# Phrases de référence du tokenizer CLIP

`phrases.json` — 507 phrases : français, anglais, coréen, japonais, russe,
emoji, nombres, ponctuation, accents, chaînes vides, textes trop longs, et des
suites de caractères quelconques.

`attendu.json` — ce que l'implémentation officielle d'OpenAI en fait, jeton par
jeton. Produit avec `clip/simple_tokenizer.py` du dépôt `openai/CLIP`.

`npm run test:clip` compare notre portage à ces valeurs. Il lui faut en plus le
vocabulaire, trop volumineux pour être gardé ici :

    curl -LO https://raw.githubusercontent.com/openai/CLIP/main/clip/bpe_simple_vocab_16e6.txt.gz

Placez-le dans ce dossier, puis lancez `npm run test:clip -- clip-fixtures`.

C'est le même fichier que Photon télécharge pour la recherche par description :
une fois le modèle installé, il est déjà dans le dossier de données.

## Préparation d'image

`images/` — cinq images de formes variées : carrée, paysage, portrait,
panorama, et une plus petite que 224 px.

`ref_image.py` reproduit la chaîne officielle de CLIP en PIL et numpy, et écrit
le tenseur attendu :

    pip install pillow numpy
    python3 ref_image.py attendu_image.json images/*.png
    npm run test:clip-image -- clip-fixtures

Le fichier produit pèse une quinzaine de mégaoctets : il n'est pas conservé
dans le dépôt, mais se régénère en une seconde.

`reference.py` fait la même chose pour le tokenizer, avec
`clip/simple_tokenizer.py` d'OpenAI dans le même dossier.
