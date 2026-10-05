"""
重绘中国东方航空 logo（官方现行简体版）

背景：现有 mu.jpg 是 2014 后的燕子标，但中文部分是繁体「中國東方航空」，
而官方现行 VI 用简体「中国东方航空」。票面是简体中文语境，应对齐官方现行版。

做法：
1. 燕子标：从原图裁出，用 flood fill 抠掉白底（保留燕子内部的白色分隔线）；
2. 文字：用系统字体渲染简体「中国东方航空」+ CHINA EASTERN，
   颜色取官方品牌色（红 #DE1F26 / 蓝 #2C2E7A，见公开VI资料）；
3. 合成竖版logo，输出透明底 PNG。

用法: python scripts/rebuild-mu-logo.py
"""
import os
from collections import deque
from PIL import Image, ImageDraw, ImageFont

SRC = "apps/web/src/assets/ticket/mu.jpg"
OUT = "apps/web/src/assets/ticket/mu.png"

RED = (222, 31, 38)     # #DE1F26 官方红
BLUE = (44, 46, 122)    # #2C2E7A 官方深蓝


def strip_bg(im, tolerance=20):
    """从四边向内flood fill 抠白底，保留内部被包围的白色（燕子白描边）"""
    w, h = im.size
    px = im.load()
    seen = [[False] * w for _ in range(h)]
    q = deque()

    def is_bg(x, y):
        r, g, b, a = px[x, y]
        return a == 0 or (r >= 255 - tolerance and g >= 255 - tolerance and b >= 255 - tolerance)

    for x in range(w):
        for y in (0, h - 1):
            if is_bg(x, y) and not seen[y][x]:
                seen[y][x] = True
                q.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            if is_bg(x, y) and not seen[y][x]:
                seen[y][x] = True
                q.append((x, y))

    while q:
        x, y = q.popleft()
        r, g, b, _ = px[x, y]
        px[x, y] = (r, g, b, 0)
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if 0 <= nx < w and 0 <= ny < h and not seen[ny][nx] and is_bg(nx, ny):
                seen[ny][nx] = True
                q.append((nx, ny))
    return im


def find_font(size):
    """挑一个支持简体中文的粗体字重"""
    candidates = [
        "C:/Windows/Fonts/msyhbd.ttc",   # 微软雅黑 Bold
        "C:/Windows/Fonts/msyh.ttc",
        "C:/Windows/Fonts/simhei.ttf",   # 黑体
        "C:/Windows/Fonts/simsun.ttc",
    ]
    for c in candidates:
        if os.path.exists(c):
            try:
                return ImageFont.truetype(c, size)
            except Exception:
                continue
    return ImageFont.load_default()


def main():
    src = Image.open(SRC).convert("RGBA")
    w, h = src.size
    # 仅用于量文字尺寸的临时画布
    d_probe = ImageDraw.Draw(Image.new("RGBA", (10, 10)))

    # ── 1. 燕子标（原图上 72%，含白边） ──
    mark = src.crop((0, 0, w, int(h * 0.72)))
    # 裁掉四周白边
    bbox = mark.getbbox()
    if bbox:
        mark = mark.crop(bbox)
    mark = strip_bg(mark)

    # 先把燕子标单独缩放好（宽度基准 600）
    m = mark.copy()
    scale = 600 / m.width
    m = m.resize((int(m.width * scale), int(m.height * scale)), Image.LANCZOS)

    # ── 2. 简体中文「中国东方航空」：先量后定画布宽度 ──
    #     教训：曾先按固定 1000px 画布绘制、再按 bbox 裁剪，导致溢出部分被裁掉、
    #     logo 左右缺字。正确做法是「先量文字实际宽度 → 再据此定画布宽 → 最后整体裁边」。
    cn = "中国东方航空"
    gap = 18
    f_cn = find_font(150)
    widths = [d_probe.textlength(ch, font=f_cn) for ch in cn]
    text_w = int(sum(widths) + gap * (len(cn) - 1))

    en = "CHINA EASTERN"
    f_en = find_font(76)
    en_w = int(d_probe.textlength(en, font=f_en))

    # 画布宽 = max(燕子标, 中文行, 英文行) + 左右留白
    pad_side = 30
    MARK_W = max(m.width, text_w, en_w) + pad_side * 2

    # 垂直排布：燕子标 → 中文 → 英文
    gap_m_cn = 60
    gap_cn_en = 26
    cn_h = 150
    en_h = 76
    MARK_H = 20 + m.height + gap_m_cn + cn_h + gap_cn_en + en_h + 20

    canvas = Image.new("RGBA", (MARK_W, MARK_H), (255, 255, 255, 0))
    canvas.paste(m, ((MARK_W - m.width) // 2, 20), m)
    d = ImageDraw.Draw(canvas)

    x = (MARK_W - text_w) / 2
    y = 20 + m.height + gap_m_cn
    for ch, cw in zip(cn, widths):
        d.text((x, y), ch, font=f_cn, fill=RED + (255,))
        x += cw + gap

    d.text(((MARK_W - en_w) / 2, y + cn_h + gap_cn_en), en, font=f_en, fill=BLUE + (255,))

    # 裁到内容 bbox + 10px 呼吸。
    # 注意：这里必须用 canvas 实际尺寸，不能写死 min(900,...) ——
    # 曾因硬编码 900 把 1050 宽的画布裁掉右侧，导致「中国东方航空」的「空」字缺半。
    bbox = canvas.getbbox()
    if bbox:
        pad = 10
        W0, H0 = canvas.size
        l = max(0, bbox[0] - pad)
        t = max(0, bbox[1] - pad)
        r = min(W0, bbox[2] + pad)
        b = min(H0, bbox[3] + pad)
        canvas = canvas.crop((l, t, r, b))

    canvas.save(OUT, "PNG", optimize=True)
    print(f"已生成 {OUT}  尺寸 {canvas.size}  {os.path.getsize(OUT)/1024:.0f}KB")


if __name__ == "__main__":
    main()
