import re, sys, pypdf

path = sys.argv[1]
pattern = re.compile(sys.argv[2], re.I)
ctx = int(sys.argv[3]) if len(sys.argv) > 3 else 1

r = pypdf.PdfReader(path)
print(f"# {path} — {len(r.pages)} Seiten")
for i, page in enumerate(r.pages, 1):
    try:
        t = page.extract_text() or ""
    except Exception:
        continue
    lines = t.splitlines()
    hits = [n for n, l in enumerate(lines) if pattern.search(l)]
    if not hits:
        continue
    print(f"\n===== Seite {i} =====")
    shown = set()
    for n in hits:
        for k in range(max(0, n - ctx), min(len(lines), n + ctx + 1)):
            if k not in shown:
                shown.add(k)
                print(f"{k:4d}| {lines[k]}")
        print("  ---")
