"""生成 MolEdit 应用图标 moledit/assets/moledit.ico（多尺寸，绘制的球棍分子图标）。
运行：python tools/make-icon.py
"""
import os
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT_DIR = os.path.join(ROOT, "assets")
OUT_ICO = os.path.join(OUT_DIR, "moledit.ico")
OUT_PNG = os.path.join(OUT_DIR, "moledit-256.png")
os.makedirs(OUT_DIR, exist_ok=True)

S = 1024  # 超采样画布
img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img, "RGBA")

# ---------- 圆角深色背景 + 轻微渐变 ----------
radius = int(S * 0.22)
# 渐变底
grad = Image.new("RGBA", (S, S), (0, 0, 0, 0))
gd = ImageDraw.Draw(grad)
for y in range(S):
    t = y / (S - 1)
    r = int(18 + (34 - 18) * t)
    g = int(24 + (43 - 24) * t)
    b = int(38 + (66 - 38) * t)
    gd.line([(0, y), (S, y)], fill=(r, g, b, 255))
mask = Image.new("L", (S, S), 0)
md = ImageDraw.Draw(mask)
md.rounded_rectangle([0, 0, S - 1, S - 1], radius=radius, fill=255)
img.paste(grad, (0, 0), mask)

# 内描边（浅色高光边）
d.rounded_rectangle([int(S * 0.012), int(S * 0.012), int(S * 0.988), int(S * 0.988)],
                    radius=int(radius * 0.95), outline=(90, 110, 150, 160), width=int(S * 0.012))

# ---------- 球棍模型：水分子式三原子 ----------
O = (int(S * 0.50), int(S * 0.60))
H1 = (int(S * 0.30), int(S * 0.33))
H2 = (int(S * 0.70), int(S * 0.33))
bond_color = (203, 213, 225, 255)
bond_w = int(S * 0.075)

def draw_bond(p, q, color, w):
    # 简易圆柱：主线 + 两侧描边
    d.line([p, q], fill=(15, 20, 30, 255), width=w + int(S * 0.018))
    d.line([p, q], fill=color, width=w)

draw_bond(O, H1, bond_color, bond_w)
draw_bond(O, H2, bond_color, bond_w)

def sphere(center, r, base, light, outline):
    cx, cy = center
    # 描边
    d.ellipse([cx - r - int(S * 0.008), cy - r - int(S * 0.008), cx + r + int(S * 0.008), cy + r + int(S * 0.008)],
              fill=(10, 14, 22, 255))
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=base)
    # 高光（左上）
    hr = int(r * 0.55)
    hx, hy = cx - int(r * 0.32), cy - int(r * 0.34)
    d.ellipse([hx - hr, hy - hr, hx + hr, hy + hr], fill=light)
    # 高光小点
    sr = int(r * 0.18)
    sx, sy = cx - int(r * 0.38), cy - int(r * 0.40)
    d.ellipse([sx - sr, sy - sr, sx + sr, sy + sr], fill=(255, 255, 255, 230))

rH = int(S * 0.115)
rO = int(S * 0.165)
sphere(H1, rH, (226, 232, 240, 255), (248, 250, 252, 255), (100, 116, 139, 255))
sphere(H2, rH, (226, 232, 240, 255), (248, 250, 252, 255), (100, 116, 139, 255))
sphere(O, rO, (239, 68, 68, 255), (252, 165, 165, 255), (120, 20, 20, 255))

# ---------- 输出 ----------
try:
    RESAMPLE = Image.Resampling.LANCZOS
except AttributeError:  # Pillow < 9.1
    RESAMPLE = Image.LANCZOS

img256 = img.resize((256, 256), RESAMPLE)
img256.save(OUT_PNG, "PNG")
sizes = [16, 24, 32, 48, 64, 128, 256]
img.resize((512, 512), RESAMPLE).save(OUT_ICO, format="ICO", sizes=[(s, s) for s in sizes])
print("已生成:", OUT_ICO)
print("已生成:", OUT_PNG)
print("尺寸:", sizes)

