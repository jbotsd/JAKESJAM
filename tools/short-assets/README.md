# short-assets

Fonts for `tools/build-short.sh`, so a daily vertical short is set in the
game's OWN typography rather than whatever ffmpeg finds on the box.

These are decompressed from `client/public/fonts/*.woff2` — the same faces
the client ships. ffmpeg's `drawtext` cannot read woff2, and it renders a
variable font at its DEFAULT instance (Space Grotesk defaults to 300, far
too light for a hook that has to survive a muted feed preview), so the
weights are baked here as static instances.

Regenerate:

    cd tools/short-assets
    cp ../../client/public/fonts/space-grotesk-var.woff2 .
    cp ../../client/public/fonts/space-mono-700.woff2 .
    woff2_decompress space-grotesk-var.woff2
    woff2_decompress space-mono-700.woff2
    fonttools varLib.instancer space-grotesk-var.ttf wght=700 -o space-grotesk-700.ttf
    fonttools varLib.instancer space-grotesk-var.ttf wght=500 -o space-grotesk-500.ttf
    rm -f *.woff2

| file | used for |
|---|---|
| `space-grotesk-700.ttf` | the hook (frame-one text) |
| `space-grotesk-500.ttf` | captions (spare — not wired yet) |
| `space-mono-700.ttf` | the `play.elyad.io` mark |
| `space-grotesk-var.ttf` | source for the two instances above |
