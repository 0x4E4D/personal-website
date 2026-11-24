#!/usr/bin/env python3
"""Make web-sized copies of the site's photos and record their dimensions.

For every image in "Personal Website/photos/" this writes
"photos/thumbs/<name>.webp" (at most THUMB_WIDTH px wide), and for every entry
in data/photos.json it fills in:

  "thumb":  the webp copy the photo wall loads instead of the full file
  "width" / "height":  the photo's size, so the browser can reserve the right
                       amount of space before the image arrives (no jumping
                       layout, and lazy-loading works properly)

Why 640px: the photo wall's columns are ~260px wide on desktop and ~180px on
phones, and the shadow-flicker effect renders at most 2x the displayed width,
so anything past ~520px is thrown away anyway.

Safe to re-run: thumbnails are only rebuilt when the source is newer, and
photos.json is only rewritten when something changed. The deploy workflow runs
this too, so a photo added without running it still gets a thumbnail on the
live site.

Usage:  python3 tools/build_thumbs.py        (needs Pillow: pip install pillow)
"""
import io
import json
import os
import sys

from PIL import Image, ImageCms, ImageOps

SITE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "Personal Website")
PHOTOS = os.path.join(SITE, "photos")
THUMBS = os.path.join(PHOTOS, "thumbs")
DATA = os.path.join(SITE, "data", "photos.json")

THUMB_WIDTH = 640
QUALITY = 80
EXTS = {".jpg", ".jpeg", ".png", ".webp"}


def thumb_rel(src_rel):
    stem = os.path.splitext(os.path.basename(src_rel))[0]
    return f"photos/thumbs/{stem}.webp"


SRGB = ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB"))


def to_srgb(im):
    """Convert from the embedded colour profile (iPhone photos are Display P3)
    to plain sRGB, the same conversion the browser does when it draws the
    photo into the shadow-flicker canvas. Dropping the profile without
    converting would shift the colours."""
    icc = im.info.get("icc_profile")
    if im.mode not in ("RGB", "RGBA"):
        im = im.convert("RGB")
    if not icc:
        return im
    src = ImageCms.ImageCmsProfile(io.BytesIO(icc))
    return ImageCms.profileToProfile(
        im, src, SRGB,
        renderingIntent=ImageCms.Intent.RELATIVE_COLORIMETRIC,
        outputMode=im.mode,
    )


def build_thumb(src_path, out_path):
    with Image.open(src_path) as im:
        im = ImageOps.exif_transpose(im)
        im = to_srgb(im)
        if im.width > THUMB_WIDTH:
            h = round(im.height * THUMB_WIDTH / im.width)
            im = im.resize((THUMB_WIDTH, h), Image.LANCZOS)
        im.save(out_path, "WEBP", quality=QUALITY, method=6)


def image_size(path):
    with Image.open(path) as im:
        im = ImageOps.exif_transpose(im)
        return im.width, im.height


def main():
    os.makedirs(THUMBS, exist_ok=True)

    made = 0
    for name in sorted(os.listdir(PHOTOS)):
        src = os.path.join(PHOTOS, name)
        if not os.path.isfile(src) or os.path.splitext(name)[1].lower() not in EXTS:
            continue
        out = os.path.join(SITE, thumb_rel(name))
        if os.path.exists(out) and os.path.getmtime(out) >= os.path.getmtime(src):
            continue
        build_thumb(src, out)
        made += 1
        print(f"thumb  {name}: {os.path.getsize(src) // 1024}KB -> {os.path.getsize(out) // 1024}KB")

    with open(DATA, encoding="utf-8") as f:
        raw = f.read()
    data = json.loads(raw)
    for p in data.get("photos", []):
        src = p.get("src")
        if not src:
            continue
        path = os.path.join(SITE, src)
        if not os.path.exists(path):
            print(f"warning: {src} is listed in photos.json but missing", file=sys.stderr)
            continue
        w, h = image_size(path)
        p["width"], p["height"] = w, h
        t = thumb_rel(src)
        if os.path.exists(os.path.join(SITE, t)):
            p["thumb"] = t
    out = json.dumps(data, indent=2, ensure_ascii=False) + "\n"
    if out != raw:
        with open(DATA, "w", encoding="utf-8") as f:
            f.write(out)
        print("updated data/photos.json")

    print(f"done: {made} thumbnail(s) built")


if __name__ == "__main__":
    main()
