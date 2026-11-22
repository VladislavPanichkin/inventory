#!/bin/sh
# Takes a screenshot of a page of the locally running web app with headless Chrome.
#
#   screenshot.sh <path> <width,height> <output.png>
#   screenshot.sh /products 500,1100 /tmp/products-phone.png
#
# Widths below about 500 px are cropped by headless Chrome, so 500 is the "phone" width.
set -eu

path=${1:?usage: screenshot.sh <path> <width,height> <output.png>}
size=${2:?missing <width,height>}
out=${3:?missing <output.png>}
base=${APP_URL:-http://localhost:5173}
chrome=${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}
profile=${CHROME_PROFILE:-${TMPDIR:-/tmp}/inventory-screenshot-profile}

if [ ! -x "$chrome" ]; then
  echo "Chrome not found at: $chrome (set CHROME to its path)" >&2
  exit 1
fi

# The virtual time budget gives the page time to load its data before the picture is taken.
"$chrome" --headless=new --disable-gpu --hide-scrollbars \
  --user-data-dir="$profile" \
  --window-size="$size" --virtual-time-budget=8000 \
  --screenshot="$out" "$base$path" >/dev/null 2>&1

echo "$out"
