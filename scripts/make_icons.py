"""
Generates the LedgerFlow PWA icon set (both the main app and the Super
Admin panel share the same mark) from the exact shapes used by the
in-app <symbol id="lf-logo-mark"> SVG, so the app icon matches the
in-app brand mark pixel-for-pixel in proportion.

Run once with: python scripts/make_icons.py
Not part of the app itself — output only (icons/*.png in each app root).
"""
import math
import os
from PIL import Image, ImageDraw

GARNET = (255, 90, 69)       # --garnet
GARNET_DARK = (217, 63, 44)  # --garnet-dark

# Shapes from the <symbol id="lf-logo-mark" viewBox="0 0 24 24"> in index.html
MARK_VIEWBOX = 24.0
MARK_SHAPES = [
    ("rect", 6, 4, 4.4, 13, 2.2),
    ("rect", 6, 14.6, 9, 4.4, 2.2),
    ("circle", 18.3, 5.7, 2.3),
]


def lerp(a, b, t):
    return a + (b - a) * t


def diagonal_gradient(size, c1, c2):
    img = Image.new("RGB", (size, size))
    px = img.load()
    for y in range(size):
        for x in range(size):
            t = (x + y) / (2 * size)
            px[x, y] = (
                round(lerp(c1[0], c2[0], t)),
                round(lerp(c1[1], c2[1], t)),
                round(lerp(c1[2], c2[2], t)),
            )
    return img


def rounded_rect_mask(size, radius):
    mask = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(mask)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return mask


def draw_mark(draw, size, scale_frac, offset_y_frac=0.0):
    """Draws the white ledger+flow mark centered in a `size`x`size` canvas,
    scaled so the 24x24 viewbox occupies `scale_frac` of the canvas width."""
    mark_px = size * scale_frac
    unit = mark_px / MARK_VIEWBOX
    # Center the mark's own bounding box (roughly x:6-20.6, y:4-19), not the
    # full 24x24 viewbox, so it looks visually centered rather than
    # top-left-heavy.
    bbox_x0, bbox_x1 = 6.0, 20.6
    bbox_y0, bbox_y1 = 4.0, 19.0
    bbox_cx = (bbox_x0 + bbox_x1) / 2
    bbox_cy = (bbox_y0 + bbox_y1) / 2
    origin_x = size / 2 - bbox_cx * unit
    origin_y = size / 2 - bbox_cy * unit + size * offset_y_frac

    def tx(x):
        return origin_x + x * unit

    def ty(y):
        return origin_y + y * unit

    for shape in MARK_SHAPES:
        if shape[0] == "rect":
            _, x, y, w, h, r = shape
            draw.rounded_rectangle(
                [tx(x), ty(y), tx(x + w), ty(y + h)],
                radius=r * unit,
                fill=(255, 255, 255),
            )
        elif shape[0] == "circle":
            _, cx, cy, r = shape
            draw.ellipse(
                [tx(cx - r), ty(cy - r), tx(cx + r), ty(cy + r)],
                fill=(255, 255, 255),
            )


def make_icon(size, maskable=False):
    if maskable:
        # Full-bleed background, mark kept inside Android's ~66% safe zone.
        img = diagonal_gradient(size, GARNET, GARNET_DARK)
        draw = ImageDraw.Draw(img)
        draw_mark(draw, size, scale_frac=0.5)
        return img

    # "any" purpose: rounded-square badge, like the in-app brand mark.
    radius = round(size * 0.22)
    bg = diagonal_gradient(size, GARNET, GARNET_DARK)
    mask = rounded_rect_mask(size, radius)
    icon = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    icon.paste(bg, (0, 0), mask)
    draw = ImageDraw.Draw(icon)
    draw_mark(draw, size, scale_frac=0.6)
    return icon


def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    targets = [os.path.join(root, "icons"), os.path.join(root, "admin", "icons")]

    for out_dir in targets:
        os.makedirs(out_dir, exist_ok=True)
        make_icon(192).save(os.path.join(out_dir, "icon-192.png"))
        make_icon(512).save(os.path.join(out_dir, "icon-512.png"))
        make_icon(192, maskable=True).save(os.path.join(out_dir, "icon-maskable-192.png"))
        make_icon(512, maskable=True).save(os.path.join(out_dir, "icon-maskable-512.png"))
        make_icon(180).convert("RGB").save(os.path.join(out_dir, "apple-touch-icon.png"))
        make_icon(48).save(os.path.join(out_dir, "favicon-48.png"))
        make_icon(32).save(os.path.join(out_dir, "favicon-32.png"))
        print("Wrote icons to", out_dir)


if __name__ == "__main__":
    main()
