import sys, pypdf

path, start, end = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
r = pypdf.PdfReader(path)
for i in range(start, min(end, len(r.pages)) + 1):
    print(f"\n=============== Seite {i} ===============")
    try:
        print(r.pages[i - 1].extract_text() or "<leer>")
    except Exception as e:
        print(f"<Fehler: {e}>")
