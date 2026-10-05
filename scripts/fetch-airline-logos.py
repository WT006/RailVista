"""
批量下载航司 / 铁路官方 logo（透明底 PNG）

背景：仓库里原有的13 个 logo 中，东航是 2014 前的旧版（燕子被圆框束缚），
新加的 16 家航司只有文字标占位。

关键经验（踩过的坑）：
1. logo-teka 的 URL 形如 /wp-content/uploads/<YYYY>/<MM>/<slug>-logo.png，
   其中 YYYY/MM 是**上传月份**，各航司不同 —— 不能只靠猜 slug，
   必须先抓该航司的详情页，从 HTML 里解析真实 URL。
2. 每页会带 -100x21 / -300x64 / -512x110 等缩略图变体，
   取**无后缀**的那个才是原图。
3. 必须校验 alpha 通道：无透明像素的一律丢弃（宁缺毋滥，不编造）。

用法: python scripts/fetch-airline-logos.py
输出: apps/web/src/assets/ticket/<code>.png
"""
import io
import os
import re
import socket
import urllib.request
from PIL import Image

socket.setdefaulttimeout(8)
OUT_DIR = "apps/web/src/assets/ticket"
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
SITE = "https://logo-teka.com"

# code -> (slug候选, 中文名)。slug 命中页面即用，解不出就跳过并报告。
TARGETS = {
    # 已有的（刷新为官方透明底 + 修正东航旧版）
    "cz": ("china-southern-airlines", "中国南方航空"),
    "ca": ("air-china", "中国国际航空"),
    "mu": ("china-eastern-airlines", "中国东方航空"),
    "hu": ("hainan-airlines", "海南航空"),
    "mf": ("xiamenair", "厦门航空"),
    "3u": ("sichuan-airlines", "四川航空"),
    "zh": ("shenzhen-airlines", "深圳航空"),
    "sc": ("shandong-airlines", "山东航空"),
    "9c": ("spring-airlines", "春秋航空"),
    "ho": ("juneyao-air", "吉祥航空"),
    # 联盟
    "staralliance": ("star-alliance", "星空联盟"),
    "skyteam": ("skyteam", "天合联盟"),
    "oneworld": ("oneworld", "寰宇一家"),
    # 新增 16 家
    "gs": ("tianjin-airlines", "天津航空"),
    "jd": ("beijing-capital-airlines", "首都航空"),
    "kn": ("china-united-airlines", "中国联合航空"),
    "g5": ("china-express-airlines", "华夏航空"),
    "eu": ("chengdu-airlines", "成都航空"),
    "wz": ("western-airlines", "西部航空"),
    "ns": ("hebei-airlines", "河北航空"),
    "fu": ("fuzhou-airlines", "福州航空"),
    "uq": ("urumqi-airlines", "乌鲁木齐航空"),
    "aq": ("9-airlines", "九元航空"),
    "gj": ("loong-air", "长龙航空"),
    "qw": ("qingdao-airlines", "青岛航空"),
    "gt": ("guilin-airlines", "桂林航空"),
    "a6": ("hunan-airlines", "湖南航空"),
    "gx": ("begui-bay-airlines", "北部湾航空"),
    "ry": ("jiangxi-airlines", "江西航空"),
}

PAGE_URLS = [
    SITE + "/en?p={q}",
    SITE + "/?s={q}",
]


def get(url, tries=1):
    last = None
    for _ in range(tries):
        try:
            return urllib.request.urlopen(
                urllib.request.Request(url, headers=UA)
            ).read()
        except Exception as e:  # noqa: BLE001
            last = e
    raise last


def find_logo_url(slug):
    """先试直接原图，再退到解析详情页 HTML"""
    # 候选 1：直接猜原图路径（2025/11 是东航的上传月，命中率低但成本极低）
    for ym in ("2025/11", "2025/10", "2025/09", "2026/01"):
        u = f"{SITE}/wp-content/uploads/{ym}/{slug}-logo.png"
        try:
            d = get(u, tries=1)
            if d[:8] == b"\x89PNG\r\n\x1a\n":
                return u, d
        except Exception:  # noqa: BLE001
            continue

    # 候选 2：解析详情页，提取无后缀的 <slug>-logo.png
    q = slug.replace("-", "%20")
    for tmpl in PAGE_URLS:
        try:
            html = get(tmpl.format(q=q), tries=1).decode("utf-8", "ignore")
        except Exception:  # noqa: BLE001
            continue
        # 取"无尺寸后缀"的原图：排除 -100x21 / -300x64 / -512x110 变体。
        # 注意不能用 (?<!-\d+x\d+) 后顾断言 —— re 不支持变长后顾，
        # 会抛 PatternError（第一版就是这么挂的）。
        cand = re.findall(
            r"https://logo-teka\.com/wp-content/uploads/\d{4}/\d{2}/"
            + re.escape(slug) + r"-logo[^'\"]*?\.png",
            html,
        )
        orig = [u for u in cand if re.search(r"-logo\.(png|svg)", u)]
        if orig:
            u = orig[0]
            return u, get(u, tries=1)
    return None, None


def verify(im):
    """必须是带真实透明通道的图，否则丢弃"""
    im = im.convert("RGBA")
    if im.getchannel("A").getextrema()[0] != 0:
        return None
    return im


def normalize(im):
    """裁透明边 + 留 2px + 长边限 1000px"""
    bbox = im.getbbox()
    if bbox:
        pad = 2
        im = im.crop(
            (
                max(0, bbox[0] - pad),
                max(0, bbox[1] - pad),
                min(im.width, bbox[2] + pad),
                min(im.height, bbox[3] + pad),
            )
        )
    if max(im.size) > 1000:
        r = 1000 / max(im.size)
        im = im.resize((int(im.width * r), int(im.height * r)), Image.LANCZOS)
    return im


def main():
    import sys

    # 支持只跑指定 code：python fetch-airline-logos.py gs jd kn ...
    only = set(sys.argv[1:])
    os.makedirs(OUT_DIR, exist_ok=True)
    ok, bad = [], []
    for code, (slug, name) in TARGETS.items():
        if only and code not in only:
            continue
        try:
            url, data = find_logo_url(slug)
        except Exception as e:  # noqa: BLE001
            bad.append((code, name, f"下载异常 {type(e).__name__}"))
            continue
        if not data:
            bad.append((code, name, "未找到可用 URL"))
            continue
        try:
            im = Image.open(io.BytesIO(data))
            im.load()
        except Exception as e:  # noqa: BLE001
            bad.append((code, name, f"非合法图片 {type(e).__name__}"))
            continue
        im = verify(im)
        if im is None:
            bad.append((code, name, "无透明通道，已丢弃"))
            continue
        im = normalize(im)
        dst = os.path.join(OUT_DIR, f"{code}.png")
        im.save(dst, "PNG", optimize=True)
        ok.append((code, name, im.size, os.path.getsize(dst) / 1024, url))

    print("成功:")
    for code, name, size, kb, url in ok:
        print(f"  {code:14s} {name:10s} {size[0]}x{size[1]:<5d} {kb:6.0f}KB")
    print(f"\n失败 {len(bad)} 个（保留文字标占位，未编造 logo）:")
    for code, name, why in bad:
        print(f"  {code:14s} {name:10s} {why}")


if __name__ == "__main__":
    main()
