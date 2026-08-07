"""
Generates the TeleFlow PWA icon set (both the main app and the Super
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

# Shapes from the <symbol id="lf-logo-mark" viewBox="0 0 24 24"> in
# index.html — three ascending rounded pillars. Deliberately carries no
# letterform. The trailing value is the fill opacity, which gives the
# ascent a sense of depth without needing a second colour.
MARK_VIEWBOX = 24.0
MARK_SHAPES = [
    ("rect", 4.6, 13.4, 3.9, 6.6, 1.95, 0.55),
    ("rect", 10.05, 9.2, 3.9, 10.8, 1.95, 0.78),
    ("rect", 15.5, 4.0, 3.9, 16.0, 1.95, 1.0),
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


def draw_mark(img, size, scale_frac, offset_y_frac=0.0):
    """Draws the white ascending-pillars mark centered in a `size`x`size`
    canvas, scaled so the 24x24 viewbox occupies `scale_frac` of the width.

    Drawn onto a transparent overlay and alpha-composited, because the
    pillars carry per-shape opacity and PIL can't blend that directly onto
    an opaque background."""
    mark_px = size * scale_frac
    unit = mark_px / MARK_VIEWBOX
    # Center the mark's own bounding box (x:4.6-19.4, y:4-20), not the full
    # 24x24 viewbox, so it sits optically centred.
    bbox_cx = (4.6 + 19.4) / 2
    bbox_cy = (4.0 + 20.0) / 2
    origin_x = size / 2 - bbox_cx * unit
    origin_y = size / 2 - bbox_cy * unit + size * offset_y_frac

    def tx(x):
        return origin_x + x * unit

    def ty(y):
        return origin_y + y * unit

    for _, x, y, w, h, r, opacity in MARK_SHAPES:
        layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        ImageDraw.Draw(layer).rounded_rectangle(
            [tx(x), ty(y), tx(x + w), ty(y + h)],
            radius=r * unit,
            fill=(255, 255, 255, round(255 * opacity)),
        )
        img.alpha_composite(layer)


def make_icon(size, maskable=False):
    if maskable:
        # Full-bleed background, mark kept inside Android's ~66% safe zone.
        img = diagonal_gradient(size, GARNET, GARNET_DARK).convert("RGBA")
        draw_mark(img, size, scale_frac=0.5)
        return img

    # "any" purpose: rounded-square badge, like the in-app brand mark.
    radius = round(size * 0.22)
    bg = diagonal_gradient(size, GARNET, GARNET_DARK)
    mask = rounded_rect_mask(size, radius)
    icon = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    icon.paste(bg, (0, 0), mask)
    draw_mark(icon, size, scale_frac=0.6)
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
