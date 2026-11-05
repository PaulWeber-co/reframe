# Your own video

Reframe ships no video. Put your own clips here and the wall plays them behind
the tiles, by time of day: `morning`, `day`, `evening` and `late`. Each day it
plays two clips of the scene that is current and moves on the next day.

The easy way (needs Docker; works on any clip your phone, drone or camera made):

```sh
docker compose run --rm -v "$PWD/clips:/clips:ro" reframe reframe-media add day /clips/coast.mov
```

That makes `media/day-coast.mp4` (1080p, 24 frames per second, no sound, a
limited bit rate, so a laptop stays cool) and a still picture
`media/day-coast.jpg`. Your original is not touched. Add four to eight clips per
scene to have variety over the days; one is enough to start.

By hand, if you prefer: name a clip `<scene>-<name>.mp4`, with lowercase letters,
digits and hyphens in the name, and put a `<scene>-<name>.jpg` next to it.

Good clips are calm: slow drone flights, long shots, no cuts, no fast clouds.
Clips of your own are best, and nothing you do not have the right to show
belongs here: this folder is ignored by git on purpose.

`morning` is first light, `day` the bright hours, `evening` the last light
around sunset, `late` after sunset and through the night.
