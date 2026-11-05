# Releasing

For the maintainer. One release is one tag; everything else follows from it.

## Once, before the first release

1. The repository is **public**.
2. **Settings → Actions → General**: allow GitHub Actions, and under *Workflow
   permissions* choose "Read and write permissions" (the release workflow pins the
   Umbrel apps and creates the GitHub release).
3. **Settings → Code security**: enable *Private vulnerability reporting*
   (SECURITY.md sends reporters there).
4. **About** (the gear next to the repository description): the description and
   topics, and **Settings → General → Social preview**: upload
   `docs/assets/social-preview.png`.
5. **Settings → Pages**: under *Build and deployment* choose **Source: GitHub
   Actions**. The **Pages** workflow then publishes the `site/` folder to
   <https://paulweber-co.github.io/reframe/> on every change to it. Put that
   address in the repository's *Website* field (About).

## Every release

1. Update `CHANGELOG.md` (a new `## x.y.z - date` section), `version` in
   `app/package.json`, and `version:` in `reframe-dashboard/umbrel-app.yml` and
   `reframe-display/umbrel-app.yml`. Commit and push to `main`; wait for CI.
2. Tag and push:

   ```sh
   git tag v0.1.0
   git push origin v0.1.0
   ```

3. The **Image** workflow then
   - builds the image for amd64 and arm64 and pushes `ghcr.io/paulweber-co/reframe:0.1.0`
     and `latest`,
   - pins both Umbrel apps to that image's digest and pushes the change to `main`
     (`scripts/pin-umbrel-image.sh`),
   - creates the GitHub release with the changelog section as its notes.
4. **First release only:** the package is private until you change it. Open the
   repository's **Packages** (or your profile → Packages → `reframe`) →
   *Package settings* → *Change visibility* → **Public**, and connect it to the
   repository. Then re-run the failed step of the workflow, or run
   `scripts/pin-umbrel-image.sh 0.1.0` by hand, commit and push. Umbrel, and
   `docker compose pull`, cannot fetch a private image.
5. Check: `docker pull ghcr.io/paulweber-co/reframe:0.1.0` works without logging
   in, and in umbrelOS the community store lists both apps.

## Getting into the official Umbrel App Store

See [docs/umbrel.md](docs/umbrel.md). In short: a pull request to
`getumbrel/umbrel-apps` with the `reframe-dashboard` folder (without `icon`, with
`gallery: []` and `releaseNotes: ""`, the app id and folder renamed as they ask),
the image pinned by digest.
