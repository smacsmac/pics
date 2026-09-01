"""La chaine de preparation officielle de CLIP, en PIL + numpy."""
import json, sys, numpy as np
from PIL import Image

MEAN = np.array([0.48145466, 0.4578275, 0.40821073], dtype=np.float64)
STD  = np.array([0.26862954, 0.26130258, 0.27577711], dtype=np.float64)
N = 224

def transform(path):
    im = Image.open(path)
    # Resize(224) de torchvision : le plus PETIT cote est ramene a 224.
    w, h = im.size
    if w < h:
        nw, nh = N, round(h * N / w)
    else:
        nw, nh = round(w * N / h), N
    im = im.resize((nw, nh), Image.BICUBIC)
    # CenterCrop(224)
    left, top = (nw - N) // 2, (nh - N) // 2
    im = im.crop((left, top, left + N, top + N)).convert('RGB')
    a = np.asarray(im, dtype=np.float64) / 255.0      # H W C
    a = (a - MEAN) / STD
    return a.transpose(2, 0, 1).reshape(-1)            # C H W

out = {}
for path in sys.argv[2:]:
    out[path.split('/')[-1]] = transform(path).tolist()
json.dump(out, open(sys.argv[1], 'w'))
print(f'{len(out)} image(s) preparees par la reference')
