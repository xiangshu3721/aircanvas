#!/usr/bin/env bash
# 构建并发布到 GitHub Pages（gh-pages 分支，保留历史，不强推）
set -euo pipefail
cd "$(dirname "$0")/.."
REPO_URL=$(git remote get-url origin)
npm run build
TMP=$(mktemp -d)
if git ls-remote --exit-code --heads origin gh-pages >/dev/null 2>&1; then
  git clone --quiet --depth 1 --branch gh-pages "$REPO_URL" "$TMP"
else
  git init --quiet -b gh-pages "$TMP"
  git -C "$TMP" remote add origin "$REPO_URL"
fi
find "$TMP" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
cp -R dist/. "$TMP/"
touch "$TMP/.nojekyll"
cd "$TMP"
git add -A
if git diff --cached --quiet; then echo "没有变化，无需发布"; exit 0; fi
git -c user.name="$(git -C "$OLDPWD" config user.name)" -c user.email="$(git -C "$OLDPWD" config user.email)" \
  commit --quiet -m "deploy: $(date '+%Y-%m-%d %H:%M:%S')"
git push --quiet origin gh-pages
echo "已发布到 gh-pages"
