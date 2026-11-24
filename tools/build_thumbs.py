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

Safe to re-run. A thumbnail is rebuilt only when its photo's CONTENT changed
(tracked by hash in photos/thumbs/manifest.json, so replacing a photo under the
same filename works; file dates are unreliable after a git checkout), and
photos.json is only rewritten when something changed. The deploy workflow runs
this too, so a photo added without running it still gets a thumbnail on the
live site.

It never fails the deploy because of one photo: if a photo can't be processed
it prints a warning and that photo simply uses its original file on the site.

Usage:  python3 tools/build_thumbs.py [--force]   (needs Pillow: pip install pillow)
        --force rebuilds every thumbnail.
"""
import hashlib
import io
import json
import os
import sys

from PIL import Image, ImageCms, ImageOps

SITE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "Personal Website")
PHOTOS = os.path.join(SITE, "photos")
THUMBS = os.path.join(PHOTOS, "thumbs")
MANIFEST = os.path.join(THUMBS, "manifest.json")
DATA = os.path.join(SITE, "data", "photos.json")

THUMB_WIDTH = 640
QUALITY = 80
EXTS = {".jpg", ".jpeg", ".png", ".webp"}
# Part of each manifest key: changing the thumbnail settings rebuilds them all
RECIPE = f"w{THUMB_WIDTH}-q{QUALITY}-srgb1"

# Big camera files are fine here; we only ever shrink them.
Image.MAX_IMAGE_PIXELS = 400_000_000

SRGB = ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB"))
CMS_MODE = {"GRAY": "L", "RGB": "RGB", "CMYK": "CMYK"}


def warn(msg):
    print(f"warning: {msg}", file=sys.stderr)


def thumb_rel(src_rel):
    stem = os.path.splitext(os.path.basename(src_rel))[0]
    return f"photos/thumbs/{stem}.webp"


def to_srgb(im):
    """Convert from the embedded colour profile (iPhone photos are Display P3)
    to plain sRGB, the same conversion the browser does when it draws the
    photo into the shadow-flicker canvas. Dropping the profile without
    converting would shift the colours. Grayscale and CMYK profiles are
    handled too; a broken or unsupported profile is ignored with a warning.
    Transparency is kept."""
    icc = im.info.get("icc_profile")
    alpha = None
    if im.mode in ("RGBA", "LA", "PA") or (im.mode == "P" and "transparency" in im.info):
        alpha = im.convert("RGBA").getchannel("A")
    out = None
    if icc:
        try:
            src = ImageCms.ImageCmsProfile(io.BytesIO(icc))
            mode = CMS_MODE.get(src.profile.xcolor_space.strip())
            if mode:
                out = ImageCms.profileToProfile(
                    im.convert(mode), src, SRGB,
                    renderingIntent=ImageCms.Intent.RELATIVE_COLORIMETRIC,
                    outputMode="RGB",
                )
        except (ImageCms.PyCMSError, OSError, ValueError) as e:
            warn(f"ignoring colour profile ({e})")
    if out is None:
        out = im.convert("RGB")
    if alpha is not None:
        out.putalpha(alpha)
    return out


def build_thumb(src_path, out_path):
    with Image.open(src_path) as im:
        im = ImageOps.exif_transpose(im)
        im = to_srgb(im)
        if im.width > THUMB_WIDTH:
            h = round(im.height * THUMB_WIDTH / im.width)
            im = im.resize((THUMB_WIDTH, h), Image.LANCZOS)
        tmp = out_path + ".tmp"
        im.save(tmp, "WEBP", quality=QUALITY, method=6)
        os.replace(tmp, out_path)


def image_size(path):
    with Image.open(path) as im:
        im = ImageOps.exif_transpose(im)
        return im.width, im.height


def file_key(path):
    h = hashlib.sha1()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return f"{h.hexdigest()}-{RECIPE}"


def load_manifest():
    try:
        with open(MANIFEST, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def main():
    force = "--force" in sys.argv[1:]
    os.makedirs(THUMBS, exist_ok=True)
    old = load_manifest()
    manifest = {}
    current = set()  # source names whose thumbnail matches the source

    made = 0
    for name in sorted(os.listdir(PHOTOS)):
        src = os.path.join(PHOTOS, name)
        if not os.path.isfile(src) or os.path.splitext(name)[1].lower() not in EXTS:
            continue
        out = os.path.join(SITE, thumb_rel(name))
        key = file_key(src)
        if not force and old.get(name) == key and os.path.exists(out):
            manifest[name] = key
            current.add(name)
            continue
        try:
            build_thumb(src, out)
        except Exception as e:  # one bad photo must not block the deploy
            warn(f"could not make a thumbnail for {name} ({e}); the site will use the original")
            if os.path.exists(out):
                os.remove(out)  # never serve a thumbnail of an older photo
            continue
        manifest[name] = key
        current.add(name)
        made += 1
        print(f"thumb  {name}: {os.path.getsize(src) // 1024}KB -> {os.path.getsize(out) // 1024}KB")

    manifest_text = json.dumps(manifest, indent=2, sort_keys=True) + "\n"
    try:
        with open(MANIFEST, encoding="utf-8") as f:
            unchanged = f.read() == manifest_text
    except OSError:
        unchanged = False
    if not unchanged:
        with open(MANIFEST, "w", encoding="utf-8") as f:
            f.write(manifest_text)

    with open(DATA, encoding="utf-8") as f:
        raw = f.read()
    data = json.loads(raw)
    for p in data.get("photos", []):
        src = p.get("src")
        if not src:
            continue
        path = os.path.join(SITE, src)
        if not os.path.exists(path):
            warn(f"{src} is listed in photos.json but missing")
            continue
        try:
            w, h = image_size(path)
            p["width"], p["height"] = w, h
        except Exception as e:
            warn(f"could not read the size of {src} ({e})")
            p.pop("width", None)
            p.pop("height", None)
        if os.path.basename(src) in current:
            p["thumb"] = thumb_rel(src)
        else:
            p.pop("thumb", None)
    out = json.dumps(data, indent=2, ensure_ascii=False) + "\n"
    if out != raw:
        with open(DATA, "w", encoding="utf-8") as f:
            f.write(out)
        print("updated data/photos.json")

    print(f"done: {made} thumbnail(s) built")


if __name__ == "__main__":
    main()
