#!/bin/sh
# Publishes docs/wiki/*.md to the repository wiki.
#
# The wiki is a separate git repository, and GitHub creates it only after somebody has made the
# first page in the browser. If `git ls-remote` cannot find it, this script says so and stops.
#
#   contrib/publish-wiki.sh
set -eu

repo="rafifos/punktfunk-plugin-heronite"
here=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
pages="$here/docs/wiki"
url="https://github.com/$repo.wiki.git"

[ -d "$pages" ] || { echo "no $pages" >&2; exit 1; }

if ! git ls-remote "$url" >/dev/null 2>&1; then
	echo "the wiki does not exist yet. Create the first page in the browser, then run this again:" >&2
	echo "  https://github.com/$repo/wiki/_new" >&2
	exit 1
fi

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

git clone --quiet "$url" "$work/wiki"
cp "$pages"/*.md "$work/wiki/"
stamp=$(date -u +%Y-%m-%dT%H:%M:%SZ)
(
	cd "$work/wiki"
	git add -A
	if git diff --cached --quiet; then
		echo "the wiki is already current"
		exit 0
	fi
	git -c user.name="${GIT_AUTHOR_NAME:-wiki}" \
		-c user.email="${GIT_AUTHOR_EMAIL:-wiki@localhost}" \
		commit --quiet -m "docs: sync docs/wiki at $stamp"
	git push --quiet origin HEAD
	echo "published $(ls "$pages"/*.md | wc -l) page(s) to https://github.com/$repo/wiki"
)
