"""Daily check of the production site (Phase 3.6; .github/workflows/prod-check.yml).

    python scripts/ci/prod_check.py [base_url]

Checks, against the live deployment:
- /api/v1/system/health is 200 "ok" (serving store and both models load);
- /api/v1/system/version names a commit;
- the pages and the static data files they need answer 200 (frontend/Data/ was 404 on
  production for weeks before anyone noticed: the .vercelignore bug fixed in #12);
- the eight ranking cases from the 2026-11-11 defect register (N-3, N-4, N-6), as
  tests/test_phase0_guards.py runs them: a short list, never a loss beside a profit,
  and a list where everything loses is flagged as such.

Prints one line per check and a summary; exits 1 if any check failed. Standard
library only, so the workflow needs no install step.
"""
from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.request

BASE = (sys.argv[1] if len(sys.argv) > 1 else "https://mitti-mantra-drab.vercel.app").rstrip("/")
UA = "mitti-mantra-prod-check"

# Same pairs and inputs as tests/test_phase0_guards.py DEFECT_PAIRS.
DEFECT_PAIRS = [
    ("telangana_medak", "zaid"), ("up_lucknow", "zaid"), ("punjab_ludhiana", "zaid"),
    ("wb_bardhaman", "kharif"), ("punjab_ludhiana", "kharif"), ("punjab_ludhiana", "rabi"),
    ("tn_thanjavur", "kharif"), ("guj_anand", "kharif"),
]
STATIC = ["/", "/dashboard.html", "/decide.html", "/book-a-tractor.html", "/gyan-seva.html",
          "/marketplace.html", "/sw.js", "/Data/tractors.js", "/Data/consultants.js",
          "/Data/marketplace-listings.js", "/Data/india-states.geo.json"]


def request(path: str, body: dict | None = None, attempts: int = 3) -> tuple[int, bytes]:
    data = json.dumps(body).encode() if body is not None else None
    headers = {"User-Agent": UA, "Cache-Control": "no-cache"}
    if data is not None:
        headers["Content-Type"] = "application/json"
    last: Exception | None = None
    for i in range(attempts):  # a cold start can time out once
        try:
            req = urllib.request.Request(BASE + path, data=data, headers=headers)
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.status, r.read()
        except urllib.error.HTTPError as e:
            return e.code, e.read()
        except (urllib.error.URLError, TimeoutError) as e:
            last = e
            time.sleep(5 * (i + 1))
    raise RuntimeError(f"{path}: no response after {attempts} attempts ({last})")


def check_health() -> str | None:
    status, body = request("/api/v1/system/health")
    doc = json.loads(body or b"{}")
    if status != 200 or doc.get("status") != "ok":
        bad = {k: v for k, v in (doc.get("checks") or {}).items() if not v.get("ok")}
        return f"health {status} {doc.get('status')}: {bad or body[:200]!r}"
    return None


def check_version() -> str | None:
    status, body = request("/api/v1/system/version")
    doc = json.loads(body or b"{}")
    if status != 200 or not doc.get("commit"):
        return f"version {status}: no commit in {body[:200]!r}"
    print(f"  running commit {doc['commit'][:12]}, data {str(doc.get('data', {}).get('sha256'))[:12]}")
    return None


def check_static(path: str) -> str | None:
    status, _ = request(path)
    return None if status == 200 else f"{path} answered {status}"


def check_ranking(region_id: str, season: str) -> str | None:
    status, body = request("/api/recommend", {"region_id": region_id, "season": season,
                                              "budget_per_acre": 15000, "area_acres": 4})
    if status != 200:
        return f"recommend {region_id}/{season}: {status} {body[:200]!r}"
    recs = json.loads(body)
    if not recs:
        return f"recommend {region_id}/{season}: empty list"
    profits = [r.get("expected_profit", 0) for r in recs]
    if any(p > 0 for p in profits):
        if not all(p > 0 for p in profits):
            return f"recommend {region_id}/{season}: a loss beside a profit {profits}"
    elif not all(r.get("all_options_lose") for r in recs):
        return f"recommend {region_id}/{season}: every crop loses but the list is not flagged"
    return None


def main() -> int:
    checks = [("health", check_health), ("version", check_version)]
    checks += [(f"static {p}", (lambda p=p: check_static(p))) for p in STATIC]
    checks += [(f"ranking {r}/{s}", (lambda r=r, s=s: check_ranking(r, s))) for r, s in DEFECT_PAIRS]
    failures = []
    for name, fn in checks:
        try:
            problem = fn()
        except Exception as exc:  # report, keep checking the rest
            problem = f"{name}: {type(exc).__name__}: {exc}"
        print(("FAIL " if problem else "ok   ") + name + (f" -- {problem}" if problem else ""))
        if problem:
            failures.append(problem)
    print(f"\n{len(checks) - len(failures)}/{len(checks)} checks passed against {BASE}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
