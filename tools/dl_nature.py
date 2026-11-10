import sys
try:
    import requests
except Exception as e:
    print("no requests:", e)
    raise SystemExit(0)

H = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Accept": "application/pdf,text/html;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}
jobs = [
    ("cao2025", "https://www.nature.com/articles/s40494-025-01870-0", "https://www.nature.com/articles/s40494-025-01870-0.pdf"),
    ("li2026", "https://www.nature.com/articles/s40494-026-02434-6", "https://www.nature.com/articles/s40494-026-02434-6.pdf"),
]
for tag, page, pdf in jobs:
    s = requests.Session()
    s.headers.update(H)
    try:
        r1 = s.get(page, timeout=30, allow_redirects=True)
        print(tag, "page", r1.status_code, len(r1.content), r1.headers.get("content-type"), "->", r1.url[:80])
        r2 = s.get(pdf, timeout=60, allow_redirects=True)
        ct = r2.headers.get("content-type", "")
        ok = r2.content[:5] == b"%PDF-"
        print(tag, "pdf", r2.status_code, len(r2.content), ct, "isPdf", ok, "->", r2.url[:80])
        if ok:
            open(r"C:\Users\ZhouXuan\Desktop\OH-WorkSpace\_papers\%s.pdf" % tag, "wb").write(r2.content)
            print("  saved")
    except Exception as e:
        print(tag, "FAIL", repr(e))
