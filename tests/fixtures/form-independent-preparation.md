# Independent form review holdouts

The two cases use different public recordings and demonstrators. The DVIDS IDs, source filenames, and URLs are absent from the project's existing fixtures. The Navy video shows floor push-ups. The Air Force video shows a sustained forearm plank. Neither case was used to tune the application or grade its previous benchmarks.

Both DVIDS pages mark the sources public domain. The local evaluation clips retain exercise footage without audio, subtitle or data streams, chapters, title cards, or identifying overlays. The primary demonstrator's face is masked in each clip. The Air Force clip is cropped around the athlete to keep the relevant joints visible.

The appearance of U.S. Department of War (DoW) visual information does not imply or constitute DoW endorsement.

- [Push Up Demonstration, Navy Personnel Command](https://www.dvidshub.net/video/283728/push-up-demonstration) by LT Andrea Perez. Video ID 283728, DOD_100759035. [Source MP4](https://d34w7g4gy10iej.cloudfront.net/video/1303/DOD_100759035/DOD_100759035-720x406-800k.mp4).
- [Forearm Plank, 301st Fighter Wing](https://www.dvidshub.net/video/825280/forearm-plank) by SSgt Randall Moose. Video ID 825280, DOD_108726588. [Source MP4](https://d34w7g4gy10iej.cloudfront.net/video/2112/DOD_108726588/DOD_108726588.mp4).
- [DVIDS Public Use Notice](https://www.dvidshub.net/about/copyright).

Encode from the named source files with FFmpeg 9.0. Commands here assume the current directory contains the source MP4s.

```sh
ffmpeg -hide_banner -loglevel error -threads 2 -ss 73.6 -i push-up-source.mp4 -t 8.8 -map 0:v:0 -an -sn -dn -map_metadata -1 -map_chapters -1 -vf 'drawbox=x=134:y=48:w=112:h=258:color=black:t=fill,scale=640:-2,fps=24' -c:v libx264 -preset medium -crf 21 -pix_fmt yuv420p -movflags +faststart navy-2013-floor.mp4
ffmpeg -hide_banner -loglevel error -threads 2 -ss 8 -i plank-alt-source.mp4 -t 9.5 -map 0:v:0 -an -sn -dn -map_metadata -1 -map_chapters -1 -vf 'drawbox=x=412:y=332:w=77:h=89:color=black:t=fill,crop=640:280:365:277,fps=24' -c:v libx264 -preset medium -crf 21 -pix_fmt yuv420p -movflags +faststart air-force-2021-plank.mp4
```

## Narrow face mask variant

The original masked push-up and original manifest remain in place. MoveNet accepted the same excerpt without the mask in a local diagnostic only, but abstained with the static tall box and with static pixelation. That diagnostic was kept local and the unmasked rendition was removed. This variant uses the same recording and interval. It does not count as another independent source. The moving box covers the face while leaving hand contact and joints visible. Its positions are pinned in `navy-mask-track.txt`. These were derived from 12 frames/s of local MoveNet facial landmark positions with position and timing margins. All eight actual sample frames were checked visually.

```sh
ffmpeg -hide_banner -loglevel error -threads 2 -ss 73.6 -i push-up-source.mp4 -t 8.8 -map 0:v:0 -an -sn -dn -map_metadata -1 -map_chapters -1 -vf 'scale=640:-2,fps=24,sendcmd=filename=navy-mask-track.txt,drawbox@face=x=140:y=60:w=90:h=103:color=black:t=fill' -c:v libx264 -preset medium -crf 21 -pix_fmt yuv420p -movflags +faststart navy-2013-floor-mask-v3.mp4
```
