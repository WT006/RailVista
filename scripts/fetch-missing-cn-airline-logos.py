"""
补齐大陆航司缺 logo（不含外国 / 港澳台）。
来源优先级：Wikimedia Commons 已知文件 → logo-teka → 官方站常见路径。
输出：apps/web/src/assets/ticket/<iata>.png（1:1 透明底）
"""
from __future__ import annotations

import io
import json
import os
import socket
import time
import urllib.error
import urllib.parse
import urllib.request

from PIL import Image

socket.setdefaulttimeout(12)
OUT = "apps/web/src/assets/ticket"
UA = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    )
}

# 仅大陆缺图航司
NEED = {
    "fm": "上海航空",
    "y8": "金鹏航空",
    "jr": "幸福航空",
    "dr": "瑞丽航空",
    "9h": "长安航空",
    "oq": "重庆航空",
}

COMMONS_FILES: dict[str, list[str]] = {
    "oq": ["Chongqing Airlines logo 2023.png", "Chongqing Airlines logo.png"],
    "fm": [],
    "jr": [],
    "dr": [],
    "y8": ["Yangtze River Express logo.png"],
    "9h": [],
}

TEKA_SLUGS: dict[str, list[str]] = {
    "fm": ["shanghai-airlines", "shanghai-air"],
    "y8": ["suparna-airlines", "yangtze-river-express"],
    "jr": ["joy-air", "joyair"],
    "dr": ["ruili-airlines", "ruili-air"],
    "9h": ["air-changan", "changan-airlines"],
    "oq": ["chongqing-airlines"],
}

# 官方 / CDN 直链候选（失败即跳过）
DIRECT: dict[str, list[str]] = {
    "fm": [
        "https://www.ceair.com/upload/portal/logo/shanghaiair.png",
        "https://www.shanghai-air.com/assets/images/logo.png",
    ],
    "dr": [
        "https://www.rlair.net/static/images/logo.png",
        "https://www.rlair.net/images/logo.png",
    ],
    "jr": [
        "https://www.joy-air.com/images/logo.png",
        "https://www.joyair.com.cn/images/logo.png",
    ],
    "9h": [
        "https://www.airchangan.com/static/images/logo.png",
        "https://www.airchangan.com/images/logo.png",
    ],
    "y8": [
        "https://www.yzr.com.cn/images/logo.png",
        "https://www.suparnaair.com/images/logo.png",
    ],
}


def get(url: str, timeout: float = 10) -> bytes:
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def commons_file_url(title: str) -> str | None:
    api = "https://commons.wikimedia.org/w/api.php?" + urllib.parse.urlencode(
        {
            "action": "query",
            "titles": f"File:{title}",
            "prop": "imageinfo",
            "iiprop": "url",
            "format": "json",
        }
    )
    time.sleep(0.8)
    data = json.loads(get(api, timeout=15).decode())
    for page in data["query"]["pages"].values():
        if "imageinfo" in page:
            return page["imageinfo"][0]["url"].split("?")[0]
    return None


def search_commons(q: str) -> list[str]:
    api = "https://commons.wikimedia.org/w/api.php?" + urllib.parse.urlencode(
        {
            "action": "query",
            "list": "search",
            "srsearch": q,
            "srnamespace": 6,
            "srlimit": 6,
            "format": "json",
        }
    )
    time.sleep(0.8)
    data = json.loads(get(api, timeout=15).decode())
    return [x["title"].removeprefix("File:") for x in data["query"]["search"]]


def teka_try(slug: str) -> bytes | None:
    for ym in (
        "2025/11",
        "2025/10",
        "2025/09",
        "2025/08",
        "2024/12",
        "2024/06",
        "2023/08",
        "2023/01",
    ):
        url = f"https://logo-teka.com/wp-content/uploads/{ym}/{slug}-logo.png"
        try:
            blob = get(url, timeout=6)
            if blob[:8] == b"\x89PNG\r\n\x1a\n":
                return blob
        except Exception:
            continue
    return None


