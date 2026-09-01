"""Sort les jetons de l'implementation officielle d'OpenAI, pour comparaison."""
import json
import sys
from simple_tokenizer import SimpleTokenizer

phrases = json.load(open(sys.argv[1], encoding='utf-8'))
tok = SimpleTokenizer()
out = {p: tok.encode(p) for p in phrases}
json.dump(out, open(sys.argv[2], 'w', encoding='utf-8'), ensure_ascii=False)
print(f'{len(out)} phrases encodees par la reference')
