#!/bin/sh
# Renders the SEENALYZE STUDIO installer artwork from build/source/:
# - build/dmg-background.png and @2x (macOS disk image window, 660 x 400) from dmg-background.svg;
# - build/installer/hero.bmp (Windows installer picture, 500 x 160, 24-bit, no alpha) from
#   installer-hero.svg, with the app icon (build/icon.png) embedded.
# Needs rsvg-convert and ImageMagick (brew install librsvg imagemagick).
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
res="$root/build"
work=$(mktemp -d "${TMPDIR:-/tmp}/studio-installer-art.XXXXXX")
trap 'rm -rf "${work:?}"' EXIT
magick "$res/icon.png" -resize 240x240 "$work/icon.png"
for name in dmg-background installer-hero; do
  python3 -c 'import base64,sys; svg=open(sys.argv[1]).read(); icon=base64.b64encode(open(sys.argv[2],"rb").read()).decode(); open(sys.argv[3],"w").write(svg.replace("ICON_BASE64", icon))' \
    "$res/source/$name.svg" "$work/icon.png" "$work/$name.svg"
done
rsvg-convert -w 660 -h 400 "$work/dmg-background.svg" -o "$res/dmg-background.png"
rsvg-convert -w 1320 -h 800 "$work/dmg-background.svg" -o "$res/dmg-background@2x.png"
rsvg-convert -w 500 -h 160 "$work/installer-hero.svg" -o "$work/hero.png"
mkdir -p "$res/installer"
magick "$work/hero.png" -background "#ffffff" -alpha remove -alpha off -type TrueColor "BMP3:$res/installer/hero.bmp"
echo "Wrote build/dmg-background.png, build/dmg-background@2x.png and build/installer/hero.bmp"
