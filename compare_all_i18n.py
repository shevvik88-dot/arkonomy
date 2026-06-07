import json

def get_keys(d, prefix=''):
    keys = set()
    for k, v in d.items():
        new_key = f"{prefix}.{k}" if prefix else k
        if isinstance(v, dict):
            keys.update(get_keys(v, new_key))
        else:
            keys.add(new_key)
    return keys

langs = ['en', 'es', 'ru', 'pt']
data = {}
for lang in langs:
    with open(f'src/locales/{lang}/translation.json', 'r') as f:
        data[lang] = json.load(f)

keys = {lang: get_keys(data[lang]) for lang in langs}
all_keys = set().union(*keys.values())

for lang in langs:
    missing = all_keys - keys[lang]
    if missing:
        print(f"Missing in {lang}:")
        for k in sorted(missing):
            print(f"  {k}")

    extra = keys[lang] - all_keys
    if extra:
        print(f"Extra in {lang}:")
        for k in sorted(extra):
            print(f"  {k}")
