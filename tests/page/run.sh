#!/bin/zsh
# Page tests: runs each tests/page/*.js inside dashboard/preview.html (fake data) in headless
# Chrome and prints every check. Exits non-zero if any check fails.
# Usage: zsh tests/page/run.sh [name ...]   e.g. zsh tests/page/run.sh rules-reorder
set -u
ROOT=${0:A:h:h:h}
CHROME=${CHROME:-"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"}
PAGE="$ROOT/dashboard/_page-test.html"
names=("$@")
[[ ${#names[@]} -eq 0 ]] && names=(${(f)"$(cd "$ROOT/tests/page" && ls *.js | sed 's/\.js$//')"})

failed=0
i=0
for name in $names; do
  i=$((i + 1))
  echo "[PROGRESS] Running $name ($i/${#names[@]})"
  sed "s#</body>#<script src=\"../tests/page/$name.js\"></script></body>#" "$ROOT/dashboard/preview.html" > "$PAGE"
  result=$("$CHROME" --headless=new --disable-gpu --allow-file-access-from-files --virtual-time-budget=8000 \
    --dump-dom "file://$PAGE" 2>/dev/null | perl -0ne 'print "$1" if /data-result="([^"]*)"/s')
  rm -f "$PAGE"
  if [[ -z $result ]]; then
    echo "  FAIL $name did not finish"
    failed=1
    continue
  fi
  echo "$result" | tr '|' '\n' | sed 's/^ */  /'
  [[ $result == *FAIL* ]] && failed=1
done
echo "[PROGRESS] Finished all page tests: $([[ $failed -eq 0 ]] && echo 'all passed' || echo 'some FAILED')"
exit $failed
