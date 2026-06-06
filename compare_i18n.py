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

langs = ['en', 'es', 'ru']
data = {}
for lang in langs:
    with open(f'src/locales/{lang}/translation.json', 'r') as f:
        data[lang] = json.load(f)

keys = {lang: get_keys(data[lang]) for lang in langs}
all_keys = keys['en'] | keys['es'] | keys['ru']

print("Missing in ES (relative to EN):")
for k in sorted(keys['en'] - keys['es']):
    print(f"  {k}")

print("\nMissing in RU (relative to EN):")
for k in sorted(keys['en'] - keys['ru']):
    print(f"  {k}")

print("\nExtra in ES (not in EN):")
for k in sorted(keys['es'] - keys['en']):
    print(f"  {k}")

print("\nExtra in RU (not in EN):")
for k in sorted(keys['ru'] - keys['en']):
    print(f"  {k}")