def normalize(im: Image.Image) -> Image.Image:
    im = im.convert("RGBA")
    bbox = im.getbbox()
    if bbox:
        pad = 4
        im = im.crop(
            (
                max(0, bbox[0] - pad),
                max(0, bbox[1] - pad),
                min(im.width, bbox[2] + pad),
                min(im.height, bbox[3] + pad),
            )
        )
    side = min(max(max(im.size), 128), 480)
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    ratio = min((side - 8) / im.width, (side - 8) / im.height)
    nw, nh = max(1, int(im.width * ratio)), max(1, int(im.height * ratio))
    im = im.resize((nw, nh), Image.LANCZOS)
    canvas.paste(im, ((side - nw) // 2, (side - nh) // 2), im)
    return canvas


def save_blob(code: str, blob: bytes, src: str) -> bool:
    try:
        im = Image.open(io.BytesIO(blob))
        im.load()
    except Exception as e:
        print(f"  skip decode {code}: {e}")
        return False
    if min(im.size) < 24:
        print(f"  skip tiny {code}")
        return False
    out = normalize(im)
    path = os.path.join(OUT, f"{code}.png")
    out.save(path, "PNG", optimize=True)
    kb = os.path.getsize(path) / 1024
    print(f"OK {code:4s} {out.size[0]}x{out.size[1]} {kb:5.0f}KB  <- {src}")
    return True


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    ok: list[str] = []
    miss: list[str] = []

    for code, name in NEED.items():
        path = os.path.join(OUT, f"{code}.png")
        if os.path.exists(path) and os.path.getsize(path) > 1500:
            print(f"keep {code} ({name})")
            ok.append(code)
            continue

        print(f"=== {code} {name}")
        got = False

        # 1) commons known / search
        titles = list(COMMONS_FILES.get(code, []))
        for q in (f"{name} logo", f"{NEED[code]} logo"):
            try:
                titles.extend(search_commons(q))
            except Exception as e:
                print(f"  commons search fail: {type(e).__name__}")
                break
        # English queries
        enq = {
            "fm": "Shanghai Airlines logo",
            "y8": "Suparna Airlines logo",
            "jr": "Joy Air logo",
            "dr": "Ruili Airlines logo",
            "9h": "Air Changan logo",
            "oq": "Chongqing Airlines logo",
        }
        try:
            titles.extend(search_commons(enq[code]))
        except Exception:
            pass
        seen: set[str] = set()
        for title in titles:
            if title in seen:
                continue
            seen.add(title)
            low = title.lower()
            if not any(k in low for k in ("logo", "emblem", "wordmark", "标志", "標誌")):
                if "air" not in low and "航空" not in title:
                    continue
            try:
                url = commons_file_url(title)
            except Exception as e:
                print(f"  commons api {title}: {type(e).__name__}")
                continue
            if not url:
                continue
            try:
                blob = get(url, timeout=20)
                if save_blob(code, blob, url):
                    got = True
                    break
            except Exception as e:
                print(f"  commons dl {title}: {type(e).__name__}")

        # 2) logo-teka
        if not got:
            for slug in TEKA_SLUGS.get(code, []):
                blob = teka_try(slug)
                if blob and save_blob(code, blob, f"logo-teka:{slug}"):
                    got = True
                    break

        # 3) direct URLs
        if not got:
            for url in DIRECT.get(code, []):
                try:
                    blob = get(url, timeout=8)
                    if save_blob(code, blob, url):
                        got = True
                        break
                except Exception:
                    continue

        if got:
            ok.append(code)
        else:
            miss.append(code)
            print(f"FAIL {code} {name}")

    print("\n成功:", ", ".join(ok) or "(无)")
    print("仍缺:", ", ".join(miss) or "(无)")


if __name__ == "__main__":
    main()
