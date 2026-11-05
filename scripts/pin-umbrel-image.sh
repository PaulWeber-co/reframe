#!/bin/sh
# Pin the Umbrel apps to the exact image a release built.
#
# The official Umbrel App Store wants image references with a digest
# (name:tag@sha256:...), so an update can never change under you. After the
# image workflow has pushed a release, run this with its version:
#
#   scripts/pin-umbrel-image.sh 0.1.0
#
# It looks the digest up in the registry and rewrites both compose files and
# both manifests. Review the diff, commit it, tag it.
set -eu

version="${1:?usage: $0 <version>, e.g. 0.1.0}"
image="ghcr.io/paulweber-co/reframe"
root="$(cd "$(dirname "$0")/.." && pwd)"

digest="$(docker buildx imagetools inspect "$image:$version" --format '{{json .Manifest.Digest}}' | tr -d '"')"
case "$digest" in
	sha256:????????????????????????????????????????????????????????????????) ;;
	*) echo "could not read a digest for $image:$version (got: $digest)" >&2; exit 1 ;;
esac

for app in reframe-dashboard reframe-display; do
	sed -i -E "s#image: $image:[^ @]+(@sha256:[0-9a-f]+)?#image: $image:$version@$digest#" "$root/$app/docker-compose.yml"
	sed -i -E "s#^version: .*#version: \"$version\"#" "$root/$app/umbrel-app.yml"
done
echo "pinned $image:$version@$digest"
