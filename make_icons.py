#!/usr/bin/env python3
"""Generate Android launcher icons + TV banner from youtube_icon.png."""
import os
from PIL import Image, ImageDraw, ImageFont

BASE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(BASE, "youtube_icon.png")
RES = os.path.join(BASE, "app", "src", "main", "res")

logo = Image.open(SRC).convert("RGBA")
# Make the white background of the source transparent so only the red mark
# (and its white play triangle, which the white canvas behind will show) remains.
px = logo.load()
for y in range(logo.height):
    for x in range(logo.width):
        r, g, b, a = px[x, y]
        if r > 240 and g > 240 and b > 240:
            px[x, y] = (255, 255, 255, 0)

def centered(canvas_size, logo_frac, bg=(255, 255, 255, 0)):
    """White (transparent) canvas with the logo centered at logo_frac width."""
    canvas = Image.new("RGBA", (canvas_size, canvas_size), bg)
    target_w = int(canvas_size * logo_frac)
    target_h = int(target_w * logo.height / logo.width)
    scaled = logo.resize((target_w, target_h), Image.LANCZOS)
    x = (canvas_size - target_w) // 2
    y = (canvas_size - target_h) // 2
    canvas.alpha_composite(scaled, (x, y))
    return canvas

def save(img, *parts):
    path = os.path.join(RES, *parts)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path)
    print("wrote", os.path.relpath(path, BASE))

# 108dp adaptive foreground (content kept inside the ~66% safe zone)
FG = {"mdpi": 108, "hdpi": 162, "xhdpi": 216, "xxhdpi": 324, "xxxhdpi": 432}
for d, s in FG.items():
    save(centered(s, 0.58), "mipmap-%s" % d, "ic_launcher_foreground.png")

# 48dp legacy square icon (white bg) for older launchers / fallback
LEG = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
for d, s in LEG.items():
    img = centered(s, 0.74, bg=(255, 255, 255, 255))
    save(img, "mipmap-%s" % d, "ic_launcher.png")
    save(img, "mipmap-%s" % d, "ic_launcher_round.png")

# Android TV banner 320x180 (white bg + logo + app name)
banner = Image.new("RGBA", (320, 180), (255, 255, 255, 255))
bh = 96
bw = int(bh * logo.width / logo.height)
ls = logo.resize((bw, bh), Image.LANCZOS)
banner.alpha_composite(ls, (40, (180 - bh) // 2 - 14))
try:
    font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Bold.ttf", 26)
except Exception:
    try:
        font = ImageFont.truetype("/Library/Fonts/Arial.ttf", 26)
    except Exception:
        font = ImageFont.load_default()
d = ImageDraw.Draw(banner)
text = "Antube Kids"
tw = d.textlength(text, font=font)
d.text(((320 - tw) / 2, 132), text, fill=(20, 20, 20, 255), font=font)
save(banner, "drawable-nodpi", "tv_banner.png")

print("done")
