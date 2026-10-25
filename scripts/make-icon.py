"""Atolye uygulama ikonu: turkuaz degrade zemin + </> isareti.
Kullanim: python scripts/make-icon.py  ->  build/icon.png, build/icon.ico
"""
import os
from PIL import Image, ImageDraw

S = 1024
OUT = os.path.join(os.path.dirname(__file__), "..", "build")


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def thick_line(d, a, b, w, fill):
    d.line([a, b], fill=fill, width=w)
    r = w // 2
    for x, y in (a, b):
        d.ellipse([x - r, y - r, x + r, y + r], fill=fill)


def main():
    os.makedirs(OUT, exist_ok=True)
    grad = Image.new("RGB", (S, S))
    px = grad.load()
    top, bottom = (45, 212, 191), (14, 116, 144)
    for y in range(S):
        for x in range(S):
            px[x, y] = lerp(top, bottom, (x * 0.35 + y * 0.65) / S)
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle([40, 40, S - 40, S - 40], radius=220, fill=255)
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    img.paste(grad, (0, 0), mask)
    d = ImageDraw.Draw(img)
    white = (255, 255, 255, 255)
    shadow = (8, 60, 70, 90)
    for col, off in ((shadow, 14), (white, 0)):
        o = off
        thick_line(d, (400 + o, 330 + o), (240 + o, 512 + o), 78, col)
        thick_line(d, (240 + o, 512 + o), (400 + o, 694 + o), 78, col)
        thick_line(d, (624 + o, 330 + o), (784 + o, 512 + o), 78, col)
        thick_line(d, (784 + o, 512 + o), (624 + o, 694 + o), 78, col)
        thick_line(d, (566 + o, 300 + o), (458 + o, 724 + o), 70, col)
    img.resize((512, 512), Image.LANCZOS).save(os.path.join(OUT, "icon.png"))
    img.save(os.path.join(OUT, "icon.ico"), sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    print("icon: ok")


if __name__ == "__main__":
    main()
