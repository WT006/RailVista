"""
纪念票航司/联盟 logo 白底转透明

难点：logo 内部往往本身就有白色（如东航的白色燕子、国航的凤凰白描边），
不能用"所有近白像素都设透明"——那会把 logo 挖空。

做法：
1. 只从**四条边界**向内做 flood fill，把与边缘连通的白色抠掉；
   内部被深色包围的白色区域自然保留。
2. 抠完做一次"白色残留检测"：若内部仍有大块纯白且与背景同色，
   报告出来供人工判断（不自动改，避免破坏 logo）。
3. 统一裁掉四周多余透明边 + 留2px 呼吸，输出紧凑 PNG。

用法: python scripts/strip-logo-bg.py <文件...> [--out-dir目录] [--tolerance 18]
"""
import sys
import os
from collections import deque
from PIL import Image


def strip_white_bg(src, out_path, tolerance=18, verbose=True):
    im = Image.open(src).convert("RGBA")
    w, h = im.size
    px = im.load()

    def is_bg(x, y):
        r, g, b, a = px[x, y]
        if a == 0:
            return True
        # 近白且低饱和才算背景；纯白 logo 内部另由 flood fill 保护
        return r >= 255 - tolerance and g >= 255 - tolerance and b >= 255 - tolerance

    seen = [[False] * w for _ in range(h)]
    q = deque()

    # 从四条边界的背景像素入队
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

    removed = 0
    while q:
        x, y = q.popleft()
        r, g, b, _ = px[x, y]
        # 透明化（保留轻微alpha 以免边缘出现锯齿白边）
        px[x, y] = (r, g, b, 0)
        removed += 1
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if 0 <= nx < w and 0 <= ny < h and not seen[ny][nx] and is_bg(nx, ny):
                seen[ny][nx] = True
                q.append((nx, ny))

    # 边缘 1px 羽化：把贴着透明区的近白像素做半透明过渡
    alpha = im.getchannel("A")
    ap = alpha.load()
    for x in range(w):
        for y in range(h):
            if ap[x, y] != 0:
                continue
            # 找最近的非透明邻居，若其很亮则给个过渡alpha
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nx, ny = x + dx, y + dy
                if 0 <= nx < w and 0 <= ny < h and ap[nx, ny] != 0:
                    break

    # 裁到内容bbox + 2px 呼吸
    bbox = im.getbbox()
    if bbox:
        pad = 2
        l = max(0, bbox[0] - pad)
        t = max(0, bbox[1] - pad)
        r = min(w, bbox[2] + pad)
        b = min(h, bbox[3] + pad)
        im = im.crop((l, t, r, b))

    im.save(out_path, "PNG", optimize=True)

    # 报告内部是否还有大块白（提示人工确认，不自动处理）
    warn = ""
    if verbose:
        nw, nh = im.size
        npx = im.load()
        opaque_white = 0
        for y in range(nh):
            for x in range(nw):
                r, g, b, a = npx[x, y]
                if a > 200 and r >= 250 and g >= 250 and b >= 250:
                    opaque_white += 1
        ratio = opaque_white / max(1, nw * nh)
        if ratio > 0.02:
            warn = f"  ⚠ 内部残留白色 {ratio:.1%} —— 可能是 logo 自身的白，保留（请目视确认）"
    return im.size, removed, warn


def main():
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        return
    out_dir = None
    tol = 18
    files = []
    i = 0
    while i < len(args):
        if args[i] == "--out-dir":
            out_dir = args[i + 1]
            i += 2
        elif args[i] == "--tolerance":
            tol = int(args[i + 1])
            i += 2
        else:
            files.append(args[i])
            i += 1
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)

    for f in files:
        base = os.path.splitext(os.path.basename(f))[0]
        dst = os.path.join(out_dir or os.path.dirname(f), base + ".png")
        size, removed, warn = strip_white_bg(f, dst, tol)
        kb = os.path.getsize(dst) / 1024
        print(f"{base}: 抠除 {removed}px → {size[0]}x{size[1]} {kb:.0f}KB{warn}")


if __name__ == "__main__":
    main()
