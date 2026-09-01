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
