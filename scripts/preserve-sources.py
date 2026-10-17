"""One-time import of the sources explicitly attached to this project."""
from pathlib import Path
from shutil import copy2
from hashlib import sha256
from zipfile import ZipFile
from xml.etree import ElementTree as E
import json

root = Path(__file__).resolve().parents[1]
dest = root / 'docs' / 'fuentes'
dest.mkdir(parents=True, exist_ok=True)
base = Path(r'C:\Users\USER\Desktop\ups\MSNOTES\PATRONES DE DISEÑO DE API\proyecto final')
sources = [(base / n, n) for n in ['Fabrica_de_Credito_RF_RNF.docx', 'fase1.docx', 'fase2.docx']]
sources += [(Path(r'C:\Users\USER\.codex\attachments\2cf11e64-b836-4183-a3fc-3894abee4879\Pasted text.txt'), 'prompt-maestro.txt'), (Path(r'C:\Users\USER\.codex\attachments\b4770d0e-252f-4bdf-8ca4-536163c47847\Pasted text.txt'), 'rubrica.txt'), (Path(r'C:\Users\USER\AppData\Local\Temp\codex-clipboard-677d3e20-0089-45d6-b74f-35aa2975bdd6.png'), 'arquitectura-original.png')]
manifest = []
ns = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
for src, name in sources:
    target = dest / name
    if target.exists():
        assert target.read_bytes() == src.read_bytes(), 'Refusing to overwrite changed source'
    else:
        copy2(src, target)
    digest = sha256(src.read_bytes()).hexdigest()
    assert digest == sha256(target.read_bytes()).hexdigest()
    manifest.append({'file': name, 'sha256': digest, 'byteIdentical': True})
    if src.suffix == '.docx':
        with ZipFile(src) as z:
            tree = E.fromstring(z.read('word/document.xml'))
            paragraphs = [''.join(t.text or '' for t in p.findall('.//w:t', ns)) for p in tree.findall('.//w:p', ns)]
            (dest / (src.stem + '.txt')).write_text('\n'.join(paragraphs), encoding='utf-8')
(dest / 'manifest.json').write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding='utf-8')
print('Preserved and SHA-256 verified:', len(manifest), 'sources')
